const puppeteer = require('puppeteer');

/**
 * EGYETLEN, MEGOSZTOTT Puppeteer/Chromium böngésző-példány az egész alkalmazáshoz.
 * ---------------------------------------------------------------
 * KORÁBBAN három különböző fájl (liveSketch.js, pdf.js, colleagueSketchExport.js) MINDEGYIKE saját,
 * önálló Chromium-példányt indított — mindhárom teljesen egymástól függetlenül, sosem osztották meg
 * egymással a böngészőt. Egy headless Chromium példány önmagában is 100-300+ MB memóriát foglal, így
 * három egyidejűleg futó példány könnyen túllépte a Render-en beállított memóriakeretet, ami
 * ismétlődő "memóriakorlát túllépve" automatikus újraindításokhoz vezetett.
 *
 * Mostantól MINDEN olyan hely, aminek Puppeteer-re van szüksége, ugyanezt az egyetlen, közösen
 * megosztott böngésző-példányt kéri el innen (getBrowser()) — új lapot (page) nyitnak rajta a saját
 * munkájukhoz, majd bezárják a lapot (nem magát a böngészőt), amikor végeztek. Így egyszerre csak
 * EGY Chromium-folyamat fut, függetlenül attól, hány különböző funkció (élő rajz, PDF, kolléganő-
 * Excel rajza stb.) használja éppen.
 */
let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        // Kis memóriájú szerveren (pl. Render alapcsomag) segítenek csökkenteni a Chromium
        // memóriaigényét — megosztott memória korlátozása és felesleges háttérfolyamatok tiltása.
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
      ],
    });
  }
  return browserPromise;
}

module.exports = { getBrowser };
