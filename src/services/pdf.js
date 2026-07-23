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

async function renderHtmlToPdf(html) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const buffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0mm', bottom: '14mm', left: '0mm', right: '0mm' },
    });
    return buffer;
  } finally {
    await page.close();
  }
}

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const LOGO_B64 = "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";

// ---------------------------------------------------------------
// Fordítási szótárak (HU / PL) — a magyar megrendelőlapon SOSE jelenik meg lengyel szó,
// a kolléganő felületén viszont minden le van fordítva lengyelre.
// ---------------------------------------------------------------
const SECTION_LABELS = {
  size: { hu: 'Garázs mérete', pl: 'Wymiary garażu' },
  canopy: { hu: 'Elő- / oldaltető', pl: 'Wiata / zadaszenie boczne' },
  roof: { hu: 'Tető', pl: 'Dach' },
  gate: { hu: 'Garázskapu', pl: 'Brama garażowa' },
  structure: { hu: 'Szerkezet', pl: 'Konstrukcja' },
  walls: { hu: 'Oldalfalak', pl: 'Ściany boczne' },
  door: { hu: 'Személyi bejáró', pl: 'Drzwi wejściowe' },
  window: { hu: 'Bukó ablak (80×60)', pl: 'Okno uchylne (80×60)' },
  gutter: { hu: 'Ereszcsatorna', pl: 'Rynna' },
  felt: { hu: 'Páralecsapódás-gátló filc', pl: 'Filc antykondensacyjny' },
};
const FIELD_LABELS = {
  width: { hu: 'Szélesség', pl: 'Szerokość' },
  length: { hu: 'Hosszúság', pl: 'Długość' },
  height: { hu: 'Oldalmagasság', pl: 'Wysokość ściany' },
  backWallCover: { hu: 'Hátsó fal burkolata', pl: 'Pokrycie tylnej ściany' },
  backWallColor: { hu: 'Hátsó fal színe', pl: 'Kolor tylnej ściany' },
  sideWallCover: { hu: 'Oldalfal burkolata', pl: 'Pokrycie ściany bocznej' },
  sideWallColor: { hu: 'Oldalfal színe', pl: 'Kolor ściany bocznej' },
  roofType: { hu: 'Tető típus', pl: 'Typ dachu' },
  roofColor: { hu: 'Tetőlemez színe', pl: 'Kolor blachy dachowej' },
  roofTrimColor: { hu: 'Tetőszegély színe', pl: 'Kolor obróbek dachowych' },
  gateTypeCount: { hu: 'Kapu típusa és száma', pl: 'Typ i liczba bram' },
  gateWidth: { hu: 'Kapu szélessége', pl: 'Szerokość bramy' },
  gateHeight: { hu: 'Kapu magassága', pl: 'Wysokość bramy' },
  gateColor: { hu: 'Kapu színe', pl: 'Kolor bramy' },
  gatePattern: { hu: 'Kapu trapézprofil / mintázat', pl: 'Profil trapezu bramy' },
  automation: { hu: 'Automatika', pl: 'Automatyka' },
  structureType: { hu: 'Típus', pl: 'Typ' },
  wallPattern: { hu: 'Mintázat', pl: 'Wzór blachy' },
  wallColor: { hu: 'Oldalfal színe', pl: 'Kolor ścian' },
  wallTrimColor: { hu: 'Oldalszegély színe', pl: 'Kolor obróbek' },
  doorCount: { hu: 'Darabszám', pl: 'Ilość (szt.)' },
  doorSize: { hu: 'Méret', pl: 'Rozmiar' },
  doorColor: { hu: 'Szín', pl: 'Kolor' },
  doorPattern: { hu: 'Minta', pl: 'Wzór' },
  placement: { hu: 'Elhelyezkedés', pl: 'Umiejscowienie' },
  windowCount: { hu: 'Darabszám', pl: 'Ilość (szt.)' },
  windowColor: { hu: 'Szín', pl: 'Kolor' },
  gutterColor: { hu: 'Szín', pl: 'Kolor' },
  feltNeed: { hu: 'Igény', pl: 'Potrzebne' },
};
const VALUE_NONE = { hu: 'Nincs', pl: 'Brak' };
const YES = { hu: 'Van', pl: 'Jest' };

