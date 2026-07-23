/**
 * ÁRAZÁSI MOTOR
 * ---------------------------------------------------------------
 * A "Garaż_kalkulator_wegry.xlsm" Excel-kalkulátor logikájának JavaScript portja.
 *
 * FONTOS: ez egy közelítő újraépítés az Excel-ből kinyert adatok alapján.
 * Éles használat előtt FELTÉTLENÜL egyeztessétek néhány konkrét, valós
 * példán (pl. 3 db teszt-konfiguráció) a ténylegesen elvárt Excel-eredménnyel,
 * és ha eltérés van, itt kell finomhangolni a számokat / képleteket.
 *
 * Minden alap-ár PLN-ben van megadva (ahogy az Excelben), a végén egyetlen
 * árfolyammal (PLN_TO_HUF) váltjuk át forintra. Az árfolyamot érdemes
 * időnként frissíteni (lásd .env: PLN_TO_HUF_RATE, ha be van állítva felülírja ezt).
 */

const PLN_TO_HUF = parseFloat(process.env.PLN_TO_HUF_RATE) || (100 / 1.2036); // ≈ 83.08 Ft / zł
const VAT_RATE = parseFloat(process.env.VAT_RATE) || 0.27; // magyar áfa, alapértelmezett 27%

let dbRef = null;
function getDb(){
  if(!dbRef) dbRef = require('../../db');
  return dbRef;
}
// Ha a backoffice-ban feltöltött Excel alapján van mentett felülírás, azt EGYESÍTJÜK (nem cseréljük le teljesen)
// a hardcode-olt alapértékekkel — így egy részleges/hiányos felülírás sem tör el semmit.
function deepMerge(base, override){
  if(!override) return base;
  const result = Array.isArray(base) ? [...base] : { ...base };
  Object.keys(override).forEach(k=>{
    if(override[k] && typeof override[k]==='object' && !Array.isArray(override[k]) && base[k] && typeof base[k]==='object'){
      result[k] = deepMerge(base[k], override[k]);
    } else {
      result[k] = override[k];
    }
  });
  return result;
}
function loadOverride(key, fallback){
  try{
    const row = getDb().prepare('SELECT config_json FROM pricing_config WHERE config_key = ?').get(key);
    if(row) return deepMerge(fallback, JSON.parse(row.config_json));
  } catch(e){ /* nincs felülírás — mehet az alapérték */ }
  return fallback;
}

// --- Alap szerkezeti ár (zł / folyóméter) bracket x tetőtípus x anyag szerint ---
const BASE_PRICE_TABLE_DEFAULT = {
  typowy:  { dwuspad:{OC:258,RAL:300,DREW:321}, spad_tyl:{OC:232,RAL:269,DREW:290}, spad_przod:{OC:264,RAL:305,DREW:326}, spad_bok:{OC:253,RAL:290,DREW:310} },
  mala:    { dwuspad:{OC:394,RAL:447,DREW:477}, spad_tyl:{OC:347,RAL:395,DREW:435}, spad_przod:{OC:389,RAL:442,DREW:472}, spad_bok:{OC:373,RAL:426,DREW:456} },
  srednia: { dwuspad:{OC:526,RAL:589,DREW:610}, spad_tyl:{OC:473,RAL:531,DREW:552}, spad_przod:{OC:531,RAL:594,DREW:615}, spad_bok:{OC:510,RAL:568,DREW:589} },
  duza:    { dwuspad:{OC:662,RAL:704,DREW:725}, spad_tyl:{OC:604,RAL:667,DREW:688}, spad_przod:{OC:667,RAL:709,DREW:730}, spad_bok:{OC:641,RAL:683,DREW:704} },
};

