const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browserPromise;
}

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
    if (req.url().includes('/public/garage-types')) {
      // Nem elutasítjuk (abort) a kérést, mert az hibát dobhat a form saját kódjában, ami
      // megszakíthatja a további inicializálást (pl. a rajz renderelését is). Ehelyett egy
      // ártalmatlan, sikeres, de üres választ adunk — a form ezt normál esetként kezeli.
      req.respond({ status: 200, contentType: 'application/json', body: '[]' }).catch(() => {});
    } else {
      req.continue().catch(() => {});
    }
  });
  await page.setContent(getCustomerFormHtml(), { waitUntil: 'load', timeout: 15000 });
  // Biztosra megyünk, hogy a form saját induló inicializálása (választógombok bekötése, kezdeti rajz)
  // teljesen lefutott — ez tartalmazhat egy kis (setTimeout-alapú) késleltetést is a form saját kódjában.
  await new Promise((resolve) => setTimeout(resolve, 800));

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
    await page.close();
    throw new Error(evalResult.error + (pageErrors.length ? ' | Oldal hibák: ' + pageErrors.join('; ') : ''));
  }
  return { page, pageErrors, diag: evalResult.diag };
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