const COLOR_NAMES = {
  OCNATUR: { hu: 'Horganyzott (natúr fém)', pl: 'Ocynkowany (naturalny)' },
  RAL9005: { hu: 'Matt fekete (RAL9005)', pl: 'Czarny mat (RAL9005)' },
  'RAL7016-M': { hu: 'Matt grafit (RAL7016)', pl: 'Grafitowy mat (RAL7016)' },
  'RAL7016-F': { hu: 'Fényes grafit (RAL7016)', pl: 'Grafitowy połysk (RAL7016)' },
  'RAL8017-M': { hu: 'Csokoládébarna (RAL8017)', pl: 'Czekoladowy (RAL8017)' },
  RAL8004: { hu: 'Rézbarna (RAL8004)', pl: 'Miedziany (RAL8004)' },
  RAL3011: { hu: 'Vörös burgundi (RAL3011)', pl: 'Bordowy (RAL3011)' },
  RAL6020: { hu: 'Matt zöld (RAL6020)', pl: 'Zielony mat (RAL6020)' },
  RAL9006: { hu: 'Alumíniumezüst (RAL9006)', pl: 'Srebrny aluminiowy (RAL9006)' },
  RAL7035: { hu: 'Világosszürke (RAL7035)', pl: 'Jasnoszary (RAL7035)' },
  RAL9010: { hu: 'Fehér (RAL9010)', pl: 'Biały (RAL9010)' },
  OAK: { hu: 'Rusztikus tölgy', pl: 'Dąb rustykalny' },
  WALNUT: { hu: 'Dió', pl: 'Orzech' },
  WINCH: { hu: 'Winchester', pl: 'Winchester' },
  GOLDOAK: { hu: 'Arany tölgy', pl: 'Złoty dąb' },
};
function colorName(code, lang){
  if(!code) return VALUE_NONE[lang];
  return (COLOR_NAMES[code] && COLOR_NAMES[code][lang]) || code;
}

const ROOF_NAMES = {
  dwuspad: { hu: 'Nyeregtető', pl: 'Dwuspadowy' },
  'spad tyl': { hu: 'Hátrafelé lejtő tető', pl: 'Spad w tył' },
  'spad przod': { hu: 'Előrefelé lejtő tető', pl: 'Spad w przód' },
  'spad jobbra': { hu: 'Oldalra lejtő tető (jobbra)', pl: 'Spad w bok (prawo)' },
  'spad balra': { hu: 'Oldalra lejtő tető (balra)', pl: 'Spad w bok (lewo)' },
};
const GATE_NAMES = {
  uchylna: { hu: 'Billenő', pl: 'Uchylna' },
  dwuskrz: { hu: 'Kétszárnyú', pl: 'Dwuskrzydłowa' },
  none: { hu: 'Nincs', pl: 'Brak' },
};
const STRUCTURE_NAMES = {
  szogvas: { hu: 'Horganyzott szögvas', pl: 'Ocynkowany kątownik' },
  zartprofil: { hu: 'Horganyzott zárt profil', pl: 'Ocynkowany profil zamknięty' },
};
const PATTERN_NAMES = {
  'T7 – vízszintes': { hu: 'T7 – vízszintes', pl: 'T7 – poziomy' },
  'T7 – függőleges': { hu: 'T7 – függőleges', pl: 'T7 – pionowy' },
  'Széles vízszintes': { hu: 'Széles vízszintes', pl: 'Szeroki poziomy' },
};
function patternName(p, lang){
  if(!p) return '—';
  return (PATTERN_NAMES[p] && PATTERN_NAMES[p][lang]) || p;
}
function buildOptions(dict, lang){
  return Object.entries(dict).map(([code, names]) => [code, names[lang] || code]);
}
const COLOR_OPTIONS = { hu: buildOptions(COLOR_NAMES,'hu'), pl: buildOptions(COLOR_NAMES,'pl') };
const ROOF_OPTIONS_FULL = { hu: buildOptions(ROOF_NAMES,'hu'), pl: buildOptions(ROOF_NAMES,'pl') };
const STRUCTURE_OPTIONS = { hu: buildOptions(STRUCTURE_NAMES,'hu'), pl: buildOptions(STRUCTURE_NAMES,'pl') };
const PATTERN_OPTIONS = { hu: buildOptions(PATTERN_NAMES,'hu'), pl: buildOptions(PATTERN_NAMES,'pl') };
const WALL_NAMES = {
  front: { hu: 'elülső fal', pl: 'ściana przednia' },
  back: { hu: 'hátsó fal', pl: 'ściana tylna' },
  left: { hu: 'bal oldalfal', pl: 'ściana lewa' },
  right: { hu: 'jobb oldalfal', pl: 'ściana prawa' },
  canopy: { hu: 'oldaltető fala', pl: 'ściana wiaty' },
  notch: { hu: 'előtető fala', pl: 'ściana zadaszenia' },
};
const CORNER_NAMES = {
  left: { hu: 'bal saroktól', pl: 'od lewego rogu' },
  right: { hu: 'jobb saroktól', pl: 'od prawego rogu' },
};

