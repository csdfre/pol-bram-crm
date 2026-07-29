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

/**
 * Lefuttatja a valódi ügyfél-oldali configurátor rajzoló motorját (applyFormState + renderSketch)
 * a megadott form_data-val, és visszaadja a friss, aktuális SVG-rajzot szövegként.
 * Ezt használja az admin/kolléganő szerkesztő oldal, amikor a "Rajz frissítése" gombra kattintanak,
 * hogy a rajz mindig tükrözze a legutóbb szerkesztett adatokat (méret, kapu/ablak/ajtó pozíció, stb.)
 */
async function renderLiveSketch(formData) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  const pageErrors = [];
  try {
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('console', (msg) => { if (msg.type() === 'error') pageErrors.push(msg.text()); });

    // A form saját induló betöltése megpróbálja lekérdezni a típusgarázs-listát egy valós backend-től —
    // ez itt (Puppeteer-rel, nem valódi domainen futtatva) elakadhat vagy sokáig várakozhat. Ezt a
    // konkrét kérést azonnal elutasítjuk, hogy a form gyorsan, hiba nélkül továbbléphessen (a form
    // saját try/catch-e ezt már úgyis kezeli, csak nem lesz típusgarázs-lista — ami itt nem is kell).
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.url().includes('/public/garage-types')) {
        req.abort().catch(() => {});
      } else {
        req.continue().catch(() => {});
      }
    });

    await page.setContent(getCustomerFormHtml(), { waitUntil: 'load', timeout: 15000 });
    // Biztosra megyünk, hogy a form saját induló inicializálása (választógombok bekötése, kezdeti rajz) lefutott,
    // mielőtt a mi adatainkkal felülírnánk — egy rövid várakozás elegendő erre.
    await new Promise((resolve) => setTimeout(resolve, 400));

    const evalResult = await page.evaluate((data) => {
      try {
        if (typeof window.applyFormState !== 'function') {
          return { error: 'applyFormState nem található a form oldalán.' };
        }
        window.applyFormState(data);
        if (typeof window.refreshAll === 'function') window.refreshAll();
        const el = document.getElementById('sketch');
        return { svg: el ? el.innerHTML : '', hadSketchEl: !!el };
      } catch (e) {
        return { error: 'Kliens-oldali hiba: ' + e.message };
      }
    }, formData);

    if (evalResult.error) {
      throw new Error(evalResult.error + (pageErrors.length ? ' | Oldal hibák: ' + pageErrors.join('; ') : ''));
    }
    if (!evalResult.svg) {
      throw new Error('A rajz üresen tért vissza.' + (pageErrors.length ? ' Oldal hibák: ' + pageErrors.join('; ') : ''));
    }
    return evalResult.svg;
  } finally {
    await page.close();
  }
}

module.exports = { renderLiveSketch };
