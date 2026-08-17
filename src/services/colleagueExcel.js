const path = require('path');
const ExcelJS = require('exceljs');
const { buildOrderFields } = require('./pdf');
const { buildColleagueSketchPng } = require('./colleagueSketchExport');

const TEMPLATE_PATH = path.join(__dirname, '..', '..', 'templates', 'colleague_report_template.xlsx');

// --- Segédfüggvények a buildOrderFields (pdf.js) kimenetének kiolvasásához -----------------
// A buildOrderFields(fd, 'pl', false, null) a valós, karbantartott HU/PL fordítási szótárak
// alapján adja vissza a szekciókra bontott, lengyelre fordított mezőket — ugyanaz a forrás,
// amit a kolléganő-oldal és a PL PDF is használ, tehát a fordítás garantáltan konzisztens.
function findSection(sections, name) {
  return sections.find((s) => s.section === name);
}
function val(section, label, fallback) {
  if (!section) return fallback;
  const item = section.items.find((i) => i.label === label);
  return item ? item.value : fallback;
}
function unitVal(section, index, suffix, fallback) {
  if (!section) return fallback;
  const label = `${index + 1}. ${suffix}`;
  const item = section.items.find((i) => i.label === label);
  return item ? item.value : fallback;
}

function buildFurtkaText(sections) {
  const doorSection = findSection(sections, 'Drzwi wejściowe');
  if (!doorSection || doorSection.isEmpty) return 'brak';
  const size = val(doorSection, 'Rozmiar', '90x200');
  const color = val(doorSection, 'Kolor', '—');
  const pattern = val(doorSection, 'Wzór', '—');
  const count = parseInt(val(doorSection, 'Ilość (szt.)', 1), 10) || 1;
  const lines = [];
  for (let i = 0; i < count; i++) {
    const wall = unitVal(doorSection, i, 'ściana', '—');
    const corner = unitVal(doorSection, i, 'róg', '—');
    const dist = unitVal(doorSection, i, 'odległość (cm)', '—');
    const handle = unitVal(doorSection, i, 'strona klamki', 'Lewa strona');
    // A "kilincs oldala" a KEZELŐ oldalát jelöli — a nyitásirány ennek fizikailag az ellentettje.
    const opensLeft = /prawa/i.test(handle);
    const openDir = opensLeft ? 'lewa (klamka po prawej)' : 'prawa (klamka po lewej)';
    const prefix = count > 1 ? `${i + 1}) ` : '';
    lines.push(`${prefix}${size} / ${color} / ${pattern} / na ${wall}, ${dist} cm ${corner} — otwiera się w ${openDir}`);
  }
  return lines.join('\n');
}

function buildOknoText(sections) {
  const lines = [];
  const tiltSection = findSection(sections, 'Okno uchylne (80×60)');
  const sharedColor = tiltSection ? val(tiltSection, 'Kolor', '—') : '—';
  if (tiltSection && !tiltSection.isEmpty) {
    const count = parseInt(val(tiltSection, 'Ilość (szt.)', 1), 10) || 1;
    for (let i = 0; i < count; i++) {
      const wall = unitVal(tiltSection, i, 'ściana', '—');
      const corner = unitVal(tiltSection, i, 'róg', '—');
      const dist = unitVal(tiltSection, i, 'odległość (cm)', '—');
      lines.push(`Uchylne 80x60${count > 1 ? ` ${i + 1})` : ''} — na ${wall}, ${dist} cm ${corner} / ${sharedColor}`);
    }
  }
  const fixSection = findSection(sections, 'Okno stałe 50×150');
  if (fixSection && !fixSection.isEmpty) {
    const count = parseInt(val(fixSection, 'Ilość (szt.)', 1), 10) || 1;
    for (let i = 0; i < count; i++) {
      const wall = unitVal(fixSection, i, 'ściana', '—');
      const corner = unitVal(fixSection, i, 'róg', '—');
      const dist = unitVal(fixSection, i, 'odległość (cm)', '—');
      lines.push(`Stałe 50x150${count > 1 ? ` ${i + 1})` : ''} — na ${wall}, ${dist} cm ${corner} / ${sharedColor}`);
    }
  }
  return lines.length ? lines.join('\n') : 'brak';
}