function unitPlacementText(fd, prefix, count, lang){
  const parts = [];
  for(let i=0;i<count;i++){
    const wall = fd[prefix+'Wall'+i], corner = fd[prefix+'Corner'+i], dist = fd[prefix+'Distance'+i];
    if(wall==null) continue;
    const wallName = (WALL_NAMES[wall] && WALL_NAMES[wall][lang]) || wall;
    const cornerName = (CORNER_NAMES[corner] && CORNER_NAMES[corner][lang]) || corner;
    parts.push(`${i+1}. ${wallName}, ${dist||'—'} cm (${cornerName})`);
  }
  return parts.length ? parts.join('; ') : '—';
}

/**
 * A garázs adatait a cég valós megrendelőlap-sablonjának mezői szerint strukturáljuk.
 * lang: 'hu' vagy 'pl' — a HU verzióban SOSE szerepel lengyel szó, a PL verzió teljesen lengyel.
 * Az üres/nem kért szekciók (pl. nincs ereszcsatorna) egyszerűen ki vannak hagyva.
 */
const WALL_OPTIONS = {
  hu: [['front','Elülső fal'],['back','Hátsó fal'],['left','Bal oldalfal'],['right','Jobb oldalfal'],['canopy','Oldaltető fala'],['notch','Előtető fala']],
  pl: [['front','Ściana przednia'],['back','Ściana tylna'],['left','Ściana lewa'],['right','Ściana prawa'],['canopy','Ściana wiaty'],['notch','Ściana zadaszenia']],
};
const CORNER_OPTIONS = {
  hu: [['left','Bal sarok'],['right','Jobb sarok']],
  pl: [['left','Lewy róg'],['right','Prawy róg']],
};
const GATE_TYPE_OPTIONS = {
  hu: [['none','Nincs'],['uchylna','Billenő'],['dwuskrz','Kétszárnyú']],
  pl: [['none','Brak'],['uchylna','Uchylna'],['dwuskrz','Dwuskrzydłowa']],
};

