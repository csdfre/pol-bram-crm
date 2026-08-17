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
function valStartsWith(section, prefix, fallback) {
  if (!section) return fallback;
  const item = section.items.find((i) => i.label.startsWith(prefix));
  return item ? item.value : fallback;
}

function buildFurtkaText(sections) {
  const doorSection = findSection(sections, 'Drzwi wejściowe');
  if (!doorSection || doorSection.isEmpty) return { line1: 'brak', line2: '' };
  const size = val(doorSection, 'Rozmiar', '90x200');
  const color = val(doorSection, 'Kolor', '—');
  const pattern = val(doorSection, 'Wzór', '—');
  const wall = valStartsWith(doorSection, '1. ściana', '—');
  const corner = valStartsWith(doorSection, '1. róg', '—');
  const dist = valStartsWith(doorSection, '1. odległość', '—');
  const handle = valStartsWith(doorSection, '1. strona klamki', 'Lewa strona');
  // A "kilincs oldala" a KEZELŐ oldalát jelöli — a nyitásirány ennek fizikailag az ellentettje
  // (ha a kilincs jobbra van, az ajtó a bal oldalára nyílik, és fordítva).
  const opensLeft = /prawa/i.test(handle); // kilincs jobbra -> nyílás balra
  const openDir = opensLeft ? 'lewa (klamka po prawej)' : 'prawa (klamka po lewej)';
  const line1 = `${size} / ${color} / ${pattern} / na ${wall}, ${dist} cm ${corner}`;
  return { line1, line2: `/ ${openDir}` };
}

function buildOknoText(sections) {
  const winSection = findSection(sections, 'Okno uchylne (80×60)');
  if (!winSection || winSection.isEmpty) return 'brak';
  const color = val(winSection, 'Kolor', '—');
  const wall = valStartsWith(winSection, '1. ściana', '—');
  const corner = valStartsWith(winSection, '1. róg', '—');
  const dist = valStartsWith(winSection, '1. odległość', '—');
  return `80x60 - 1 szt - na ${wall}, ${dist} cm ${corner} / ${color}`;
}

function buildBramaText(sections) {
  const gateSection = findSection(sections, 'Brama garażowa');
  if (!gateSection || gateSection.isEmpty) return 'brak';
  const color = val(gateSection, 'Kolor bramy', '—');
  const pattern = val(gateSection, 'Profil trapezu bramy', '—');
  const type = val(gateSection, 'Typ bramy', '—');
  const count = val(gateSection, 'Ilość bram (szt.)', 1);
  const width = val(gateSection, 'Szerokość bramy', '300 cm');
  const placement = val(gateSection, 'Umiejscowienie bram(y)', '—');
  return `${color} / ${pattern} / ${type} x${count} (${width}) / ${placement}`;
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

function buildFilcRynnyText(sections, fd) {
  const gutterSection = findSection(sections, 'Rynna');
  const feltSection = findSection(sections, 'Filc antykondensacyjny');
  const gutterOn = gutterSection && !gutterSection.isEmpty;
  const feltOn = feltSection && !feltSection.isEmpty;
  const gutterColor = gutterOn ? val(gutterSection, 'Kolor', '') : '';
  const parts = [
    `filc - ${feltOn ? 'tak' : 'nie'}`,
    `rynny - ${gutterOn ? `tak${gutterColor ? ' (' + gutterColor + ')' : ''}` : 'nie'}`,
  ];
  if (fd.automation) parts.push('automatyka - tak');
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
  ws.getCell('H10').value = buildBramaText(sections);
  const furtka = buildFurtkaText(sections);
  ws.getCell('H11').value = furtka.line1;
  ws.getCell('H12').value = furtka.line2;
  ws.getCell('H13').value = buildOknoText(sections);
  ws.getCell('H14').value = 'tak';
  ws.getCell('H15').value = buildFilcRynnyText(sections, fd);
  ws.getCell('F19').value = buildStructureNote(sections);

  // --- Rajz: a valós rendszer-motor (customer.sketch_svg / renderLiveSketchSvg) alapján ---
  const targetWidthPx = tableWidthPx(ws);
  const { buffer: pngBuffer, cssWidthPx, cssHeightPx } = await buildColleagueSketchPng(customer);
  const imageId = workbook.addImage({ buffer: pngBuffer, extension: 'png' });
  const scaledHeight = (cssHeightPx / cssWidthPx) * targetWidthPx;
  const imageStartRow = 22; // 0-indexelt sor (= 23. sor), pár sorral a táblázat alja alatt
  ws.addImage(imageId, {
    tl: { col: 5, row: imageStartRow }, // F oszlop (0-indexelve: F=5)
    ext: { width: targetWidthPx, height: scaledHeight },
  });

  // --- Nyomtatási beállítás: az egész riport (táblázat + rajz) egyetlen álló A4 lapra férjen ki ---
  // A print area-t szűken, a tényleges tartalomra (F oszloptól, a rajz aljáig) állítjuk — az A:E
  // oszlopok üresek (csak térköz), ezek kihagyásával a "lapra igazítás" nem pazarolja rájuk a helyet.
  const DEFAULT_ROW_HEIGHT_PX = 20; // ~15pt alapértelmezett Excel sormagasság, 96 DPI mellett
  const imageEndRow = imageStartRow + Math.ceil(scaledHeight / DEFAULT_ROW_HEIGHT_PX) + 1;
  ws.pageSetup = {
    paperSize: 9, // A4
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1,
    horizontalCentered: true,
    margins: { left: 0.3, right: 0.3, top: 0.3, bottom: 0.3, header: 0, footer: 0 },
    printArea: `F1:N${imageEndRow}`,
  };

  return workbook.xlsx.writeBuffer();
}

module.exports = { buildColleagueReportBuffer };
