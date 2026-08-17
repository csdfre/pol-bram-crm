const puppeteer = require('puppeteer');
const { translateSketchToPolish } = require('./pdf');
const { renderLiveSketchSvg } = require('./liveSketch');

/**
 * A kolléganőnek küldött Excel-riporthoz kell a garázs felülnézeti rajza, de NYOMTATÁSRA / Excelbe
 * illesztve — vagyis fehér háttérrel, csak fekete vonalakkal, szín nélkül (nem az admin felület
 * sötét témájú, színes vázlata). FONTOS: itt NEM egy saját, közelítő rajzot generálunk — a valós
 * rendszer által már elmentett/generált SVG-t (customer.sketch_svg, vagy ha az hiányzik,
 * renderLiveSketchSvg-vel frissen legenerálva) alakítjuk át pusztán színben/stílusban, a
 * geometria (méretek, kapu/ajtó/ablak pozíciók) TELJESEN VÁLTOZATLAN marad.
 */

let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  }
  return browserPromise;
}

/**
 * A megadott (már lengyelre fordított feliratú) SVG-t fehér hátterű, fekete vonalas, nagyfelbontású
 * PNG-vé rendereli. A színek eltávolítása CSS szűrővel (grayscale + invert) történik a VALÓDI
 * böngészőben — ez nem módosítja a rajz geometriáját, csak a megjelenő színeket.
 * Visszaadja a PNG buffert és a tényleges (CSS pixelben mért) méretét is, hogy az Excelbe
 * illesztéskor helyesen lehessen méretezni/arányosítani.
 */
async function renderSketchPngWhiteBlack(svgMarkup, { scale = 3, cssWidth = 1000 } = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: cssWidth + 80, height: Math.round(cssWidth * 0.75) + 80, deviceScaleFactor: scale });
    await page.setContent(`<!DOCTYPE html><html><head><style>
      html,body{margin:0;padding:0;background:#ffffff;}
      #wrap{display:inline-block;background:#ffffff;padding:20px;}
      #wrap svg{display:block;width:${cssWidth}px;height:auto;filter:grayscale(1) invert(1) contrast(1.05);}
    </style></head><body><div id="wrap">${svgMarkup}</div></body></html>`, { waitUntil: 'networkidle0', timeout: 15000 });
    const el = await page.$('#wrap');
    const box = await el.boundingBox();
    const buffer = await el.screenshot({ type: 'png' });
    return { buffer, cssWidthPx: box.width, cssHeightPx: box.height };
  } finally {
    await page.close();
  }
}

/**
 * A megrendelés (customer rekord) alapján előállítja a kolléganő-riportba illesztendő rajz PNG-jét.
 * Elsősorban a már elmentett customer.sketch_svg-t használja (ez a valós, jóváhagyott állapot);
 * ha az valamiért hiányzik, a valódi élő motorral (renderLiveSketchSvg) frissen legenerálja a
 * customer.form_data alapján — soha nem saját, közelítő rajzot rajzolunk.
 */
async function buildColleagueSketchPng(customer) {
  let svg = customer.sketch_svg;
  if (!svg) {
    const formData = JSON.parse(customer.form_data || '{}');
    svg = await renderLiveSketchSvg(formData);
  }
  const svgPl = translateSketchToPolish(svg);
  return renderSketchPngWhiteBlack(svgPl);
}

module.exports = { buildColleagueSketchPng, renderSketchPngWhiteBlack };