function buildBramaText(sections) {
  const gateSection = findSection(sections, 'Brama garażowa');
  if (!gateSection || gateSection.isEmpty) return 'brak';
  const color = val(gateSection, 'Kolor bramy', '—');
  const pattern = val(gateSection, 'Profil trapezu bramy', '—');
  const type = val(gateSection, 'Typ bramy', '—');
  const count = parseInt(val(gateSection, 'Ilość bram (szt.)', 1), 10) || 1;
  const width = val(gateSection, 'Szerokość bramy', '300 cm');
  const placementMode = val(gateSection, 'Umiejscowienie bram(y)', '—');
  const lines = [`${color} / ${pattern} / ${type} x${count} (${width}) / ${placementMode}`];
  if (/własna/i.test(placementMode)) {
    for (let i = 0; i < count; i++) {
      const corner = unitVal(gateSection, i, 'brama — od której ściany', '—');
      const dist = unitVal(gateSection, i, 'brama — odległość (cm)', '—');
      lines.push(`  ${i + 1}. brama: ${dist} cm ${corner}`);
    }
  }
  const autoSection = findSection(sections, 'Automatyka bramy');
  if (autoSection && !autoSection.isEmpty) {
    const qty = val(autoSection, 'Ilość automatyki (szt.)', 1);
    lines.push(`Automatyka bramy: tak (${qty} szt.)`);
  }
  return lines.join('\n');
}

function buildDachText(sections) {
  const roofSection = findSection(sections, 'Dach');
  const color = val(roofSection, 'Kolor blachy dachowej', '—');
  const type = val(roofSection, 'Typ dachu', '—');
  return `${color} + okucia dachowe / ${type}`;
}

function buildScianyText(sections) {
  const wallSection = findSection(sections, 'Ściany boczne');
  const color = val(wallSection, 'Kolor ścian', '—');
  const pattern = val(wallSection, 'Wzór blachy', '—');
  return `${color} + okucia boczne - ${pattern}`;
}

function buildWiataText(sections) {
  const canopySection = findSection(sections, 'Wiata / zadaszenie boczne');
  if (!canopySection || canopySection.isEmpty) return 'brak';
  const w = val(canopySection, 'Szerokość', '—');
  const l = val(canopySection, 'Długość', '—');
  return `${w} x ${l}`;
}

function buildFilcRynnyText(sections) {
  const gutterSection = findSection(sections, 'Rynna');
  const feltSection = findSection(sections, 'Filc antykondensacyjny');
  const gutterOn = gutterSection && !gutterSection.isEmpty;
  const feltOn = feltSection && !feltSection.isEmpty;
  const gutterColor = gutterOn ? val(gutterSection, 'Kolor', '') : '';
  const parts = [
    `filc - ${feltOn ? 'tak' : 'nie'}`,
    `rynny - ${gutterOn ? `tak${gutterColor ? ' (' + gutterColor + ')' : ''}` : 'nie'}`,
  ];
  return parts.join(', ');
}

function buildStructureNote(sections) {
  const structSection = findSection(sections, 'Konstrukcja');
  const type = val(structSection, 'Typ', 'Ocynkowany kątownik');
  const poles = val(structSection, 'Słupy podporowe 3,5m (szt.)', 0);
  let note = `Konstrukcja ${String(type).toLowerCase()}`;
  if (poles && Number(poles) > 0) note += ` (słupy podporowe 3,5m x${poles})`;
  return note;
}

/**
 * A válaszfalak (helyt takarékosan, tömören, walanként egy sorban) — mivel a sablonban nincs
 * külön erre fenntartott sor, a "Dodatkowe informacje" jegyzet-sávba kerül be, csak ha ténylegesen
 * van kért válaszfal (üresen nem foglal helyet).
 */