// --- Kiegészítők árai (zł) ---
const ADDON_DEFAULT = {
  gateSwingPerMb: { OC:173, RAL:205, DREW:283 },     // billenő kapu, zł/fm
  gateDoublePerPc: { OC:350, RAL:450, DREW:550 },    // kétszárnyú kapu, zł/db
  automation: 1000,                                   // zł/db
  doorProfil: { OC:450, RAL:550, DREW:600 },          // személyi ajtó (Furtka/drzwi profil), zł/db
  window8060: 500,
  window150x50: 1000, // Okno 120/100 tétel alapján
  windowOpening: 100,
  skylight: 200,       // Świetlik / ablakbetét-bevilágító, zł/db
  gutterPerMb: 55,     // átlagos (csík/komplett között), zł/fm
  feltPerM2: 20,       // páralecsapódásgátló filc, zł/m² (tetőfelület)
  dividerWallPerMb: 180,
  structureZartprofilPerMb: 65,
  gateWidthDeviationFlat: 500,       // ha a kapu szélessége eltér a 300 cm alaptól
  gateWideT7SurchargeFlat: 500,      // T7 vízszintes hátra/előre lejtő tetőnél
  canopySolidWallPerMb: 140,         // oldaltető/előtető teli fala, zł/fm (közelítés)
  canopyLamellaWallPerMb: 100,       // lamellás fal, zł/fm (közelítés)
};

// --- Magasságfelár tábla (excess cm -> felár %) ---
const HEIGHT_SURCHARGE = [
  [19, 0.10], [30, 0.20], [50, 0.30], [80, 0.40],
  [110, 0.50], [140, 0.60], [170, 0.70], [200, 0.80], [Infinity, 1.00],
];

function bracketOf(m2) {
  if (m2 <= 50) return 'typowy';
  if (m2 <= 100) return 'mala';
  if (m2 <= 200) return 'srednia';
  return 'duza';
}

function heightSurchargePct(excessCm) {
  if (excessCm <= 0) return 0;
  for (const [limit, pct] of HEIGHT_SURCHARGE) if (excessCm <= limit) return pct;
  return 1.0;
}

function loadScalarOverride(key, fallback){
  try{
    const row = getDb().prepare('SELECT config_json FROM pricing_config WHERE config_key = ?').get(key);
    if(row){
      const val = JSON.parse(row.config_json);
      return (typeof val === 'number') ? val : fallback;
    }
  } catch(e){ /* nincs felülírás */ }
  return fallback;
}
const DISCOUNT_PERCENT_DEFAULT = 10; // Rabat — alapértelmezetten -10%, a backoffice Árazás fülén 1-10% között állítható

function round50(v) {
  return Math.ceil(v / 50) * 50;
}
function roundUpTo10000(v){
  return Math.ceil(v/10000)*10000;
}

/**
 * A form_data (a customer form JSON állapota) alapján kiszámolja az árat.
 * Visszaad egy { totalPLN, totalHUF, lines: [{label, pln, huf}], warnings: [] } objektumot.
 */
