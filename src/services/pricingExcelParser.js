/**
 * Excel-kalkulátor beolvasó — a feltöltött .xlsm/.xlsx fájlból megpróbálja kiolvasni
 * az árazási táblát és a kiegészítők árait, felismerhető (lengyel) címkék alapján.
 *
 * FONTOS: ez egy címke-alapú, "legjobb próbálkozás" elemzés, nem garantált 1:1 leképezés —
 * a feltöltés után a backoffice-ban MINDIG mutassuk meg az admin számára az összehasonlítást
 * (régi vs. új érték), és csak jóváhagyás után mentsük el ténylegesen.
 */
const XLSX = require('xlsx');

const BRACKET_LABELS = {
  typowy: ['garaż typowy', 'typowy'],
  mala: ['mała hala', 'mala hala'],
  srednia: ['średnia hala', 'srednia hala'],
  duza: ['duża hala', 'duza hala'],
};
const ROOF_LABELS = {
  dwuspad: ['dwuspad'],
  spad_tyl: ['spad tył', 'spad tyl'],
  spad_przod: ['spad przód', 'spad przod'],
  spad_bok: ['spad bok'],
};
const MATERIAL_LABELS = { OC: ['oc'], RAL: ['ral'], DREW: ['drew'] };

const ADDON_LABELS = {
  automation: ['automatyka'],
  windowOpening: ['otwór okienny', 'otwor okienny'],
  skylight: ['świetlik', 'swietlik'],
  gutterPerMb: ['rynna'],
  feltPerM2: ['filc'],
  dividerWallPerMb: ['ściana działowa', 'sciana dzialowa'],
  structureZartprofilPerMb: ['mnożnik konstrukcji profilowej', 'mnoznik konstrukcji profilowej'],
  window8060: ['okno', '80/60'],
  window150x50: ['120/100'],
};

function normalize(s){
  return String(s || '').toLowerCase().trim();
}

function cellsToGrid(worksheet){
  return XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
}

function findFirstNumberNear(grid, r, c, radius=4){
  // Jobbra és lefelé keresünk a legközelebbi számértékig, a megadott sugárban
  for(let dc=1; dc<=radius; dc++){
    const v = grid[r] && grid[r][c+dc];
    if(typeof v === 'number') return v;
  }
  for(let dr=1; dr<=radius; dr++){
    const v = grid[r+dr] && grid[r+dr][c];
    if(typeof v === 'number') return v;
  }
  return null;
}

function findLabelCell(grid, labels){
  for(let r=0;r<grid.length;r++){
    for(let c=0;c<(grid[r]?grid[r].length:0);c++){
      const v = normalize(grid[r][c]);
      if(labels.some(l => v.includes(l))) return { r, c };
    }
  }
  return null;
}

function parseWorkbook(buffer){
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const result = { basePriceTable: {}, addon: {}, foundKeys: [], missingKeys: [] };

  // Minden munkalapot egy közös rácsba fésülünk (a legtöbb ilyen kalkulátor egy lapon van, de több lapot is átnézünk)
  let combinedGrid = [];
  wb.SheetNames.forEach(name=>{
    const grid = cellsToGrid(wb.Sheets[name]);
    combinedGrid = combinedGrid.concat(grid);
  });

  // --- Alap árazási tábla: bracket x tetőtípus x anyag ---
  Object.keys(BRACKET_LABELS).forEach(bracketKey=>{
    const bracketCell = findLabelCell(combinedGrid, BRACKET_LABELS[bracketKey]);
    if(!bracketCell) { result.missingKeys.push('bracket:'+bracketKey); return; }
    result.basePriceTable[bracketKey] = {};
    Object.keys(ROOF_LABELS).forEach(roofKey=>{
      // A tetőtípus címkéjét a bracket cellája környékén (kb. 15 soron belül) keressük
      let roofCell = null;
      for(let r=bracketCell.r; r<Math.min(bracketCell.r+15, combinedGrid.length); r++){
        for(let c=0;c<(combinedGrid[r]?combinedGrid[r].length:0);c++){
          const v = normalize(combinedGrid[r][c]);
          if(ROOF_LABELS[roofKey].some(l=>v.includes(l))){ roofCell = {r,c}; break; }
        }
        if(roofCell) break;
      }
      if(!roofCell) return;
      result.basePriceTable[bracketKey][roofKey] = {};
      Object.keys(MATERIAL_LABELS).forEach(matKey=>{
        // Az anyag (OC/RAL/DREW) fejlécét a roofCell sorában/közelében keressük, majd az alatta lévő számot vesszük
        for(let c=Math.max(0,roofCell.c-2); c<roofCell.c+8; c++){
          const v = normalize(combinedGrid[roofCell.r] ? combinedGrid[roofCell.r][c] : '');
          if(MATERIAL_LABELS[matKey].some(l=>v===l || v.includes(l))){
            const num = findFirstNumberNear(combinedGrid, roofCell.r, c, 3);
            if(num!=null) result.basePriceTable[bracketKey][roofKey][matKey] = num;
          }
        }
      });
      if(Object.keys(result.basePriceTable[bracketKey][roofKey]).length===0){
        delete result.basePriceTable[bracketKey][roofKey];
      } else {
        result.foundKeys.push(`${bracketKey}.${roofKey}`);
      }
    });
  });

  // --- Kiegészítők ---
  Object.keys(ADDON_LABELS).forEach(addonKey=>{
    const cell = findLabelCell(combinedGrid, ADDON_LABELS[addonKey]);
    if(!cell){ result.missingKeys.push('addon:'+addonKey); return; }
    const num = findFirstNumberNear(combinedGrid, cell.r, cell.c, 5);
    if(num!=null){ result.addon[addonKey] = num; result.foundKeys.push('addon:'+addonKey); }
    else result.missingKeys.push('addon:'+addonKey);
  });

  return result;
}

module.exports = { parseWorkbook };
