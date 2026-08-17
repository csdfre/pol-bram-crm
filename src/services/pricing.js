/**
 * ÁRAZÁSI MOTOR
 * ---------------------------------------------------------------
 * A "Garaż_kalkulator_HU__10.xlsm" (2026-08, "Cennik Garaż" fül) Excel-kalkulátor
 * logikájának JavaScript portja — ez az ÚJ, hivatalos számítási módszer, a korábbi
 * "Garaż_kalkulator_wegry.xlsm"-alapú motor frissítése.
 *
 * Amit LibreOffice-szal, több teszt-konfiguráción (6x6, 8x7 spad_tył, 10x10, 12x10,
 * 20x15 m, különböző magasságokkal) frissen leellenőriztem az ÚJ fájlban:
 *   - Az alapmagasság (213cm) és a magasságfelár %-sávos táblája (19/30/50/80/110/
 *     140/170/200cm -> 10-100%) VÁLTOZATLAN a régihez képest.
 *   - A "spad tył" tetőnél a hosszfüggő alap-magasság (213 + max(0,hossz-5)*5 cm)
 *     VÁLTOZATLAN.
 *   - ÚJ: az alapár mostantól TÉNYLEGESEN méretkategória-függő (typowy/mala/srednia/
 *     duza a 0-50/51-100/101-200/201+ m² sávok szerint) — a régi motor ezzel szemben
 *     mindig "typowy"-t használt egyedi garázsoknál (ez a régi fájlban helyes volt,
 *     de az újban már NEM: az Obliczenia Garaż!A15 függvény ténylegesen vált sávot).
 *   - ÚJ: a "typowy" (2,8m felett) és "mala" (3,3m felett) kategóriáknál külön
 *     "túllépés utáni" alapár-tábla van (Cennik Garaż G:I oszlopok), ami a
 *     magasságfelár %-al EGYÜTT, arra RÁTÉVE érvényesül (LibreOffice-szal igazolva:
 *     6x6m dwuspad RAL, 3,0m magasság -> alapár 353 zł/fm (a 330 helyett) ÉS +50%
 *     felár, N10=12708 zł, pontosan stimmel). A "srednia"/"duza" kategóriáknak
 *     nincs saját túllépés-utáni ártáblája, csak a %-os felár érvényesül rájuk.
 *   - A Rabat (kedvezmény) mező a Cennik-frissítés kérésére MÁR NEM kerül
 *     alkalmazásra a végösszegen (lásd lejjebb) — a backoffice "Árazás" fülén
 *     található beállítás megmarad, csak hatástalan, hogy a régi admin-felület
 *     ne törjön el.
 *   - A "szeregowy" (sorgarázs) árazás a Cennik Garaż K:Q oszlopaiban jelen van,
 *     de a jelenlegi front-end (garazs-igenyles.html) nem gyűjt "rodzaj garażu"
 *     mezőt — csak "pojedyńczy" garázsokat kínál —, ezért ez a motor egyelőre
 *     csak pojedynczy-t számol. Ha kell sorgarázs-támogatás is, azt külön be kell
 *     kötni a front-endbe.
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
// Forrás: Garaż_kalkulator_HU__10.xlsm, "Cennik Garaż" fül, C4:E28 oszlopok (2026-08).
const BASE_PRICE_TABLE_DEFAULT = {
  typowy:  { dwuspad:{OC:283,RAL:330,DREW:353}, spad_tyl:{OC:255,RAL:295,DREW:319}, spad_przod:{OC:290,RAL:335,DREW:358}, spad_bok:{OC:278,RAL:319,DREW:341} },
  mala:    { dwuspad:{OC:433,RAL:491,DREW:524}, spad_tyl:{OC:381,RAL:434,DREW:478}, spad_przod:{OC:428,RAL:486,DREW:519}, spad_bok:{OC:410,RAL:468,DREW:501} },
  srednia: { dwuspad:{OC:578,RAL:647,DREW:671}, spad_tyl:{OC:520,RAL:584,DREW:607}, spad_przod:{OC:584,RAL:653,DREW:676}, spad_bok:{OC:561,RAL:624,DREW:648} },
  duza:    { dwuspad:{OC:728,RAL:774,DREW:797}, spad_tyl:{OC:664,RAL:733,DREW:756}, spad_przod:{OC:733,RAL:780,DREW:803}, spad_bok:{OC:705,RAL:751,DREW:774} },
};

// --- "Túllépés utáni" alapár (zł/fm), csak typowy (2,8m felett) és mala (3,3m felett) kategóriáknál létezik ---
// Forrás: "Cennik Garaż" fül, G4:I14 oszlopok. A srednia/duza kategóriáknak nincs ilyen külön táblája —
// azoknál csak a %-os magasságfelár (lásd HEIGHT_SURCHARGE) érvényesül a fenti alapáron.
const EXCEEDED_PRICE_TABLE_DEFAULT = {
  typowy: { dwuspad:{OC:307,RAL:353,DREW:376}, spad_tyl:{OC:278,RAL:319,DREW:341}, spad_przod:{OC:312,RAL:358,DREW:381}, spad_bok:{OC:301,RAL:341,DREW:365} },
  mala:   { dwuspad:{OC:456,RAL:514,DREW:536}, spad_tyl:{OC:404,RAL:456,DREW:478}, spad_przod:{OC:451,RAL:509,DREW:531}, spad_bok:{OC:433,RAL:491,DREW:513} },
};
// A méretkategóriánkénti "standard magasság" küszöb (méterben) — e fölött lép érvénybe a fenti tábla.
const EXCEED_THRESHOLD_M = { typowy: 2.8, mala: 3.3 };

// --- Kiegészítők árai (zł) ---
// Forrás: "Cennik Garaż" fül, "CENNIK DODATKÓW" blokk (C36:D69), frissítve 2026-08.
const ADDON_DEFAULT = {
  gateSwingPerMb: { OC:190, RAL:225, DREW:311 },     // billenő kapu, zł/fm (Brama uchylna)
  gateDoublePerPc: { OC:350, RAL:450, DREW:550 },    // kétszárnyú kapu, zł/db (Brama dwuskrz) — változatlan
  automation: 1000,                                   // zł/db (Automat, "ZWYKŁY" típus) — változatlan
  // ÚJ, még nincs bekötve a front-endbe: Automat "XL" = 1200 zł/db, "Odblokowanie" (kioldó) = 200 zł/db —
  // ha kell külön automatika-típus választó, ezt be lehet kötni.
  supportPole: 500,                                   // Słup podporowy 3,5m, zł/db — változatlan
  extraLock: 70,                                      // Dodatkowy zamek (extra zár a személyi ajtón), zł/db — változatlan
  doorProfil: { OC:450, RAL:550, DREW:600 },          // Furtka/drzwi profil (személyi ajtó), zł/db — változatlan
  // ÚJ, még nincs bekötve: "Furtka/drzwi kątownik" (szögletes profilon) külön, olcsóbb tétel:
  // OC:300, RAL:400, DREW:450 zł/db — ha a front-end két bejáró-típust különböztet meg, ezt is be kell kötni.
  // FIGYELEM — VÁLTOZOTT LOGIKA: az új árlistában az ablak ára ANYAG szerint differenciált
  // (nem méret szerint, mint korábban). A három méret (80/60, 100/80, 120/100) egy közös tételként
  // szerepel a Cennik-ben, anyagonként: OC:1000, RAL:600, DREW:750 zł/db. Egyeztetni kell, hogy ez
  // rendben van-e a jelenlegi két külön front-end mezőnek (win8060 / win50150) — egyelőre mindkettőre
  // ugyanazt az anyag szerinti árat alkalmazom.
  windowPerPc: { OC:1000, RAL:600, DREW:750 },
  windowOpening: 100,  // Otwór okienny — változatlan, nincs anyagfüggés
  skylight: 200,       // Świetlik / ablakbetét-bevilágító, zł/db — változatlan
  gutterPerMb: 80,     // Orynnowanie komplet, zł/fm — változatlan
  // ÚJ, még nincs bekötve: "Pas rynnowy" (ereszcsatorna-szalag, önmagában, teljes orynnowanie nélkül) = 30 zł/fm
  feltPerM2: 20,       // páralecsapódásgátló filc, zł/m² (tetőfelület) — változatlan
  dividerWallPerMb: 198,           // Ściana działowa — RÉGI: 180 -> ÚJ: 198 zł/fm (blacha OC ár, más szín nincs megadva)
  structureZartprofilPerMb: 70,    // "Mnożnik konstrukcji profilowej" — RÉGI: 65 -> ÚJ: 70 zł
  gateWidthDeviationFlat: 500,       // ha a kapu szélessége eltér a 300 cm alaptól — nincs új adat, változatlan
  gateWideT7SurchargeFlat: 500,      // T7 vízszintes hátra/előre lejtő tetőnél — nincs új adat, változatlan
  canopySolidWallPerMb: 154,         // "Sciana oblachowana" — RÉGI: 140 -> ÚJ: 154 zł/fm
  // "Zadaszenie panelowe" (lamellás/panel fal): RAL/DREW frissítve, OC-re nincs új adat -> régi érték megtartva jelzéssel
  canopyLamellaWallPerMb: { OC: 200 /* nincs új adat, TBD */, RAL: 275, DREW: 385 },
  canopyRoofOpenPerM2: 165,          // "Zadaszenie otwarte" — RÉGI: 150 -> ÚJ: 165 zł/m²
  // ÚJ, még nincs bekötve: "Zadaszenie oblachowane" (borított/oblachowane előtető) = 440 zł/fm — külön tétel,
  // nem keverendő a fenti canopySolidWallPerMb-vel (az a "Sciana oblachowana", fal, nem tető).
};

