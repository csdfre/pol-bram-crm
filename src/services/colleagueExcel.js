const ExcelJS = require('exceljs');
const { buildOrderFields } = require('./pdf');
const { buildColleagueSketchPng } = require('./colleagueSketchExport');

// --- Segédfüggvények a buildOrderFields (pdf.js) kimenetének kiolvasásához -----------------
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
  return [
    `filc - ${feltOn ? 'tak' : 'nie'}`,
    `rynny - ${gutterOn ? `tak${gutterColor ? ' (' + gutterColor + ')' : ''}` : 'nie'}`,
  ].join(', ');
}

function buildStructureNote(sections) {
  const structSection = findSection(sections, 'Konstrukcja');
  const type = val(structSection, 'Typ', 'Ocynkowany kątownik');
  const poles = val(structSection, 'Słupy podporowe 3,5m (szt.)', 0);
  let note = `Konstrukcja ${String(type).toLowerCase()}`;
  if (poles && Number(poles) > 0) note += ` (słupy podporowe 3,5m x${poles})`;
  return note;
}

function buildWallsDividerNote(sections) {
  const wallsSection = findSection(sections, 'Ściany działowe');
  if (!wallsSection || wallsSection.isEmpty) return '';
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

function setWrappedCell(ws, cellRef, rowNum, text) {
  const cell = ws.getCell(cellRef);
  cell.value = text;
  cell.alignment = { ...(cell.alignment || {}), wrapText: true, vertical: 'top' };
  const lineCount = String(text).split('\n').length;
  const neededHeight = Math.max(15, lineCount * 20 + 6);
  const row = ws.getRow(rowNum);
  if (!row.height || row.height < neededHeight) row.height = neededHeight;
}

function tableWidthPx(worksheet) {
  const cols = ['A', 'B'];
  return cols.reduce((sum, letter) => {
    const col = worksheet.getColumn(letter);
    const width = col.width || 10;
    return sum + (width * 7 + 5);
  }, 0);
}

/**
 * A riport alap-táblázatát KIZÁRÓLAG az ExcelJS API-jával építjük fel (nem külső .xlsx-sablonból
 * töltjük be) — korábban egy openpyxl (Python) által előállított sablon-fájlt töltöttünk be és
 * módosítottunk ExcelJS-szel, ami a valódi Microsoft Excelben "a munkafüzet egy része hibás"
 * hibaüzenetet és üres/be nem töltődő fájlt eredményezett. A gyanú szerint ez a két különböző
 * eszköz (openpyxl vs. ExcelJS) által generált OOXML-szerkezet közötti apró inkompatibilitás
 * miatt történt (ExcelJS saját olvasója és a LibreOffice is elnézőbb, mint a valódi Excel).
 * A teljesen ExcelJS-sel felépített munkafüzet ugyanazzal a szerializálóval jön létre, amit majd
 * vissza is olvasunk/módosítunk, így ez a fajta inkompatibilitás kizárt.
 */
function buildBaseWorksheet(workbook) {
  const ws = workbook.addWorksheet('Arkusz1', {
    pageSetup: { paperSize: 9, orientation: 'portrait' },
  });
  ws.getColumn(1).width = 26;
  ws.getColumn(2).width = 90;

  const bold = { bold: true, size: 11 };
  const wrapTop = { wrapText: true, vertical: 'top' };
  const thinBottom = { bottom: { style: 'thin' } };

  ws.mergeCells('A1:B1');
  ws.getCell('A1').value = 'Garaż blaszany';
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'center' };
  ws.getRow(1).height = 22;

  const simpleRows = [
    [2, 'Nazwisko:', 15],
    [3, 'Adres montażu:', 15],
    [4, 'Cena:', 15],
    [5, 'Zaliczka (30%):', 15],
  ];
  simpleRows.forEach(([r, label, h]) => {
    ws.getCell(`A${r}`).value = label;
    ws.getCell(`A${r}`).font = bold;
    ws.getCell(`A${r}`).alignment = { vertical: 'top' };
    ws.getCell(`B${r}`).alignment = wrapTop;
    ws.getRow(r).height = h;
  });

  ws.getRow(6).height = 8; // spacer

  const contentRows = [
    [7, 'wymiar (front / długość)', 15, false],
    [8, 'wiata (wymiar / umiejscowienie / panele)', 45, true],
    [9, 'dach (kolor / spad)', 15, false],
    [10, 'ściany (kolor / trapez)', 15, false],
    [11, 'brama (kolor / trapez/ rodzaj / umiejscowienie)', 45, true],
    [12, 'furtka kolor / trapez/ rodzaj / umiejscowienie / kier otwierania', 60, true],
    [13, 'okno ( ilość / wymiar / kolor)', 30, true],
    [14, 'szkic', 15, false],
    [15, 'filc / rynny / automatyka', 30, true],
  ];
  contentRows.forEach(([r, label, h, wrapLabel]) => {
    ws.getCell(`A${r}`).value = label;
    ws.getCell(`A${r}`).font = bold;
    ws.getCell(`A${r}`).alignment = wrapLabel ? wrapTop : { vertical: 'top' };
    ws.getCell(`B${r}`).alignment = wrapTop;
    ws.getRow(r).height = h;
    ws.getCell(`A${r}`).border = thinBottom;
    ws.getCell(`B${r}`).border = thinBottom;
  });

  ws.getRow(16).height = 8; // spacer

  ws.mergeCells('A17:B17');
  ws.getCell('A17').value = 'Dodatkowe informacje:';
  ws.getCell('A17').font = bold;
  ws.getCell('A17').alignment = { horizontal: 'center' };
  ws.getRow(17).height = 15;

  ws.mergeCells('A18:B18');
  ws.getCell('A18').alignment = wrapTop;
  ws.getRow(18).height = 15;

  ws.getRow(19).height = 8; // spacer

  ws.getCell('A20').value = 'Podpis:';
  ws.getCell('A20').font = bold;
  ws.getRow(20).height = 15;

  return ws;
}