function buildOrderFields(fd, lang, includeEmpty){
  const gateType = fd.__gateType || fd.gateType || 'none';
  const gateCount = parseInt(fd.gateCount)||0;
  const personalDoorCount = fd.personalDoorYes ? (parseInt(fd.personalDoorCount)||0) : 0;
  const win8060Count = parseInt(fd.win8060)||0;
  const L = (key) => (FIELD_LABELS[key] && FIELD_LABELS[key][lang]) || key;
  const S = (key) => (SECTION_LABELS[key] && SECTION_LABELS[key][lang]) || key;
  // item formátum: { label, value (megjelenített szöveg), key (form_data kulcs, vagy null ha nem szerkeszthető),
  //                   raw (nyers érték), type: 'text'|'number'|'select'|'checkbox', options }
  const E = (label, display, key, raw, type) => ({ label, value: display, key: key||null, raw: raw!==undefined?raw:display, type: type||'text' });
  const ESEL = (label, key, raw, options, display) => ({ label, value: display!==undefined?display:raw, key, raw, type:'select', options });
  const ECHECK = (label, key, checked, display) => ({ label, value: display, key, raw: checked, type:'checkbox' });

  function placementRows(prefix, count, labelPrefix){
    const rows = [];
    for(let i=0;i<count;i++){
      const n = `${i+1}. `;
      rows.push(ESEL(n+(lang==='pl'?'ściana':'fal'), `${prefix}Wall${i}`, fd[`${prefix}Wall${i}`]||'front', WALL_OPTIONS[lang],
        (WALL_OPTIONS[lang].find(o=>o[0]===(fd[`${prefix}Wall${i}`]||'front'))||[,fd[`${prefix}Wall${i}`]])[1]));
      rows.push(ESEL(n+(lang==='pl'?'róg':'sarok'), `${prefix}Corner${i}`, fd[`${prefix}Corner${i}`]||'left', CORNER_OPTIONS[lang],
        (CORNER_OPTIONS[lang].find(o=>o[0]===(fd[`${prefix}Corner${i}`]||'left'))||[,fd[`${prefix}Corner${i}`]])[1]));
      rows.push(E(n+(lang==='pl'?'odległość (cm)':'távolság (cm)'), fd[`${prefix}Distance${i}`]||'—', `${prefix}Distance${i}`, fd[`${prefix}Distance${i}`], 'number'));
    }
    return rows;
  }

  const sections = [];
  sections.push({ section: S('size'), items: [
    E(L('width'), (fd.width||'—')+' cm', 'width', fd.width, 'number'),
    E(L('length'), (fd.length||'—')+' cm', 'length', fd.length, 'number'),
    E(L('height'), (fd.height||'—'), 'height', fd.height),
  ]});

  if(fd.canopyYes){
    sections.push({ section: S('canopy'), items: [
      E(L('width'), (fd.canopyWidth||'—')+' cm', 'canopyWidth', fd.canopyWidth, 'number'),
      E(L('length'), (fd.canopyLength||'—')+' cm', 'canopyLength', fd.canopyLength, 'number'),
      E(L('backWallCover'), fd.canopyBackWall==='solid'?{hu:'Teli fal',pl:'Ściana pełna'}[lang]:fd.canopyBackWall==='lamella'?{hu:'Lamellás',pl:'Lamelowa'}[lang]:VALUE_NONE[lang], 'canopyBackWall', fd.canopyBackWall),
      ESEL(L('backWallColor'), 'colorCanopyBack', fd.colorCanopyBack||'RAL9005', COLOR_OPTIONS[lang], colorName(fd.colorCanopyBack, lang)),
      E(L('sideWallCover'), fd.canopySideWall==='solid'?{hu:'Teli fal',pl:'Ściana pełna'}[lang]:fd.canopySideWall==='lamella'?{hu:'Lamellás',pl:'Lamelowa'}[lang]:VALUE_NONE[lang], 'canopySideWall', fd.canopySideWall),
      ESEL(L('sideWallColor'), 'colorCanopySide', fd.colorCanopySide||'RAL9005', COLOR_OPTIONS[lang], colorName(fd.colorCanopySide, lang)),
    ]});
  }

  sections.push({ section: S('roof'), items: [
    ESEL(L('roofType'), 'roofType', fd.roofType||'dwuspad', ROOF_OPTIONS_FULL[lang], (ROOF_NAMES[fd.roofType] && ROOF_NAMES[fd.roofType][lang]) || fd.roofType || '—'),
    ESEL(L('roofColor'), 'colorRoof', fd.colorRoof||'RAL9005', COLOR_OPTIONS[lang], colorName(fd.colorRoof, lang)),
    ESEL(L('roofTrimColor'), 'colorRoofTrim', fd.colorRoofTrim||'RAL9005', COLOR_OPTIONS[lang], colorName(fd.colorRoofTrim, lang)),
  ]});

  if(gateType!=='none' || includeEmpty){
    const items = [
      ESEL(lang==='pl'?'Typ bramy':'Kapu típusa', '__gateType', gateType, GATE_TYPE_OPTIONS[lang], (GATE_NAMES[gateType]&&GATE_NAMES[gateType][lang])||gateType),
      E(lang==='pl'?'Ilość bram (szt.)':'Kapuk száma (db)', gateCount||1, 'gateCount', gateCount||1, 'number'),
      E(L('gateWidth'), (fd.gateWidth||'300')+' cm', 'gateWidth', fd.gateWidth||300, 'number'),
      E(L('gateHeight'), (fd.gateHeight||'185')+' cm', 'gateHeight', fd.gateHeight||185, 'number'),
      ESEL(L('gateColor'), 'colorGate', fd.colorGate||'RAL9005', COLOR_OPTIONS[lang], colorName(fd.colorGate||'RAL9005', lang)),
      ESEL(L('gatePattern'), 'gatePattern', fd.gatePattern||'Széles vízszintes', PATTERN_OPTIONS[lang], patternName(fd.gatePattern||'Széles vízszintes', lang)),
      ECHECK(lang==='pl'?'Automatyka':'Automatika kérése', 'automation', !!fd.automation, fd.automation ? YES[lang] : VALUE_NONE[lang]),
      E(lang==='pl'?'Ilość automatyki (szt.)':'Automatika darabszáma (db)', fd.automationQty||1, 'automationQty', fd.automationQty||1, 'number'),
    ];
    sections.push({ section: S('gate'), items });
  }

  sections.push({ section: S('structure'), items: [
    ESEL(L('structureType'), 'structureType', fd.structureType||'szogvas', STRUCTURE_OPTIONS[lang], (STRUCTURE_NAMES[fd.structureType] && STRUCTURE_NAMES[fd.structureType][lang]) || fd.structureType || '—'),
  ]});

  sections.push({ section: S('walls'), items: [
    ESEL(L('wallPattern'), 'wallPattern', fd.wallPattern||'T7 – vízszintes', PATTERN_OPTIONS[lang], patternName(fd.wallPattern, lang)),
    ESEL(L('wallColor'), 'colorWall', fd.colorWall||'RAL9005', COLOR_OPTIONS[lang], colorName(fd.colorWall, lang)),
    ESEL(L('wallTrimColor'), 'colorWallTrim', fd.colorWallTrim||'RAL9005', COLOR_OPTIONS[lang], colorName(fd.colorWallTrim, lang)),
  ]});

  if(personalDoorCount>0 || includeEmpty){
    sections.push({ section: S('door'), items: [
      ECHECK(lang==='pl'?'Potrzebne':'Kérjük', 'personalDoorYes', !!fd.personalDoorYes, fd.personalDoorYes ? YES[lang] : VALUE_NONE[lang]),
      E(L('doorCount'), personalDoorCount||1, 'personalDoorCount', personalDoorCount||1, 'number'),
      E(L('doorSize'), fd.personalDoorSize||'90x200', 'personalDoorSize', fd.personalDoorSize||'90x200'),
      ESEL(L('doorColor'), 'colorDoor', fd.colorDoor||'RAL9005', COLOR_OPTIONS[lang], colorName(fd.colorDoor||'RAL9005', lang)),
      ESEL(L('doorPattern'), 'personalDoorPattern', fd.personalDoorPattern||'Széles vízszintes', PATTERN_OPTIONS[lang], patternName(fd.personalDoorPattern||'Széles vízszintes', lang)),
      ...placementRows('personalDoor', Math.max(personalDoorCount,1)),
    ]});
  }

  if(win8060Count>0 || includeEmpty){
    sections.push({ section: S('window'), items: [
      E(L('windowCount'), win8060Count, 'win8060', win8060Count, 'number'),
      ESEL(L('windowColor'), 'colorWindow', fd.colorWindow||'RAL9005', COLOR_OPTIONS[lang], colorName(fd.colorWindow||'RAL9005', lang)),
      ...placementRows('win8060', Math.max(win8060Count,1)),
    ]});
  }

  if(fd.gutterYes || includeEmpty){
    sections.push({ section: S('gutter'), items: [
      ECHECK(lang==='pl'?'Potrzebne':'Kérjük', 'gutterYes', !!fd.gutterYes, fd.gutterYes ? YES[lang] : VALUE_NONE[lang]),
      ESEL(L('gutterColor'), 'gutterColor', fd.gutterColor||'RAL9005', COLOR_OPTIONS[lang], colorName(fd.gutterColor||'RAL9005', lang)),
    ]});
  }

  if(fd.feltYes || includeEmpty){
    sections.push({ section: S('felt'), items: [
      ECHECK(lang==='pl'?'Potrzebne':'Kérjük', 'feltYes', !!fd.feltYes, fd.feltYes ? YES[lang] : VALUE_NONE[lang]),
    ]});
  }

  return sections;
}