function buildWallsDividerNote(sections) {
  const wallsSection = findSection(sections, 'Ściany działowe');
  if (!wallsSection || wallsSection.isEmpty) return '';
  // A wallCount-ot magukból az items-ekből vezetjük le: minden egység 8-9 mezőt ad (lásd pdf.js
  // placementRows-szerű felépítés a wallItems-nél) — egyszerűbb, ha az egyedi "Kierunek" mezők
  // számából számoljuk ki, hány válaszfal-egység van ténylegesen kitöltve.
  const count = wallsSection.items.filter((i) => /^\d+\. Kierunek$/.test(i.label)).length || 1;
  const lines = ['Ściany działowe:'];
  for (let i = 0; i < count; i++) {
    const dir = unitVal(wallsSection, i, 'Kierunek', '—');
    const len = unitVal(wallsSection, i, 'Długość (mb)', '—');
    const corner = unitVal(wallsSection, i, 'Mierzone od', '—');
    const pos = unitVal(wallsSection, i, 'Odległość (cm)', '—');
    const openType = unitVal(wallsSection, i, 'W ścianie', 'Brak (pełna ściana)');
    let openingDetail = '';
    if (/drzwi/i.test(openType)) {
      const doorSize = unitVal(wallsSection, i, 'Rozmiar drzwi', '90x200');
      const handleSide = unitVal(wallsSection, i, 'Strona otwierania', '—');
      openingDetail = `, drzwi ${doorSize} (${handleSide})`;
    } else if (/otwór/i.test(openType)) {
      const openWidth = unitVal(wallsSection, i, 'Szerokość otworu (cm)', 90);
      openingDetail = `, wolny otwór ${openWidth} cm`;
    }
    lines.push(`  ${i + 1}) ${dir}, ${len} mb, ${pos} cm ${corner}${openingDetail}`);
  }
  return lines.join('\n');
}

/**
 * Cégadatok (áfás számlához), ha az ügyfél ezt kérte — szintén a jegyzet-sávba, tömören.
 */
function buildInvoiceNote(sections) {
  const companySection = findSection(sections, 'Dane firmy (do faktury VAT)');
  if (!companySection) return '';
  const name = val(companySection, 'Nazwa firmy', '');
  if (!name || name === '—') return '';
  const vat = val(companySection, 'NIP UE', '—');
  const addr = val(companySection, 'Adres firmy', '—');
  const shipping = val(companySection, 'Adres dostawy (jeśli inny)', '—');
  let note = `Faktura VAT: ${name}, NIP: ${vat}, adres: ${addr}`;
  if (shipping && shipping !== '—') note += `, dostawa: ${shipping}`;
  return note;
}

/**
 * Az összes cellaszélesség (F:N) pixelben — ehhez igazítjuk a beillesztett rajz szélességét,
 * hogy pontosan a táblázat alá, azzal egyező szélességben kerüljön be.
 */
function tableWidthPx(worksheet) {
  const cols = ['F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'];
  return cols.reduce((sum, letter) => {
    const col = worksheet.getColumn(letter);
    const width = col.width || 10;
    return sum + (width * 7 + 5);
  }, 0);
}

/**
 * Egy cellába több sornyi szöveget ír (word-wrap engedélyezve), és szükség esetén megnöveli a
 * sor magasságát, hogy nyomtatáskor semmi ne vágódjon le. A meglévő egyéb stílust (font, border)
 * nem érinti, csak az igazítást.
 */
function setWrappedCell(ws, cellRef, rowNum, text) {
  const cell = ws.getCell(cellRef);
  cell.value = text;
  cell.alignment = { ...(cell.alignment || {}), wrapText: true, vertical: 'top' };
  const lineCount = String(text).split('\n').length;
  // 16pt/sor + kis puffer — a 15pt-os szoros számítás egyes megjelenítőknél (pl. LibreOffice PDF
  // export) az utolsó sort levágta, mert a tényleges betűméret+sorköz kicsit több helyet igényel.
  const neededHeight = Math.max(15, lineCount * 20 + 6);
  const row = ws.getRow(rowNum);
  if (!row.height || row.height < neededHeight) row.height = neededHeight;
}