// --- Magasságfelár tábla (excess cm -> felár %) ---
const HEIGHT_SURCHARGE = [
  [19, 0.10], [30, 0.20], [50, 0.30], [80, 0.40],
  [110, 0.50], [140, 0.60], [170, 0.70], [200, 0.80], [Infinity, 1.00],
];

function bracketOf(m2) {
  // ÚJ (2026-08-i Cennik Garaż fül alapján, LibreOffice-szal frissen leellenőrizve az
  // Obliczenia Garaż!A15 függvénnyel): a méretkategória TÉNYLEGESEN függ az m²-től.
  // A korábbi motorban ez mindig "typowy" volt — az akkori Excel-fájlban ez helyes volt,
  // de az új fájlban már valódi sávok vannak.
  if (m2 > 200) return 'duza';
  if (m2 > 100) return 'srednia';
  if (m2 > 50) return 'mala';
  return 'typowy';
}

// A bracket alapára — typowy/mala esetén a méretkategória saját magasság-küszöbe felett
// (2,8m ill. 3,3m) a "túllépés utáni" táblát kell használni a normál helyett; ez a %-os
// magasságfelárral EGYÜTT, arra ráépülve érvényesül (LibreOffice-szal igazolva).
// BASE_PRICE_TABLE / EXCEEDED_PRICE_TABLE paraméterként jön be, hogy a backoffice-os
// admin-felülírás (loadOverride) is érvényesüljön, ne csak a hardcode-olt alapérték.
function basePricePerMb(BASE_PRICE_TABLE, EXCEEDED_PRICE_TABLE, bracket, roofKey, material, heightM) {
  const threshold = EXCEED_THRESHOLD_M[bracket];
  if (threshold && heightM > threshold && EXCEEDED_PRICE_TABLE[bracket]) {
    const exceededRoof = EXCEEDED_PRICE_TABLE[bracket][roofKey] || EXCEEDED_PRICE_TABLE[bracket].dwuspad;
    return exceededRoof[material];
  }
  const baseRoof = BASE_PRICE_TABLE[bracket][roofKey] || BASE_PRICE_TABLE[bracket].dwuspad;
  return baseRoof[material];
}

