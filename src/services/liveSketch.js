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
  try {
    // A form saját induló betöltése (típusgarázs-lista lekérése) hibát dobhat, mert nincs valódi backend
    // mögötte ebben a kontextusban — ezt figyelmen kívül hagyjuk, nem befolyásolja a rajz-motort.
    page.on('pageerror', () => {});
    page.on('console', () => {});
    await page.setContent(getCustomerFormHtml(), { waitUntil: 'domcontentloaded' });
    await page.evaluate((data) => {
      if (typeof window.applyFormState === 'function') {
        window.applyFormState(data);
      }
    }, formData);
    const svg = await page.evaluate(() => {
      const el = document.getElementById('sketch');
      return el ? el.innerHTML : '';
    });
    return svg;
  } finally {
    await page.close();
  }
}

module.exports = { renderLiveSketch };
