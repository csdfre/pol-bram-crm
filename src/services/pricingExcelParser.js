/**
 * Excel-kalkulátor beolvasó — a "Garaż_kalkulator_wegry.xlsm" (vagy azonos elrendezésű) fájl
 * PONTOS cellahivatkozásai alapján olvassa ki az árakat (nem találgatással/címke-kereséssel,
 * mert az korábban megbízhatatlannak bizonyult a valós fájlon).
 *
 * FONTOS: ha a fájl elrendezése (melyik lapon, melyik sorban/oszlopban vannak az adatok)
 * jelentősen megváltozik a jövőben, ezt a cellatérképet is frissíteni kell.
 */
const XLSX = require('xlsx');

function getSheet(wb, name){
  return wb.Sheets[name] || null;
}
function cellNum(ws, addr){
  const cell = ws[addr];
  if(!cell) return null;
  const v = cell.v;
  return (typeof v === 'number') ? v : (typeof v === 'string' && !isNaN(parseFloat(v)) ? parseFloat(v) : null);
}

// A "Cennik Garaż" munkalap pontos cellatérképe
const BASE_TABLE_MAP = {
  typowy:  { spad_tyl: 4,  spad_bok: 5,  dwuspad: 6,  spad_przod: 7  },
  mala:    { spad_tyl: 11, spad_bok: 12, dwuspad: 13, spad_przod: 14 },
  srednia: { spad_tyl: 18, spad_bok: 19, dwuspad: 20, spad_przod: 21 },
  duza:    { spad_tyl: 25, spad_bok: 26, dwuspad: 27, spad_przod: 28 },
};
// Oszlopok: C=OC, D=RAL, E=DREW (mindegyik bracketnél ugyanígy)
const MATERIAL_COLS = { OC: 'C', RAL: 'D', DREW: 'E' };

const ADDON_CELL_MAP = {
  gateSwingPerMb:          { OC: 'F40', RAL: 'D40', DREW: 'E40' },
  automation:              { single: 'D42' }, // "ZWYKŁY" / normál
  gateDoublePerPc:         { OC: 'F44', RAL: 'D44', DREW: 'E44' },
  skylight:                { single: 'D46' }, // Świetlik
  doorProfil:              { OC: 'F50', RAL: 'D50', DREW: 'E50' }, // Furtka na profilu
  window8060:              { single: 'D51' }, // Okno 80/60
  window150x50:            { single: 'F51' }, // Okno 120/100
  windowOpening:           { single: 'D52' }, // Otwór okienny
  gutterStripPerMb:        { single: 'D54' }, // Pas rynnowy
  gutterCompletePerMb:     { single: 'D56' }, // Orynnowanie komplet
  dividerWallPerMb:        { single: 'D58' }, // Ściana działowa
  supportPole:             { single: 'D59' }, // Słup podporowy
  canopyPanelRoofRAL:      { single: 'D61' }, // Zadaszenie panelowe RAL
  canopyPanelRoofDREW:     { single: 'E61' },
  canopyOpenPerM2:         { single: 'D63' }, // Zadaszenie otwarte
  canopySheetRoofPerMb:    { single: 'D65' }, // Zadaszenie oblachowane
  canopySolidWallPerMb:    { single: 'G65' }, // Sciana oblachowana
  feltPerM2:               { single: 'D67' }, // Filc na dach
  structureZartprofilPerMb:{ single: 'D69' }, // Mnożnik konstrukcji profilowej
};

function parseWorkbook(buffer){
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = getSheet(wb, 'Cennik Garaż');
  const result = { basePriceTable: {}, addon: {}, foundKeys: [], missingKeys: [] };

  if(!ws){
    result.missingKeys.push('sheet:Cennik Garaż (nem található ilyen nevű munkalap a fájlban)');
    return result;
  }

  // --- Alap árazási tábla ---
  Object.entries(BASE_TABLE_MAP).forEach(([bracketKey, roofRows])=>{
    result.basePriceTable[bracketKey] = {};
    Object.entries(roofRows).forEach(([roofKey, row])=>{
      const entry = {};
      Object.entries(MATERIAL_COLS).forEach(([matKey, col])=>{
        const val = cellNum(ws, col+row);
        if(val!=null) entry[matKey] = val;
      });
      if(Object.keys(entry).length>0){
        result.basePriceTable[bracketKey][roofKey] = entry;
        result.foundKeys.push(`${bracketKey}.${roofKey}`);
      } else {
        result.missingKeys.push(`${bracketKey}.${roofKey}`);
      }
    });
  });

  // --- Kiegészítők ---
  Object.entries(ADDON_CELL_MAP).forEach(([addonKey, cells])=>{
    if(cells.single){
      const val = cellNum(ws, cells.single);
      if(val!=null){ result.addon[addonKey] = val; result.foundKeys.push('addon:'+addonKey); }
      else result.missingKeys.push('addon:'+addonKey);
    } else {
      const entry = {};
      Object.entries(cells).forEach(([matKey, addr])=>{
        const val = cellNum(ws, addr);
        if(val!=null) entry[matKey] = val;
      });
      if(Object.keys(entry).length>0){ result.addon[addonKey] = entry; result.foundKeys.push('addon:'+addonKey); }
      else result.missingKeys.push('addon:'+addonKey);
    }
  });

  // A gutterPerMb-t (amit a jelenlegi árazó motor ténylegesen használ) a "komplett" és "csík" értékek
  // átlagaként adjuk meg, amíg a rendszer nem különbözteti meg a kétféle ereszcsatorna-típust.
  if(result.addon.gutterStripPerMb!=null && result.addon.gutterCompletePerMb!=null){
    result.addon.gutterPerMb = Math.round((result.addon.gutterStripPerMb + result.addon.gutterCompletePerMb)/2);
    result.foundKeys.push('addon:gutterPerMb (átlagolt)');
  }
  // canopyLamellaWallPerMb-re nincs egyértelmű megfelelő tétel ebben a fájlban — ha nem találjuk, a régi/alapérték marad
  if(result.addon.canopyPanelRoofRAL!=null){
    result.addon.canopySolidWallPerMb = result.addon.canopySolidWallPerMb; // változatlan, csak jelezzük, hogy külön van panel-tető ár is
  }

  return result;
}

module.exports = { parseWorkbook };