function heightSurchargePct(excessCm) {
  if (excessCm <= 0) return 0;
  for (const [limit, pct] of HEIGHT_SURCHARGE) if (excessCm <= limit) return pct;
  return 1.0;
}

// A "felár nélküli" (standard) magasság a tetőtípustól és mérettől függ — a "spad tył" (hátrafelé lejtő)
// tetőnél a hosszúság növekedésével nő az alap-magasság is (5cm-enként 1m hosszúságnövekedésre 5m felett,
// a valós Excel-kalkulátorban ellenőrizve). A többi tetőtípusnál egyelőre fix 213 cm.
function standardHeightCm(roofKey, widthM, lengthM) {
  if (roofKey === 'spad_tyl') {
    return 213 + Math.max(0, lengthM - 5) * 5;
  }
  return 213;
}

// A magasságfelár %-a KÉTSZINTŰ logikával dől el (a valós Excel-kalkulátorban pontosan ellenőrizve):
//  1. Ha a VÁLASZTOTT magasság a fix 213cm-hez képest jelentősen (19cm-nél jobban) magasabb,
//     a fix sávos táblázat (HEIGHT_SURCHARGE) dönt, függetlenül a hossz-függő minimumtól.
//  2. Egyébként (ha a 213+19cm=232cm-es küszöböt nem lépi túl) a hossz-függő MINIMUMHOZ (baselineCm)
//     képest nézzük: ha pontosan annyi, nincs felár; ha afölött van, 10%-os felár jár.
function heightSurchargeCombined(heightCm, baselineCm) {
  const excessFixed = heightCm - 213;
  if (excessFixed > 19) return heightSurchargePct(excessFixed);
  if (heightCm > baselineCm) return 0.10;
  return 0;
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
  const EXCEEDED_PRICE_TABLE = loadOverride('exceeded_price_table', EXCEEDED_PRICE_TABLE_DEFAULT);
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

  // Magasság-felár % — kétszintű logika (lásd heightSurchargeCombined)
  const heightCm = parseHeightCm(formData.height);
  const heightM = heightCm / 100;
  const baselineCm = standardHeightCm(roofKey, widthM, lengthM);
  const heightPct = heightSurchargeCombined(heightCm, baselineCm);

  // Az alapár most már bracket-függő (typowy/mala/srednia/duza), és typowy/mala esetén
  // a saját magasság-küszöb (2,8m / 3,3m) fölött a "túllépés utáni" táblát használja.
  const basePerMb = basePricePerMb(BASE_PRICE_TABLE, EXCEEDED_PRICE_TABLE, bracket, roofKey, material, heightM);

  const basePrice = perimeterMb * basePerMb * (1 + heightPct);
  lines.push(line(`Alapszerkezet (${perimeterMb.toFixed(1)} fm × ${basePerMb} zł/fm${heightPct ? ` + ${(heightPct * 100).toFixed(0)}% magasságfelár` : ''})`, basePrice));

  // Szerkezet típusa (zárt profil felár) — terület (m²) alapján, magasságfelárral együtt
  if (formData.structureType === 'zartprofil') {
    const v = m2 * ADDON.structureZartprofilPerMb * (1 + heightPct);
    lines.push(line('Horganyzott zárt profil felár', v));
  }

  // Kapu(k)
  if (formData.__gateType && formData.__gateType !== 'none' || formData.gateType && formData.gateType !== 'none') {
    const effectiveGateType = formData.__gateType || formData.gateType;
    const gw = parseFloat(formData.gateWidth) || 300;
    const gh = parseFloat(formData.gateHeight) || (effectiveGateType === 'uchylna' ? 185 : 200);
    const count = Math.max(1, parseInt(formData.gateCount) || 1);
    const gateColor = materialFromColor(formData.colorGate);

    const gateBaseline = effectiveGateType === 'uchylna' ? 185 : 200;
    const gateExcessCm = Math.max(0, gh - gateBaseline);
    const gateHeightPct = heightSurchargePct(gateExcessCm);

    if (effectiveGateType === 'uchylna') {
      const v = (gw / 100) * ADDON.gateSwingPerMb[gateColor] * count;
      lines.push(line(`Billenő kapu ×${count} (${gw} cm)`, v));
      if (gateHeightPct > 0) lines.push(line(`Kapu magasságfelár (+${gateExcessCm}cm)`, v * gateHeightPct));
    } else {
      const v = ADDON.gateDoublePerPc[gateColor] * count;
      lines.push(line(`Kétszárnyú kapu ×${count}`, v));
      if (gateHeightPct > 0) lines.push(line(`Kapu magasságfelár (+${gateExcessCm}cm)`, v * gateHeightPct));
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
      const extraLockQty = Math.max(0, parseInt(formData.extraLockQty) || 0);
      if (extraLockQty > 0) {
        lines.push(line(`Extra zár ×${extraLockQty}`, ADDON.extraLock * extraLockQty));
      }
    }
  }

  // Ablakok — ÚJ: a Cennik Garaż szerint az ablak ára anyag (OC/RAL/DREW) szerint differenciált,
  // méret szerint NEM (a 80/60, 100/80, 120/100 méretek egy közös tételként szerepelnek az árlistában).
  // Az anyagot az oldalfal színéből vesszük (ugyanaz a `material`, mint az alapszerkezetnél).
  const win8060 = parseInt(formData.win8060) || 0;
  if (win8060 > 0) lines.push(line(`Ablak 80×60 ×${win8060}`, ADDON.windowPerPc[material] * win8060));

  const win50150 = parseInt(formData.win50150) || 0;
  if (win50150 > 0) lines.push(line(`Ablak 50×150 ×${win50150}`, ADDON.windowPerPc[material] * win50150));

  const winOpening = parseInt(formData.winOpening) || 0;
  if (winOpening > 0) lines.push(line(`Ablaknyílás ×${winOpening}`, ADDON.windowOpening * winOpening));

  const skylight = parseInt(formData.skylight) || 0;
  if (skylight > 0) lines.push(line(`Ablakbetét / bevilágító ×${skylight}`, ADDON.skylight * skylight));

  if (formData.gateLightYes) {
    const qty = Math.max(1, parseInt(formData.gateLightQty) || 1);
    lines.push(line(`Bevilágító a kapun ×${qty}`, ADDON.skylight * qty));
  }

  // Ereszcsatorna
  const supportPoleQty = parseInt(formData.supportPoleQty) || 0;
  if (supportPoleQty > 0) {
    lines.push(line(`Tartóoszlop (3,5m) ×${supportPoleQty}`, ADDON.supportPole * supportPoleQty));
  }

  if (formData.gutterYes) {
    const heightM = heightCm / 100;
    let gutterMbEquivalent = 0;
    if (roofKey === 'spad_tyl' || roofKey === 'spad_przod') {
      gutterMbEquivalent = widthM + heightM + Math.floor(widthM / 7) * heightM;
    } else if (roofKey === 'dwuspad') {
      gutterMbEquivalent = 2 * lengthM + 2 * heightM + 2 * Math.floor(lengthM / 7) * heightM;
    } else { // spad_bok
      gutterMbEquivalent = lengthM + heightM + Math.floor(lengthM / 7) * heightM;
    }
    const gutterCost = Math.floor(gutterMbEquivalent * ADDON.gutterPerMb);
    lines.push(line('Ereszcsatorna', gutterCost));
  }

  // Páralecsapódásgátló filc (a garázs tetőfelülete + az oldaltető teteje, ha van)
  if (formData.feltYes) {
    let feltArea = m2;
    if (formData.canopyYes) {
      const cW = (parseFloat(formData.canopyWidth) || 0) / 100;
      const cL = (parseFloat(formData.canopyLength) || 0) / 100;
      feltArea += cW * cL;
    }
    lines.push(line(`Páralecsapódás-gátló filc (${feltArea.toFixed(1)} m²)`, ADDON.feltPerM2 * feltArea));
  }

  // Válaszfalak — mostantól több válaszfal is megadható (wallCount + wallLength0, wallLength1, ...)
  const wallCount = Math.max(0, parseInt(formData.wallCount) || 0);
  for (let wi = 0; wi < wallCount; wi++) {
    const wallLenM = parseFloat(formData['wallLength' + wi]) || 0;
    if (wallLenM > 0) {
      lines.push(line(`${wi + 1}. válaszfal (${wallLenM} fm)`, ADDON.dividerWallPerMb * wallLenM * (1 + heightPct)));
    }
  }

  // Oldaltető / előtető falak (durva közelítés: hossz alapján, ha van megadva)
  if (formData.canopyYes) {
    const canopyLenM = (parseFloat(formData.canopyLength) || 0) / 100;
    const canopyWidthM = (parseFloat(formData.canopyWidth) || 0) / 100;
    const lamellaRateBack = ADDON.canopyLamellaWallPerMb[materialFromColor(formData.colorCanopyBack)] || ADDON.canopyLamellaWallPerMb.RAL;
    const lamellaRateSide = ADDON.canopyLamellaWallPerMb[materialFromColor(formData.colorCanopySide)] || ADDON.canopyLamellaWallPerMb.RAL;
    if (formData.canopyBackWall === 'solid') lines.push(line('Oldaltető hátsó fala (teli)', ADDON.canopySolidWallPerMb * canopyLenM * (1 + heightPct)));
    if (formData.canopyBackWall === 'lamella') lines.push(line('Oldaltető hátsó fala (lamellás)', lamellaRateBack * canopyLenM * (1 + heightPct)));
    if (formData.canopySideWall === 'solid') lines.push(line('Oldaltető oldalfala (teli)', ADDON.canopySolidWallPerMb * canopyWidthM * (1 + heightPct)));
    if (formData.canopySideWall === 'lamella') lines.push(line('Oldaltető oldalfala (lamellás)', lamellaRateSide * canopyWidthM * (1 + heightPct)));
    if (canopyWidthM > 0 && canopyLenM > 0) {
      lines.push(line(`Oldaltető tetőfedése (${(canopyWidthM*canopyLenM).toFixed(1)} m²)`, ADDON.canopyRoofOpenPerM2 * canopyWidthM * canopyLenM));
    }
  }
  if (formData.ridgeShift) {
    lines.push(line('Eltolt gerincvonal (szintbe futó magasság)', basePrice * 0.1));
  }

  const subtotalPLN = lines.reduce((s, l) => s + l.pln, 0);
  const roundedPLN = round50(subtotalPLN);

  if (roundedPLN !== subtotalPLN) {
    lines.push(line('Kerekítés (50 zł-ra)', roundedPLN - subtotalPLN));
  }

  // Rabat — a Cennik Garaż-frissítés (2026-08) alapján ez MÁR NEM kerül alkalmazásra a végösszegen.
  // A discountPercent-et még kiolvassuk (visszafelé kompatibilitás a backoffice "Árazás" fülével),
  // de a számításban nem használjuk fel — az admin felületen a mező megmarad, csak hatástalan.
  const discountPercent = loadScalarOverride('discount_percent', DISCOUNT_PERCENT_DEFAULT);
  const discountedPLN = roundedPLN;

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
