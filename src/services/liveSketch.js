const fs = require('fs');
const path = require('path');
const { getBrowser } = require('./browserPool');

// A valódi ügyfél-oldali form HTML-jét egyszer betöltjük memóriába (nem kell minden hívásnál fájlból olvasni)
const CUSTOMER_FORM_PATH = path.join(__dirname, '..', '..', 'public', 'site', 'index.html');
let customerFormHtmlCache = null;
function getCustomerFormHtml() {
  if (!customerFormHtmlCache) {
    customerFormHtmlCache = fs.readFileSync(CUSTOMER_FORM_PATH, 'utf8');
  }
  return customerFormHtmlCache;
}

// Közös induló lépések: friss oldal betöltése, a megadott adatok alkalmazása.
// Blokkoljuk a típusgarázs-lista lekérdezését (ami itt, Puppeteer-rel futtatva elakadhatna),
// és megvárjuk, míg a form saját inicializálása lefut.
async function preparePage(formData) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push('pageerror: ' + err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        // A Puppeteer néha csak "JSHandle@error"-t ad vissza objektum-argumentumoknál — megpróbáljuk
        // a tényleges hibaszöveget is kiolvasni, ha lehetséges.
        Promise.all(msg.args().map(a => a.jsonValue().catch(() => a.toString())))
          .then(vals => pageErrors.push('console.error: ' + vals.map(v => typeof v === 'object' ? JSON.stringify(v) : v).join(' ')))
          .catch(() => pageErrors.push('console.error: ' + msg.text()));
      }
    });
    // Fontos: egy valós asztali böngészőnek megfelelő ablakméretet állítunk be — a rajz-motor a
    // konténer tényleges megjelenített méretéből számolja a méretarányt (cm -> pixel), és Puppeteer
    // alapértelmezett (kis) ablakmérete ezt a számítást elronthatja, aminek a rajz szétesése a következménye.
    await page.setViewport({ width: 1400, height: 1000 });
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/public/garage-types')) {
        // Nem elutasítjuk (abort) a kérést, mert az hibát dobhat a form saját kódjában, ami
        // megszakíthatja a további inicializálást (pl. a rajz renderelését is). Ehelyett egy
        // ártalmatlan, sikeres, de üres választ adunk — a form ezt normál esetként kezeli.
        req.respond({ status: 200, contentType: 'application/json', body: '[]' }).catch(() => {});
      } else if (/^https?:/i.test(url)) {
        // MINDEN külső erőforrást (Google Fonts stb.) letiltunk. Az űrlap <head>-jében lévő betűtípus-
        // stíluslap ugyanis blokkolja a form scriptjeit és a "load" eseményt is: ha a szerver felől a
        // Google lassan vagy sehogy sem válaszol, az oldal betöltése elakad, és a rajz-frissítés
        // "Navigation timeout of 15000 ms exceeded" hibával leáll. A rajz geometriája nem függ a
        // betűtípustól (nincs szövegmérés), így erre nincs is szükség — az előnézet tartalék
        // betűtípussal készül, de megbízhatóan és gyorsan.
        req.abort('blockedbyclient').catch(() => {});
      } else {
        req.continue().catch(() => {});
      }
    });
    // Nem a "load" eseményre várunk (az külső erőforrásoktól függene), hanem csak a HTML feldolgozására,
    // majd arra, hogy a form saját rajzoló függvényei ténylegesen elérhetők legyenek. Hidegindításkor
    // (lassú CPU) bőséges időtúllépést engedünk.
    await page.setContent(getCustomerFormHtml(), { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(
      () => typeof window.applyFormState === 'function' && typeof window.renderSketch === 'function',
      { timeout: 20000 }
    );
    // Rövid várakozás, hogy a form saját induló inicializálása (választógombok bekötése, kezdeti rajz)
    // teljesen lefusson — ez tartalmazhat egy kis (setTimeout-alapú) késleltetést is a form saját kódjában.
    await new Promise((resolve) => setTimeout(resolve, 300));

    const evalResult = await page.evaluate((data) => {
      try {
        if (typeof window.applyFormState !== 'function') {
          return { error: 'applyFormState nem található a form oldalán.' };
        }
        window.applyFormState(data);
        if (typeof window.refreshAll === 'function') window.refreshAll();
        if (typeof window.renderSketch === 'function') window.renderSketch();
        const container = document.getElementById('sketch');
        return {
          ok: true,
          diag: {
            hasContainer: !!container,
            containerHtmlLength: container ? container.innerHTML.length : -1,
            containerHtmlSample: container ? container.innerHTML.slice(0, 200) : '',
          },
        };
      } catch (e) {
        return { error: 'Kliens-oldali hiba: ' + e.message + ' | Stack: ' + (e.stack||'').slice(0,300) };
      }
    }, formData);

    if (evalResult.error) {
      throw new Error(evalResult.error + (pageErrors.length ? ' | Oldal hibák: ' + pageErrors.join('; ') : ''));
    }
    // FONTOS: itt (sikeres eset) SZÁNDÉKOSAN nem zárjuk be a lapot — a hívó fél (renderLiveSketchSvg/
    // renderLiveSketchPng) kapja meg és zárja be a saját try/finally blokkjában, miután felhasználta.
    return { page, pageErrors, diag: evalResult.diag };
  } catch (err) {
    // Bármilyen hiba történjen is a fenti előkészítés SORÁN (pl. setContent időtúllépés, evaluate
    // hiba) — korábban ez a lap-bezárás elmaradásához (memóriaszivárgáshoz) vezetett, mert csak az
    // explicit "evalResult.error" ág zárta be a lapot. Most egy közös try/catch garantálja, hogy a
    // lap MINDEN hibaágon bezáródik, mielőtt a hiba továbbdobódik.
    await page.close().catch(() => {});
    throw err;
  }
}