function calculateQuote(formData) {
  const lines = [];
  const warnings = [];
  const BASE_PRICE_TABLE = loadOverride('base_price_table', BASE_PRICE_TABLE_DEFAULT);
  const ADDON = loadOverride('addon', ADDON_DEFAULT);

  const widthCm = parseFloat(formData.width) || 0;
  const lengthCm = parseFloat(formData.length) || 0;
  const widthM = widthCm / 100;
  const lengthM = lengthCm / 100;
  const m2 = widthM * lengthM;
  const perimeterMb = 2 * (widthM + lengthM);
  const bracket = bracketOf(m2);

  // Roof key normalizálás (a frontend 'spad jobbra'/'spad balra' értékeket használ, itt spad_bok-ként kezeljük)
  const roofRaw = formData.roofType || 'dwuspad';
  const roofKey = (roofRaw === 'spad jobbra' || roofRaw === 'spad balra') ? 'spad_bok'
    : (roofRaw === 'spad tyl') ? 'spad_tyl'
    : (roofRaw === 'spad przod') ? 'spad_przod'
    : 'dwuspad';

  // Anyag/materiál: az OLDALFAL színkategóriája határozza meg (horganyzott->OC, ral->RAL, fa->DREW)
  const material = materialFromColor(formData.colorWall);

  const basePerMb = (BASE_PRICE_TABLE[bracket][roofKey] || BASE_PRICE_TABLE[bracket].dwuspad)[material];

  // Magasság-felár %
  const heightCm = parseHeightCm(formData.height);
  const excessCm = Math.max(0, heightCm - 213);
  const heightPct = heightSurchargePct(excessCm);

  const basePrice = perimeterMb * basePerMb * (1 + heightPct);
  lines.push(line(`Alapszerkezet (${perimeterMb.toFixed(1)} fm × ${basePerMb} zł/fm${heightPct ? ` + ${(heightPct * 100).toFixed(0)}% magasságfelár` : ''})`, basePrice));

  // Szerkezet típusa (zárt profil felár)
  if (formData.structureType === 'zartprofil') {
    const v = perimeterMb * ADDON.structureZartprofilPerMb;
    lines.push(line('Horganyzott zárt profil felár', v));
  }

  // Kapu(k)
  if (formData.__gateType && formData.__gateType !== 'none' || formData.gateType && formData.gateType !== 'none') {
    const effectiveGateType = formData.__gateType || formData.gateType;
    const gw = parseFloat(formData.gateWidth) || 300;
    const gh = parseFloat(formData.gateHeight) || (effectiveGateType === 'uchylna' ? 185 : 200);
    const count = Math.max(1, parseInt(formData.gateCount) || 1);
    const gateColor = materialFromColor(formData.colorGate);

    if (effectiveGateType === 'uchylna') {
      const v = (gw / 100) * ADDON.gateSwingPerMb[gateColor] * count;
      lines.push(line(`Billenő kapu ×${count} (${gw} cm)`, v));
    } else {
      const v = ADDON.gateDoublePerPc[gateColor] * count;
      lines.push(line(`Kétszárnyú kapu ×${count}`, v));
    }

    if (gw !== 300) {
      lines.push(line('Kapu szélesség eltérés felár (300 cm alaptól)', ADDON.gateWidthDeviationFlat * count));
    }
    if (formData.wallPattern === 'T7 – vízszintes' && (roofKey === 'spad_tyl' || roofKey === 'spad_przod')) {
      lines.push(line('T7 vízszintes minta felár (hátra/előre lejtő tetőnél)', ADDON.gateWideT7SurchargeFlat));
    }

    if (formData.automation) {
      const qty = Math.max(1, parseInt(formData.automationQty) || 1);
      lines.push(line(`Kapuautomatika ×${qty}`, ADDON.automation * qty));
    }
  }

  // Személyi bejáró(k)
  if (formData.personalDoorYes) {
    const count = Math.max(0, parseInt(formData.personalDoorCount) || 0);
    const doorColor = materialFromColor(formData.colorDoor);
    if (count > 0) {
      lines.push(line(`Személyi ajtó ×${count}`, ADDON.doorProfil[doorColor] * count));
    }
  }

  // Ablakok
  const win8060 = parseInt(formData.win8060) || 0;
  if (win8060 > 0) lines.push(line(`Bukó ablak 80×60 ×${win8060}`, ADDON.window8060 * win8060));

  const win50150 = parseInt(formData.win50150) || 0;
  if (win50150 > 0) lines.push(line(`Fix ablak 150×50 ×${win50150}`, ADDON.window150x50 * win50150));

  const winOpening = parseInt(formData.winOpening) || 0;
  if (winOpening > 0) lines.push(line(`Ablaknyílás ×${winOpening}`, ADDON.windowOpening * winOpening));

  const skylight = parseInt(formData.skylight) || 0;
  if (skylight > 0) lines.push(line(`Ablakbetét / bevilágító ×${skylight}`, ADDON.skylight * skylight));

  if (formData.gateLightYes) {
    const qty = Math.max(1, parseInt(formData.gateLightQty) || 1);
    lines.push(line(`Bevilágító a kapun ×${qty}`, ADDON.skylight * qty));
  }

  // Ereszcsatorna
  if (formData.gutterYes) {
    lines.push(line('Ereszcsatorna', ADDON.gutterPerMb * perimeterMb));
  }

  // Páralecsapódásgátló filc (tetőfelület alapján, közelítőleg = alapterület)
  if (formData.feltYes) {
    lines.push(line('Páralecsapódás-gátló filc', ADDON.feltPerM2 * m2));
  }

  // Válaszfal
  if (formData.wallYes) {
    const wallLenM = parseFloat(formData.wallLength) || 0;
    if (wallLenM > 0) lines.push(line(`Válaszfal (${wallLenM} fm)`, ADDON.dividerWallPerMb * wallLenM));
  }

  // Oldaltető / előtető falak (durva közelítés: hossz alapján, ha van megadva)
  if (formData.canopyYes) {
    const canopyLenM = (parseFloat(formData.canopyLength) || 0) / 100;
    if (formData.canopyBackWall === 'solid') lines.push(line('Oldaltető hátsó fala (teli)', ADDON.canopySolidWallPerMb * canopyLenM));
    if (formData.canopyBackWall === 'lamella') lines.push(line('Oldaltető hátsó fala (lamellás)', ADDON.canopyLamellaWallPerMb * canopyLenM));
    if (formData.canopySideWall === 'solid') lines.push(line('Oldaltető oldalfala (teli)', ADDON.canopySolidWallPerMb * canopyLenM));
    if (formData.canopySideWall === 'lamella') lines.push(line('Oldaltető oldalfala (lamellás)', ADDON.canopyLamellaWallPerMb * canopyLenM));
  }

  const subtotalPLN = lines.reduce((s, l) => s + l.pln, 0);
  const roundedPLN = round50(subtotalPLN);

  if (roundedPLN !== subtotalPLN) {
    lines.push(line('Kerekítés (50 zł-ra)', roundedPLN - subtotalPLN));
  }

  const discountPercent = loadScalarOverride('discount_percent', DISCOUNT_PERCENT_DEFAULT);
  const discountedPLN = roundedPLN * (1 - discountPercent/100);

  const totalHUFRaw = discountedPLN * PLN_TO_HUF; // ez a nettó összeg (kedvezmény után), kerekítés előtt
  const totalHUF = roundUpTo10000(totalHUFRaw); // felfelé kerekítve, hogy az utolsó 4 számjegy 0 legyen
  const totalHUFGross = roundUpTo10000(totalHUF * (1 + VAT_RATE));
  const vatRequested = !!(formData.custInvoice === 'igen' || formData.vat_requested);

  return {
    totalPLN: roundedPLN,
    totalHUF,        // nettó (kedvezménnyel, felfelé kerekítve)
    totalHUFGross,   // bruttó (nettó + áfa, felfelé kerekítve)
    discountPercent,
    vatRate: VAT_RATE,
    vatRequested,
    displayTotal: vatRequested ? totalHUF : totalHUFGross,
    displayLabel: vatRequested ? 'nettó' : 'bruttó',
    exchangeRate: PLN_TO_HUF,
    lines: lines.map(l => ({ label: l.label, pln: Math.round(l.pln), huf: Math.round(l.pln * PLN_TO_HUF) })),
    warnings,
    meta: { m2: Math.round(m2 * 100) / 100, perimeterMb: Math.round(perimeterMb * 100) / 100, bracket, roofKey, material, heightCm, heightPct },
  };
}

function line(label, pln) {
  return { label, pln };
}

function materialFromColor(colorCode) {
  if (!colorCode) return 'OC';
  if (colorCode === 'OCNATUR') return 'OC';
  if (colorCode.startsWith('RAL')) return 'RAL';
  return 'DREW'; // OAK, WALNUT, WINCH, GOLDOAK, stb.
}

function parseHeightCm(heightVal) {
  if (!heightVal) return 213;
  const n = parseFloat(String(heightVal).replace(/[^\d.]/g, ''));
  return isNaN(n) ? 213 : n;
}

module.exports = { calculateQuote, loadScalarOverride, DISCOUNT_PERCENT_DEFAULT };