function sectionHtml(s){
  return `<div class="section">
    <h2>${escapeHtml(s.section)}</h2>
    <table>${s.items.map(it => `<tr><td class="label">${escapeHtml(it.label)}</td><td>${escapeHtml(it.value)}</td></tr>`).join('')}</table>
  </div>`;
}

// Szerkeszthető változat a kolléganő / ügyfél felületéhez — ahol van form_data kulcs, a típusnak megfelelő
// mező jelenik meg (szöveg / szám / legördülő / jelölőnégyzet)
function editableSectionHtml(s){
  return `<div class="section">
    <h2>${escapeHtml(s.section)}</h2>
    <table>${s.items.map(it => {
      let control = escapeHtml(it.value);
      if(it.key){
        if(it.type==='select'){
          control = `<select data-key="${escapeHtml(it.key)}" style="width:100%;padding:4px 6px;border:1px solid #C7D0D6;border-radius:3px;font-size:11px">` +
            it.options.map(([v,l]) => `<option value="${escapeHtml(v)}"${v===it.raw?' selected':''}>${escapeHtml(l)}</option>`).join('') + `</select>`;
        } else if(it.type==='checkbox'){
          control = `<input type="checkbox" data-key="${escapeHtml(it.key)}" data-type="checkbox" ${it.raw?'checked':''}>`;
        } else {
          control = `<input type="${it.type==='number'?'number':'text'}" data-key="${escapeHtml(it.key)}" value="${escapeHtml(it.raw)}" style="width:100%;padding:4px 6px;border:1px solid #C7D0D6;border-radius:3px;font-size:11px">`;
        }
      }
      return `<tr><td class="label">${escapeHtml(it.label)}</td><td>${control}</td></tr>`;
    }).join('')}</table>
  </div>`;
}