async function buildColleagueReportBuffer(customer) {
  let fd = {};
  try {
    fd = customer.form_data ? JSON.parse(customer.form_data) : {};
  } catch (e) {
    console.error(`Hibás form_data JSON a(z) #${customer.id} ügyfélnél, üresként kezelve:`, e.message);
    fd = {};
  }
  let quote = null;
  try {
    quote = customer.price_breakdown ? JSON.parse(customer.price_breakdown) : null;
  } catch (e) {
    console.error(`Hibás price_breakdown JSON a(z) #${customer.id} ügyfélnél, ár nélkül folytatva:`, e.message);
  }
  const sections = buildOrderFields(fd, 'pl', false, null);

  const workbook = new ExcelJS.Workbook();
  const ws = buildBaseWorksheet(workbook);

  ws.getCell('B2').value = `${customer.name || ''} tel. ${customer.phone || ''}, mail: ${customer.email || ''}`;
  ws.getCell('B3').value = `${customer.address || ''}, ${customer.zip || ''}, ${customer.city || ''}`;
  if (quote) {
    const total = Math.round(quote.displayTotal);
    const advance = Math.round((total * 0.3) / 100) * 100;
    ws.getCell('B4').value = `${total.toLocaleString('pl-PL')} ft`;
    ws.getCell('B5').value = `${advance.toLocaleString('pl-PL')} ft`;
  }

  const widthM = (parseFloat(fd.width) || 0) / 100;
  const lengthM = (parseFloat(fd.length) || 0) / 100;
  ws.getCell('B7').value = `${widthM} x ${lengthM}`;
  ws.getCell('B8').value = buildWiataText(sections);
  ws.getCell('B9').value = buildDachText(sections);
  ws.getCell('B10').value = buildScianyText(sections);
  setWrappedCell(ws, 'B11', 11, buildBramaText(sections));
  setWrappedCell(ws, 'B12', 12, buildFurtkaText(sections));
  setWrappedCell(ws, 'B13', 13, buildOknoText(sections));
  ws.getCell('B14').value = 'tak';
  ws.getCell('B15').value = buildFilcRynnyText(sections);

  const noteLines = [buildStructureNote(sections)];
  const wallsNote = buildWallsDividerNote(sections);
  if (wallsNote) noteLines.push(wallsNote);
  const invoiceNote = buildInvoiceNote(sections);
  if (invoiceNote) noteLines.push(invoiceNote);
  setWrappedCell(ws, 'A18', 18, noteLines.join('\n'));

  const targetWidthPx = tableWidthPx(ws);
  const { buffer: pngBuffer, cssWidthPx, cssHeightPx } = await buildColleagueSketchPng(customer);
  const imageId = workbook.addImage({ buffer: pngBuffer, extension: 'png' });
  const scaledHeight = (cssHeightPx / cssWidthPx) * targetWidthPx;

  const IMAGE_START_ROW = 22;
  const ROW_HEIGHT_PT = 15;
  const ROW_HEIGHT_PX = ROW_HEIGHT_PT * (96 / 72);
  const rowsForImage = Math.max(1, Math.ceil(scaledHeight / ROW_HEIGHT_PX));
  const printAreaEndRow = IMAGE_START_ROW + rowsForImage + 1;

  for (let r = IMAGE_START_ROW; r <= printAreaEndRow; r++) {
    ws.getRow(r).height = ROW_HEIGHT_PT;
  }

  ws.addImage(imageId, {
    tl: { col: 0, row: IMAGE_START_ROW - 1 },
    ext: { width: targetWidthPx, height: scaledHeight },
  });

  ws.pageSetup = {
    paperSize: 9,
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1,
    horizontalCentered: true,
    margins: { left: 0.3, right: 0.3, top: 0.3, bottom: 0.3, header: 0, footer: 0 },
    printArea: `A1:B${printAreaEndRow}`,
  };

  return workbook.xlsx.writeBuffer();
}

module.exports = { buildColleagueReportBuffer };