/**
 * A rajzot VALÓDI SVG-szövegként adja vissza (XMLSerializer-rel, ami megbízhatóan megőrzi az
 * SVG-specifikus, kis-nagybetű-érzékeny attribútumokat, pl. viewBox). Ezt kell használni, amikor
 * az eredményt EL KELL MENTENI az adatbázisba (sketch_svg mező), mert minden más helyen
 * (PDF-generálás, kolléganő-fordítás, email-PNG) ez a mező valódi SVG-szöveget vár.
 */
async function renderLiveSketchSvg(formData) {
  const { page, pageErrors, diag } = await preparePage(formData);
  try {
    const result = await page.evaluate(() => {
      const container = document.getElementById('sketch');
      if (!container) return { error: 'Nem található a #sketch elem.' };
      // A #sketch elem MAGA egy <svg> tag (nem egy azt körülvevő <div>), tehát a tartalmát
      // magán a konténeren kell szerializálni, nem egy benne keresett beágyazott <svg>-n.
      const svgEl = container.tagName && container.tagName.toLowerCase() === 'svg'
        ? container
        : container.querySelector('svg');
      if (!svgEl) return { svg: '' };
      const serialized = new XMLSerializer().serializeToString(svgEl);
      return { svg: serialized };
    });
    if (result.error) throw new Error(result.error + (pageErrors.length ? ' | Oldal hibák: ' + pageErrors.join('; ') : ''));
    if (!result.svg) {
      const diagText = diag ? ` | Diagnosztika: konténer megvan=${diag.hasContainer}, HTML hossza=${diag.containerHtmlLength}, minta="${diag.containerHtmlSample}"` : '';
      throw new Error('A rajz üresen tért vissza.' + diagText + (pageErrors.length ? ' | Oldal hibák: ' + pageErrors.join('; ') : ''));
    }
    return result.svg;
  } finally {
    await page.close();
  }
}

/**
 * A rajzot egy base64 PNG KÉPKÉNT adja vissza (tényleges képernyőkép a rajz-területről).
 * Ezt kell használni, amikor csak MEGJELENÍTÉSRE kell (pl. a "Rajz frissítése" előnézeti gombnál),
 * NEM adatbázis-mentésre — a PNG-képernyőkép teljesen kizárja az SVG-szöveg-kinyeréssel járó,
 * böngészőtől függő méretezési/torzulási problémákat.
 */
async function renderLiveSketchPng(formData) {
  const { page, pageErrors } = await preparePage(formData);
  try {
    const sketchHandle = await page.$('#sketch');
    if (!sketchHandle) {
      throw new Error('Nem található a #sketch elem.' + (pageErrors.length ? ' Oldal hibák: ' + pageErrors.join('; ') : ''));
    }
    const buffer = await sketchHandle.screenshot({ type: 'png' });
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } finally {
    await page.close();
  }
}

module.exports = { renderLiveSketchSvg, renderLiveSketchPng };