// ---------------------------------------------------------------
// A rajz (sketch_svg) sötét-témás színeit világos (nyomtatható / erős kontrasztú) színekre cseréli
// ---------------------------------------------------------------
function lightenSketchSvg(svg){
  if(!svg) return svg;
  let out = svg;
  out = out.replace(/<rect width="400" height="300" fill="url\(#grid\)"[^>]*>(\s*<\/rect>)?/, '');
  out = out.replace(/<defs>[\s\S]*?<\/defs>/, '');
  out = out.replace(/#fff(?!\w)/g, '#20242A');
  out = out.replace(/#8b939a/g, '#454C54');
  out = out.replace(/#F2B705/g, '#8a5a03');
  out = out.replace(/#c9cdd0/g, '#5c6368');
  out = out.replace(/#d9a520/g, '#7a4d02');
  out = out.replace(/#6fb7e0/g, '#1f5c86');
  out = out.replace(/#c98a2e/g, '#7a4d16');
  out = out.replace(/fill="#161A1E"/g, 'fill="#eef0f1"');
  return out;
}

// A rajzba beégetett magyar feliratokat lengyelre fordítja (a pontos cm-értékek változatlanok maradnak),
// és kicsit csökkenti a betűméretet, mert a lengyel szövegek jellemzően hosszabbak.
function translateSketchToPolish(svg){
  if(!svg) return svg;
  let out = svg;
  out = out.replace(/ELÜLSŐ FAL \(kapu oldala\)/g, 'ŚCIANA PRZEDNIA (strona bramy)');
  out = out.replace(/>Oldaltető</g, '>Wiata boczna<');
  out = out.replace(/>Előtető</g, '>Zadaszenie<');
  out = out.replace(/>válaszfal</g, '>ściana działowa<');
  out = out.replace(/>ajtó (\d+cm)</g, '>drzwi $1<');
  out = out.replace(/>nyílás (\d+cm)</g, '>otwór $1<');
  out = out.replace(/(\d+)\s?cm a (bal|jobb) saroktól/g, (m, num, side) => `${num} cm od ${side==='bal'?'lewego':'prawego'} rogu`);
  out = out.replace(/font-size="7\.5"/g, 'font-size="6.3"');
  out = out.replace(/font-size="9"/g, 'font-size="7.5"');
  return out;
}
function prepareColleagueSketch(svg){
  return translateSketchToPolish(lightenSketchSvg(svg));
}

const PRICE_LABELS = {
  total: { hu: 'Végösszeg', pl: 'Suma końcowa' },
  advance: { hu: 'Előleg (30%)', pl: 'Zaliczka (30%)' },
  cashNote: {
    hu: (amount) => `Ha a fennmaradó összeget készpénzben egyenlíti ki, magánszemélyek 15% kedvezményt kapnak a teljes összegből. Kedvezményes végösszeg: ${amount}.`,
    pl: (amount) => `Jeśli pozostała kwota zostanie uregulowana gotówką, osoby prywatne otrzymują 15% rabatu od kwoty całkowitej. Kwota po rabacie: ${amount}.`,
  },
};

function priceCardHtml(quote, fd, lang){
  if(!quote) return '';
  const total = quote.displayTotal;
  const advance = Math.round(total*0.30/100)*100;
  const isPrivateIndividual = fd.custInvoice === 'nem';
  const cashDiscounted = Math.round(total*0.85/100)*100;
  return `<div class="price-card">
    <div class="amount">${total.toLocaleString('hu-HU')} Ft</div>
    <div class="label">${(quote.displayLabel||'').toUpperCase()}</div>
    <div class="advance">${PRICE_LABELS.advance[lang]}: ${advance.toLocaleString('hu-HU')} Ft</div>
  </div>
  ${isPrivateIndividual ? `<div class="cash-note">${PRICE_LABELS.cashNote[lang](cashDiscounted.toLocaleString('hu-HU')+' Ft')}</div>` : ''}`;
}

/**
 * Megrendelőlap HTML sablon — a cég valós megrendelőlap-mezői alapján, márkázott elrendezéssel.
 * Az ár a garázs paraméterei UTÁN, a dokumentum alján jelenik meg.
 */
function orderFormHtml(customer, quote, lang) {
  const fd = JSON.parse(customer.form_data || '{}');
  const sections = buildOrderFields(fd, lang);
  const T = {
    title: { hu: 'Megrendelőlap', pl: 'Karta zamówienia' },
    customerData: { hu: 'Ügyfél adatai', pl: 'Dane klienta' },
    name: { hu: 'Vezetéknév, keresztnév', pl: 'Imię i nazwisko' },
    phone: { hu: 'Telefon', pl: 'Telefon' },
    email: { hu: 'E-mail', pl: 'E-mail' },
    address: { hu: 'Irányítószám, cím', pl: 'Kod pocztowy, adres' },
    generatedOn: { hu: 'Létrehozva', pl: 'Wygenerowano' },
    sketch: { hu: 'Felülnézeti vázlat', pl: 'Szkic z góry' },
  };

  return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="UTF-8"><style>
  @page { margin: 0; }
  *{box-sizing:border-box;}
  body{font-family:'Helvetica Neue',Arial,sans-serif;color:#20242A;font-size:11.5px;margin:0;}
  .header{background:#20242A;padding:22px 32px;display:flex;justify-content:space-between;align-items:center;border-bottom:5px solid #F2B705;}
  .header img{height:34px;background:#fff;padding:6px 10px;border-radius:4px;}
  .header .titles{color:#fff;text-align:right;}
  .header .titles h1{margin:0;font-size:19px;letter-spacing:0.02em;text-transform:uppercase;}
  .header .titles .sub{font-size:10px;color:#c7d0d6;margin-top:3px;letter-spacing:0.03em;text-transform:uppercase;}
  .content{padding:22px 32px;}
  .cust-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;margin-bottom:18px;background:#fafbfb;border:1px solid #e6e8ea;border-radius:8px;padding:16px 20px;}
  .cust-grid div{font-size:14px;}
  .cust-grid .l{color:#7a828a;font-size:10.5px;text-transform:uppercase;letter-spacing:0.03em;display:block;margin-bottom:2px;}
  .section{margin-bottom:14px;break-inside:avoid;}
  .section h2{font-size:11.5px;text-transform:uppercase;letter-spacing:0.04em;color:#fff;background:#454C54;padding:5px 10px;border-radius:4px 4px 0 0;margin:0;}
  .section table{width:100%;border-collapse:collapse;border:1px solid #e6e8ea;border-top:none;border-radius:0 0 4px 4px;overflow:hidden;}
  .section td{padding:5px 10px;font-size:11px;border-bottom:1px solid #f0f1f2;vertical-align:top;}
  .section tr:last-child td{border-bottom:none;}
  .section td.label{color:#7a828a;width:36%;font-size:10px;text-transform:uppercase;letter-spacing:0.02em;}
  .two-col{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
  .sketch{border:1px solid #e6e8ea;border-radius:8px;padding:12px;text-align:center;background:#161A1E;margin-bottom:14px;break-inside:avoid;}
  .price-card{background:linear-gradient(135deg,#20242A,#2c333b);color:#fff;border-radius:8px;padding:18px 22px;text-align:center;margin-top:18px;break-inside:avoid;}
  .price-card .amount{font-size:26px;font-weight:700;}
  .price-card .label{font-size:10px;color:#F2B705;text-transform:uppercase;letter-spacing:0.06em;margin-top:3px;}
  .price-card .advance{font-size:12px;color:#e6e8ea;margin-top:10px;border-top:1px solid rgba(255,255,255,0.15);padding-top:8px;}
  .cash-note{font-size:9px;color:#7a828a;text-align:center;margin-top:6px;line-height:1.4;}
  .legal{font-size:8.5px;color:#8a929a;line-height:1.5;border-top:1px solid #eee;padding-top:12px;margin-top:16px;}
  .legal p{margin:0 0 6px;}
  .footer{padding:12px 32px;font-size:9px;color:#9aa2a8;border-top:1px solid #eee;display:flex;justify-content:space-between;}
</style></head>
<body>
  <div class="header">
    <img src="data:image/png;base64,${LOGO_B64}" alt="Pol-Bram">
    <div class="titles">
      <h1>${T.title[lang]}</h1>
      <div class="sub">${T.generatedOn[lang]}: ${new Date().toLocaleDateString(lang === 'pl' ? 'pl-PL' : 'hu-HU')}</div>
    </div>
  </div>

  <div class="content">
    <div class="cust-grid">
      <div><span class="l">${T.name[lang]}</span>${escapeHtml(customer.name)}</div>
      <div><span class="l">${T.phone[lang]}</span>${escapeHtml(customer.phone)}</div>
      <div><span class="l">${T.email[lang]}</span>${escapeHtml(customer.email)}</div>
      <div><span class="l">${T.address[lang]}</span>${escapeHtml(customer.zip)} ${escapeHtml(customer.city)}, ${escapeHtml(customer.address)}</div>
    </div>

    ${customer.sketch_svg ? `<div class="sketch">${customer.sketch_svg}</div>` : ''}

    <div class="two-col">
      <div>
        ${sections.slice(0, Math.ceil(sections.length/2)).map(s => sectionHtml(s)).join('')}
      </div>
      <div>
        ${sections.slice(Math.ceil(sections.length/2)).map(s => sectionHtml(s)).join('')}
      </div>
    </div>

    ${priceCardHtml(quote, fd, lang)}

    <div class="legal">
      <p><strong>${lang==='pl' ? 'Czas produkcji ok.: 3–8 tygodni.' : 'Gyártási idő kb.: 3–8 hét.'}</strong></p>
      <p>${lang==='pl'
        ? 'Przed planowaną dostawą skontaktujemy się ponownie, aby potwierdzić wszystkie parametry zamówienia oraz ustalić dokładny termin dostawy. Po potwierdzeniu parametrów zamówienia modyfikacja nie będzie już możliwa.'
        : 'A tervezett kiszállítás előtt ismét felvesszük Önnel a kapcsolatot, hogy megerősítsük a megrendelés minden paraméterét, valamint egyeztessük a pontos szállítási dátumot és időpontot. A megrendelés paramétereinek megerősítése után a rendelés módosítására már nincs lehetőség.'}</p>
      <p>${lang==='pl'
        ? 'Podłoże musi być wcześniej przygotowane i wypoziomowane — szczegółowe informacje w załączonym pliku. Nie świadczymy usługi kotwiczenia / mocowania do podłoża.'
        : '<strong>A talajnak elő kell lennie készítve és ki kell lennie egyenlítve</strong> – részletes információ a csatolt fájlban található. Nem vállalunk rögzítési vagy talajhoz való rögzítési szolgáltatást.'}</p>
      <p>${lang==='pl'
        ? 'Kilka dni po montażu garażu należy obowiązkowo usunąć folię ochronną z blachy — leży to po stronie klienta.'
        : 'A garázs összeszerelése után néhány napon belül kötelező a védőfólia eltávolítása a lemezről. A szerelés befejezése után az ügyfél feladata a védőfólia eltávolítása.'}</p>
      <p>${lang==='pl'
        ? 'Jeśli ściana, drzwi wejściowe i bramy garażowe wykonane są z tego samego profilu trapezowego, wzór może się nie pokrywać dokładnie — możliwe są niewielkie odchylenia. Konstrukcja garażu zabezpieczona jest farbą podkładową, o dalszą ochronę antykorozyjną musi zadbać klient.'
        : 'Amennyiben a fal, a gyalogos ajtó és a garázskapuk azonos trapézprofilból készülnek, előfordulhat, hogy a mintázat nem esik pontosan egybe, kisebb eltérések lehetségesek. A garázs szerkezete alapozófestékkel kezelt, a korrózió elleni további védelemről az ügyfélnek kell gondoskodnia.'}</p>
      <p>${lang==='pl'
        ? 'Prosimy o dokładne sprawdzenie danych zawartych w zamówieniu oraz załączonych rysunków/schematów — te dokumenty stanowią podstawę produkcji. Brak odpowiedzi oznacza akceptację zamówienia.'
        : 'Kérjük, alaposan ellenőrizze a megrendelésben szereplő adatokat és a mellékelt rajzokat/sémákat — ezek a dokumentumok képezik a gyártás alapját. A visszaigazolás hiánya a megrendelés jóváhagyását jelenti.'}</p>
    </div>
  </div>

  <div class="footer">
    <span>Pol-Bram — F.P.H.U Pol Bram</span>
    <span>${T.title[lang]}</span>
  </div>
</body>
</html>`;
}

async function generateOrderFormPdf(customer, quote, lang) {
  const html = orderFormHtml(customer, quote, lang);
  return renderHtmlToPdf(html);
}

module.exports = { generateOrderFormPdf, orderFormHtml, buildOrderFields, sectionHtml, editableSectionHtml, lightenSketchSvg, translateSketchToPolish, prepareColleagueSketch, priceCardHtml };