async function buildColleagueReportBuffer(customer) {
  const fd = customer.form_data ? JSON.parse(customer.form_data) : {};
  const quote = customer.price_breakdown ? JSON.parse(customer.price_breakdown) : null;
  const sections = buildOrderFields(fd, 'pl', false, null);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(TEMPLATE_PATH);
  const ws = workbook.worksheets[0];

  ws.getCell('G4').value = `${customer.name || ''} tel. ${customer.phone || ''}, mail: ${customer.email || ''}`;
  ws.getCell('G5').value = `${customer.address || ''}, ${customer.zip || ''}, ${customer.city || ''}`;
  if (quote) {
    const total = Math.round(quote.displayTotal);
    const advance = Math.round((total * 0.3) / 100) * 100;
    ws.getCell('M4').value = `${total.toLocaleString('pl-PL')} ft `;
    ws.getCell('M5').value = `zal ${advance.toLocaleString('pl-PL')}`;
  }

  const widthM = (parseFloat(fd.width) || 0) / 100;
  const lengthM = (parseFloat(fd.length) || 0) / 100;
  ws.getCell('H6').value = `${widthM} x ${lengthM}`;
  ws.getCell('H7').value = buildWiataText(sections);
  ws.getCell('H8').value = buildDachText(sections);
  ws.getCell('H9').value = buildScianyText(sections);
  setWrappedCell(ws, 'H10', 10, buildBramaText(sections));
  setWrappedCell(ws, 'H11', 11, buildFurtkaText(sections));
  setWrappedCell(ws, 'H13', 13, buildOknoText(sections));
  ws.getCell('H14').value = 'tak';
  ws.getCell('H15').value = buildFilcRynnyText(sections);

  // "Dodatkowe informacje" jegyzet-sáv: szerkezet mindig, + válaszfalak/cégadatok CSAK ha vannak —
  // így helytakarékos marad (nem foglal helyet olyan szekció, amit az ügyfél nem kért).
  const noteLines = [buildStructureNote(sections)];
  const wallsNote = buildWallsDividerNote(sections);
  if (wallsNote) noteLines.push(wallsNote);
  const invoiceNote = buildInvoiceNote(sections);
  if (invoiceNote) noteLines.push(invoiceNote);
  setWrappedCell(ws, 'F19', 19, noteLines.join('\n'));

  // --- Rajz: a valós rendszer-motor (customer.sketch_svg / renderLiveSketchSvg) alapján ---
  const targetWidthPx = tableWidthPx(ws);
  const { buffer: pngBuffer, cssWidthPx, cssHeightPx } = await buildColleagueSketchPng(customer);
  const imageId = workbook.addImage({ buffer: pngBuffer, extension: 'png' });
  const scaledHeight = (cssHeightPx / cssWidthPx) * targetWidthPx;

  // --- Nyomtatási beállítás: az egész riport (táblázat + rajz) egyetlen álló A4 lapra férjen ki ---
  // Minden érintett sor magasságát EXPLICIT módon, saját magunk állítjuk be (nem az Excel
  // alapértelmezésére hagyatkozunk), így a szükséges sorok száma egzaktul, nem becsléssel
  // számolható ki — és következetesen 1-indexelt sorhivatkozásokkal dolgozunk mindenhol. A fenti
  // (esetlegesen a több-soros adatok miatt megnövelt magasságú) tartalmi sorok miatt a rajz
  // kezdősorát nem mozgatjuk (a sablonban fix, jó messze van, 19. sorig ér a táblázat) — csak azt
  // biztosítjuk, hogy a rajz alatti terület mérete pontos legyen.
  const IMAGE_START_ROW = 23; // 1-indexelt sor, ahol a rajz kezdődik
  const ROW_HEIGHT_PT = 15; // amit ténylegesen beállítunk minden érintett sorra
  const ROW_HEIGHT_PX = ROW_HEIGHT_PT * (96 / 72); // = 20 px — egzakt, mert mi állítjuk be, nem feltételezés
  const rowsForImage = Math.max(1, Math.ceil(scaledHeight / ROW_HEIGHT_PX));
  const printAreaEndRow = IMAGE_START_ROW + rowsForImage + 1; // +1 sor puffer a rajz alatt

  for (let r = IMAGE_START_ROW; r <= printAreaEndRow; r++) {
    ws.getRow(r).height = ROW_HEIGHT_PT;
  }

  ws.addImage(imageId, {
    tl: { col: 5, row: IMAGE_START_ROW - 1 }, // a kép-horgony 0-indexelt, ezért -1
    ext: { width: targetWidthPx, height: scaledHeight },
  });

  ws.pageSetup = {
    paperSize: 9, // A4
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1,
    horizontalCentered: true,
    margins: { left: 0.3, right: 0.3, top: 0.3, bottom: 0.3, header: 0, footer: 0 },
    printArea: `F1:N${printAreaEndRow}`,
  };

  return workbook.xlsx.writeBuffer();
}

module.exports = { buildColleagueReportBuffer };
