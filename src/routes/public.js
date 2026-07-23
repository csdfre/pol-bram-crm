const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../../db');
const email = require('../services/email');
const { calculateQuote } = require('../services/pricing');
const { generateOrderFormPdf, buildOrderFields, sectionHtml, editableSectionHtml, prepareColleagueSketch, priceCardHtml } = require('../services/pdf');

const router = express.Router();

const invoiceUploadDirColleague = path.join(__dirname, '..', '..', 'uploads', 'invoices');
if (!fs.existsSync(invoiceUploadDirColleague)) fs.mkdirSync(invoiceUploadDirColleague, { recursive: true });
const invoiceUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, invoiceUploadDirColleague),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  }),
});

const complaintUploadDir = path.join(__dirname, '..', '..', 'uploads', 'complaints');
if (!fs.existsSync(complaintUploadDir)) fs.mkdirSync(complaintUploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, complaintUploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB / kép
});

// ---------------------------------------------------------------
// Típusgarázsok listája és részletei (publikus, olvasás-only — az ügyfél-oldali konfigurátornak)
// ---------------------------------------------------------------
router.get('/garage-types', (req, res) => {
  const rows = db.prepare('SELECT id, name, image_path FROM garage_types ORDER BY name ASC').all();
  res.json(rows);
});

router.get('/garage-types/:id', (req, res) => {
  const t = db.prepare('SELECT id, name, image_path, form_data FROM garage_types WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Nem található.' });
  res.json({ ...t, form_data: JSON.parse(t.form_data || '{}') });
});

// ---------------------------------------------------------------
// Ügyfél beküldi az igényét a garázs-konfigurátor oldalról
// ---------------------------------------------------------------
router.post('/submit', async (req, res) => {
  try {
    const { name, phone, email: custEmail, zip, city, address, formData, summaryText, sketchSvg, garageTypeUsed } = req.body;

    if (!custEmail) return res.status(400).json({ error: 'Hiányzik az e-mail cím.' });

    const now = new Date().toISOString();
    const acceptToken = uuidv4();
    const satisfactionToken = uuidv4();
    const complaintToken = uuidv4();

    const info = db.prepare(`
      INSERT INTO customers
        (created_at, updated_at, status, name, phone, email, zip, city, address, form_data, summary_text, sketch_svg,
         accept_token, satisfaction_token, complaint_token, garage_type_used)
      VALUES (?, ?, 'ajanlatra_var', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(now, now, name, phone, custEmail, zip, city, address,
      JSON.stringify(formData || {}), summaryText || '', sketchSvg || '',
      acceptToken, satisfactionToken, complaintToken, garageTypeUsed || null);

    logStatus(info.lastInsertRowid, 'ajanlatra_var', 'Igény beérkezett');

    // Automatikus visszaigazoló e-mail az ügyfélnek
    email.sendInquiryReceived({ name, email: custEmail }).catch(err => console.error('Email hiba (inquiry received):', err));

    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Szerverhiba történt a beküldés közben.' });
  }
});

// ---------------------------------------------------------------
// Ügyfél elfogadja az árajánlatot (e-mailben kapott linkről)
// ---------------------------------------------------------------
router.get('/accept-offer/:token', (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE accept_token = ?').get(req.params.token);
  if (!customer) return res.status(404).send(simplePage('A hivatkozás nem érvényes.'));

  if (customer.status === 'ajanlat_kikuldve') {
    db.prepare('UPDATE customers SET status = ?, updated_at = ? WHERE id = ?')
      .run('ajanlat_elfogadva', new Date().toISOString(), customer.id);
    logStatus(customer.id, 'ajanlat_elfogadva', 'Ügyfél elfogadta az ajánlatot');
  }
  res.send(simplePage('Köszönjük! Az ajánlat elfogadását rögzítettük. Hamarosan felvesszük Önnel a kapcsolatot a megrendelőlappal kapcsolatban.'));
});

// ---------------------------------------------------------------
// Elégedettség értékelése
// ---------------------------------------------------------------
router.get('/satisfaction/:token', (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE satisfaction_token = ?').get(req.params.token);
  if (!customer) return res.status(404).send(simplePage('A hivatkozás nem érvényes.'));
  res.send(satisfactionFormPage(req.params.token));
});

router.post('/satisfaction/:token', (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE satisfaction_token = ?').get(req.params.token);
  if (!customer) return res.status(404).send(simplePage('A hivatkozás nem érvényes.'));
  const rating = parseInt(req.body.rating) || null;
  db.prepare('UPDATE customers SET satisfaction_rating = ?, updated_at = ? WHERE id = ?')
    .run(rating, new Date().toISOString(), customer.id);
  res.send(simplePage('Köszönjük az értékelést!'));
});

// ---------------------------------------------------------------
// Reklamáció beküldése (szöveg + képek)
// ---------------------------------------------------------------
router.get('/complaint/:token', (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE complaint_token = ?').get(req.params.token);
  if (!customer) return res.status(404).send(simplePage('A hivatkozás nem érvényes.'));
  res.send(complaintFormPage(req.params.token));
});

router.post('/complaint/:token', upload.array('photos', 8), (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE complaint_token = ?').get(req.params.token);
  if (!customer) return res.status(404).send(simplePage('A hivatkozás nem érvényes.'));

  const files = (req.files || []).map(f => `/uploads/complaints/${path.basename(f.path)}`);
  db.prepare('UPDATE customers SET status = ?, complaint_text = ?, complaint_files = ?, updated_at = ? WHERE id = ?')
    .run('garancialis_problema', req.body.text || '', JSON.stringify(files), new Date().toISOString(), customer.id);
  logStatus(customer.id, 'garancialis_problema', 'Ügyfél reklamációt küldött be');

  res.send(simplePage('Köszönjük a jelzést! Munkatársunk hamarosan felveszi Önnel a kapcsolatot.'));
});

// ---------------------------------------------------------------
// KOLLÉGANŐ FELÜLETE (lengyelül, nyomtatható, szerkeszthető, árral, számla-feltöltéssel)
// ---------------------------------------------------------------
router.get('/colleague/:token', (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE colleague_token = ?').get(req.params.token);
  if (!c) return res.status(404).send(simplePage('Nieprawidłowy link.'));
  res.send(colleaguePage(c));
});

router.post('/colleague/:token/save', (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE colleague_token = ?').get(req.params.token);
  if (!c) return res.status(404).json({ error: 'Nieprawidłowy link.' });
  const { name, phone, email: custEmail, zip, city, address, formData } = req.body;
  const merged = { ...JSON.parse(c.form_data || '{}'), ...(formData || {}) };
  if (merged.__gateType) merged.gateType = merged.__gateType; // szinkronban tartjuk a két kulcsot
  const quote = calculateQuote(merged);
  db.prepare(`UPDATE customers SET name=?, phone=?, email=?, zip=?, city=?, address=?, form_data=?, price_huf=?, price_breakdown=?, updated_at=? WHERE id=?`)
    .run(name || c.name, phone || c.phone, custEmail || c.email, zip || c.zip, city || c.city, address || c.address,
      JSON.stringify(merged), quote.totalHUF, JSON.stringify(quote), new Date().toISOString(), c.id);
  res.json({ ok: true, quote });
});

// A kolléganő kézzel felülírhatja a végösszeget — az előleg (30%) és a készpénzes kedvezmény (15%)
// ebből az új összegből számolódik újra, automatikusan.
router.post('/colleague/:token/update-price', (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE colleague_token = ?').get(req.params.token);
  if (!c) return res.status(404).json({ error: 'Nieprawidłowy link.' });
  const newTotal = parseInt(req.body.total);
  if (!newTotal || newTotal <= 0) return res.status(400).json({ error: 'Nieprawidłowa kwota.' });
  const quote = c.price_breakdown ? JSON.parse(c.price_breakdown) : {};
  quote.displayTotal = newTotal;
  quote.manuallyEdited = true;
  db.prepare('UPDATE customers SET price_huf=?, price_breakdown=?, updated_at=? WHERE id=?')
    .run(newTotal, JSON.stringify(quote), new Date().toISOString(), c.id);
  res.json({ ok: true, quote });
});

router.post('/colleague/:token/approve', async (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE colleague_token = ?').get(req.params.token);
  if (!c) return res.status(404).json({ error: 'Nieprawidłowy link.' });
  try {
    const quote = c.price_breakdown ? JSON.parse(c.price_breakdown) : null;
    const pdfBuffer = await generateOrderFormPdf(c, quote, 'hu');
    await email.sendFinalOrderFormToCustomer(c, pdfBuffer);
    db.prepare('UPDATE customers SET status=?, colleague_approved=1, updated_at=? WHERE id=?')
      .run('megrendelolap_kikuldve', new Date().toISOString(), c.id);
    logStatus(c.id, 'megrendelolap_kikuldve', 'Kolléganő jóváhagyta, megrendelőlap kiküldve az ügyfélnek');
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Błąd: ' + err.message });
  }
});

router.post('/colleague/:token/upload-invoice', invoiceUpload.single('invoice'), async (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE colleague_token = ?').get(req.params.token);
  if (!c) return res.status(404).json({ error: 'Nieprawidłowy link.' });
  if (!req.file) return res.status(400).json({ error: 'Brak pliku.' });
  const relPath = `/uploads/invoices/${path.basename(req.file.path)}`;
  try {
    const buffer = fs.readFileSync(req.file.path);
    await email.sendAdvanceInvoice({ ...c, invoice_file: relPath }, buffer, path.basename(req.file.path));
    db.prepare('UPDATE customers SET invoice_file=?, status=?, updated_at=? WHERE id=?')
      .run(relPath, 'elolegszamla_kikuldve', new Date().toISOString(), c.id);
    logStatus(c.id, 'elolegszamla_kikuldve', 'Kolléganő feltöltötte és kiküldte az előlegszámlát');
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Błąd: ' + err.message });
  }
});

// ---------------------------------------------------------------
// Ügyfél elfogadja a megrendelőlapot / módosítást kér
// ---------------------------------------------------------------
router.get('/order-approve/:token', (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE accept_token = ?').get(req.params.token);
  if (!c) return res.status(404).send(simplePage('A hivatkozás nem érvényes.'));
  db.prepare('UPDATE customers SET status=?, updated_at=? WHERE id=?')
    .run('megrendelolap_elfogadva', new Date().toISOString(), c.id);
  logStatus(c.id, 'megrendelolap_elfogadva', 'Ügyfél elfogadta a megrendelőlapot');
  res.send(simplePage('Köszönjük! A megrendelőlap elfogadását rögzítettük. Hamarosan küldjük az előlegszámlát.'));
});

router.get('/order-modify/:token', (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE accept_token = ?').get(req.params.token);
  if (!c) return res.status(404).send(simplePage('A hivatkozás nem érvényes.'));
  res.send(modifyFormPage(req.params.token));
});

// ---------------------------------------------------------------
// Ügyfél módosítani szeretné az ajánlatban szereplő tételeket — a kolléganőéhez hasonló,
// teljesen szerkeszthető felület, magyarul. Mentéskor újraszámolja az árat, és ez azonnal
// látszik a backoffice-ban (a lista a legutóbb módosultak szerint rendezve).
// ---------------------------------------------------------------
router.get('/modify-offer/:token', (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE accept_token = ?').get(req.params.token);
  if (!c) return res.status(404).send(simplePage('A hivatkozás nem érvényes.'));
  res.send(modifyOfferPage(c));
});

router.post('/modify-offer/:token/save', (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE accept_token = ?').get(req.params.token);
  if (!c) return res.status(404).json({ error: 'A hivatkozás nem érvényes.' });
  const { formData } = req.body;
  const merged = { ...JSON.parse(c.form_data || '{}'), ...(formData || {}) };
  if (merged.__gateType) merged.gateType = merged.__gateType; // szinkronban tartjuk a két kulcsot
  const quote = calculateQuote(merged);
  const now = new Date().toISOString();
  // Csak akkor mentjük el "az admin által utoljára látott állapotot", ha még nincs elmentve —
  // így ha az ügyfél többször is módosít, mielőtt az admin megnézné, mindig az EREDETI
  // (admin által utoljára ismert) állapothoz képest látszik, mi változott.
  const preEditData = c.pre_edit_form_data || c.form_data;
  db.prepare('UPDATE customers SET form_data=?, price_huf=?, price_breakdown=?, customer_edited_at=?, pre_edit_form_data=?, updated_at=? WHERE id=?')
    .run(JSON.stringify(merged), quote.totalHUF, JSON.stringify(quote), now, preEditData, now, c.id);
  logStatus(c.id, c.status, 'Ügyfél módosította az ajánlat tételeit, ár újraszámolva');

  if (process.env.ADMIN_NOTIFY_EMAIL) {
    const notifyHtml = `<div style="font-family:Arial,sans-serif">
      <h3>Ügyfél módosította a saját ajánlatát</h3>
      <p><strong>${escapeHtml(c.name)}</strong> (${escapeHtml(c.email)}) módosított a garázs beállításain — az új ár: ${quote.displayTotal.toLocaleString('hu-HU')} Ft (${quote.displayLabel}).</p>
      <p>Nézd meg a backoffice-ban a részleteket.</p>
    </div>`;
    email.sendMail({ to: process.env.ADMIN_NOTIFY_EMAIL, subject: 'Ügyfél módosított egy ajánlatot – ' + c.name, html: notifyHtml })
      .catch(err => console.error('Admin értesítő email hiba:', err));
  }

  res.json({ ok: true, quote });
});

// ---------------------------------------------------------------
// Ügyfél elutasítja az ajánlatot — indoklást kérünk
// ---------------------------------------------------------------
router.get('/reject-offer/:token', (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE accept_token = ?').get(req.params.token);
  if (!c) return res.status(404).send(simplePage('A hivatkozás nem érvényes.'));
  res.send(rejectFormPage(req.params.token));
});

router.post('/reject-offer/:token', (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE accept_token = ?').get(req.params.token);
  if (!c) return res.status(404).send(simplePage('A hivatkozás nem érvényes.'));
  const reason = req.body.reason || '';
  db.prepare('UPDATE customers SET status=?, reject_reason=?, reject_at=?, updated_at=? WHERE id=?')
    .run('elutasitva', reason, new Date().toISOString(), new Date().toISOString(), c.id);
  logStatus(c.id, 'elutasitva', 'Ügyfél elutasította az ajánlatot: ' + reason);
  res.send(simplePage('Köszönjük a visszajelzést. Sajnáljuk, hogy nem tudtunk megfelelni az elképzeléseinek.'));
});

router.post('/order-modify/:token', async (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE accept_token = ?').get(req.params.token);
  if (!c) return res.status(404).send(simplePage('A hivatkozás nem érvényes.'));
  const text = req.body.text || '';
  db.prepare('UPDATE customers SET modify_request_text=?, modify_request_at=?, updated_at=? WHERE id=?')
    .run(text, new Date().toISOString(), new Date().toISOString(), c.id);
  logStatus(c.id, c.status, 'Ügyfél módosítást kért: ' + text);

  const notifyHtml = `<div style="font-family:Arial,sans-serif">
    <h3>Módosítást kért az ügyfél</h3>
    <p><strong>${escapeHtml(c.name)}</strong> (${escapeHtml(c.email)})</p>
    <p>${escapeHtml(text)}</p>
  </div>`;
  Promise.all([
    email.sendMail({ to: process.env.ADMIN_NOTIFY_EMAIL, subject: 'Ügyfél módosítást kért – ' + c.name, html: notifyHtml }),
    process.env.COLLEAGUE_EMAIL ? email.sendMail({ to: process.env.COLLEAGUE_EMAIL, subject: 'Klient prosi o zmiany – ' + c.name, html: notifyHtml }) : Promise.resolve(),
  ]).catch(err => console.error('Értesítő email hiba:', err));

  res.send(simplePage('Köszönjük! Rögzítettük a módosítási kérését, munkatársunk hamarosan felveszi Önnel a kapcsolatot.'));
});

function escapeHtml(str){
  return String(str==null?'':str).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function modifyFormPage(token){
  return `<!DOCTYPE html><html lang="hu"><head><meta charset="UTF-8"><title>Módosítás kérése</title>
  <style>body{font-family:Arial,sans-serif;background:#EEF1F2;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}
  .box{background:#fff;padding:32px 40px;border-radius:6px;border-top:4px solid #454C54;max-width:480px;width:100%}
  textarea{width:100%;min-height:120px;padding:8px;margin:10px 0}
  button{background:#454C54;color:#fff;border:none;padding:10px 18px;border-radius:4px;cursor:pointer;font-size:1rem}</style>
  </head><body><div class="box">
  <h2>Milyen módosítást szeretne?</h2>
  <form method="POST" action="/public/order-modify/${token}">
    <textarea name="text" placeholder="Írja le, mit szeretne módosítani a megrendelőlapon..." required></textarea>
    <button type="submit">Küldés</button>
  </form>
  </div></body></html>`;
}

function rejectFormPage(token){
  return `<!DOCTYPE html><html lang="hu"><head><meta charset="UTF-8"><title>Ajánlat elutasítása</title>
  <style>body{font-family:Arial,sans-serif;background:#EEF1F2;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}
  .box{background:#fff;padding:32px 40px;border-radius:6px;border-top:4px solid #b23a3a;max-width:480px;width:100%}
  textarea{width:100%;min-height:120px;padding:8px;margin:10px 0}
  button{background:#b23a3a;color:#fff;border:none;padding:10px 18px;border-radius:4px;cursor:pointer;font-size:1rem}</style>
  </head><body><div class="box">
  <h2>Miért utasítja el az ajánlatot?</h2>
  <p style="color:#7a828a;font-size:0.9rem">Visszajelzése segít nekünk, hogy legközelebb jobb ajánlatot adjunk.</p>
  <form method="POST" action="/public/reject-offer/${token}">
    <textarea name="reason" placeholder="Pl. túl magas ár, más ajánlatot választott, már nincs szüksége garázsra, stb." required></textarea>
    <button type="submit">Elutasítás elküldése</button>
  </form>
  </div></body></html>`;
}

function modifyOfferPage(c){
  const fd = JSON.parse(c.form_data || '{}');
  const quote = c.price_breakdown ? JSON.parse(c.price_breakdown) : null;
  const sections = buildOrderFields(fd, 'hu', true);

  return `<!DOCTYPE html><html lang="hu"><head><meta charset="UTF-8"><title>Ajánlat módosítása – ${escapeHtml(c.name)}</title>
  <style>
    body{font-family:Arial,sans-serif;background:#EEF1F2;margin:0;padding:20px;color:#20242A}
    .box{background:#fff;max-width:820px;margin:0 auto;padding:30px;border-radius:6px;border-top:4px solid #F2B705}
    .two-col{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:16px 0}
    .section{margin-bottom:14px}
    .section h2{font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;color:#fff;background:#454C54;padding:5px 10px;border-radius:4px 4px 0 0;margin:0}
    .section table{width:100%;border-collapse:collapse;border:1px solid #e6e8ea;border-top:none}
    .section td{padding:5px 10px;font-size:12px;border-bottom:1px solid #f0f1f2}
    .section td.label{color:#7a828a;width:40%;font-size:10.5px;text-transform:uppercase}
    .sketch{background:#161A1E;padding:14px;border-radius:6px;margin:16px 0;text-align:center}
    .sketch svg{max-width:340px;width:100%}
    .price-card{background:#fafbfb;border:2px solid #20242A;border-radius:8px;padding:18px 22px;text-align:center;margin:18px 0}
    .price-card .amount{font-size:26px;font-weight:700}
    .price-card .label{font-size:10px;color:#8a5a03;text-transform:uppercase;letter-spacing:.06em;margin-top:3px;font-weight:bold}
    button{background:#F2B705;border:none;padding:12px 20px;border-radius:4px;cursor:pointer;font-weight:bold;margin:6px 6px 6px 0;font-size:0.95rem}
    input{padding:4px 6px;border:1px solid #C7D0D6;border-radius:3px;font-size:11px;width:100%}
  </style></head><body>
  <div class="box">
    <h2>Ajánlat módosítása — ${escapeHtml(c.name)}</h2>
    <p style="color:#7a828a">Módosítsa az alábbi tételeket, ha másra van szüksége — az ár automatikusan újraszámolódik.</p>

    ${c.sketch_svg ? `<div class="sketch">${c.sketch_svg}</div>` : ''}

    <div class="two-col">
      <div>${sections.slice(0, Math.ceil(sections.length/2)).map(editableSectionHtml).join('')}</div>
      <div>${sections.slice(Math.ceil(sections.length/2)).map(editableSectionHtml).join('')}</div>
    </div>

    <div class="price-card">
      <div class="amount" id="priceAmount">${quote ? quote.displayTotal.toLocaleString('hu-HU') : '—'} Ft</div>
      <div class="label">${quote ? (quote.displayLabel||'').toUpperCase() : ''}</div>
    </div>

    <button onclick="saveChanges()">Módosítások mentése</button>
    <div id="statusMsg" style="margin-top:14px;font-weight:bold"></div>
  </div>
  <script>
    const token = ${JSON.stringify(c.accept_token)};
    function msg(t){ document.getElementById('statusMsg').textContent = t; }
    async function saveChanges(){
      const formData = {};
      document.querySelectorAll('[data-key]').forEach(el => { formData[el.dataset.key] = (el.type==='checkbox') ? el.checked : el.value; });
      const res = await fetch('/public/modify-offer/'+token+'/save', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ formData }) });
      const data = await res.json();
      if(res.ok){
        msg('Módosítások mentve, munkatársunk hamarosan új ajánlatot küld.');
        setTimeout(()=>location.reload(), 800);
      } else {
        msg('Hiba: '+data.error);
      }
    }
  </script>
  </body></html>`;
}

function colleaguePage(c){
  const fd = JSON.parse(c.form_data || '{}');
  const quote = c.price_breakdown ? JSON.parse(c.price_breakdown) : null;
  const sections = buildOrderFields(fd, 'pl', true);
  const companySection = sections.find(s => s.items.some(it => it.key === 'custCompanyName'));
  const otherSections = sections.filter(s => !s.items.some(it => it.key === 'custCompanyName'));
  const lightSketch = c.sketch_svg ? prepareColleagueSketch(c.sketch_svg) : '';

  return `<!DOCTYPE html><html lang="pl"><head><meta charset="UTF-8"><title>Zamówienie – ${escapeHtml(c.name)}</title>
  <style>
    body{font-family:Arial,sans-serif;background:#EEF1F2;margin:0;padding:20px;color:#20242A}
    .box{background:#fff;max-width:820px;margin:0 auto;padding:30px;border-radius:6px;border-top:4px solid #F2B705}
    label{display:block;font-size:0.85rem;color:#454C54;margin:10px 0 4px}
    input,textarea{width:100%;padding:9px;border:1px solid #C7D0D6;border-radius:4px;font-size:1rem}
    .cust-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;background:#fafbfb;border:1px solid #e6e8ea;border-radius:8px;padding:16px 20px;margin-bottom:16px}
    .cust-grid div{font-size:15px}
    .cust-grid .l{color:#7a828a;font-size:11px;text-transform:uppercase;letter-spacing:.03em;display:block;margin-bottom:2px}
    .two-col{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:16px 0}
    .section{margin-bottom:14px}
    .section h2{font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;color:#fff;background:#454C54;padding:5px 10px;border-radius:4px 4px 0 0;margin:0}
    .section table{width:100%;border-collapse:collapse;border:1px solid #e6e8ea;border-top:none}
    .section td{padding:5px 10px;font-size:12px;border-bottom:1px solid #f0f1f2}
    .section td.label{color:#7a828a;width:40%;font-size:10.5px;text-transform:uppercase}
    button{background:#F2B705;border:none;padding:12px 20px;border-radius:4px;cursor:pointer;font-weight:bold;margin:6px 6px 6px 0;font-size:0.95rem}
    .btn-approve{background:#2F6B4F;color:#fff}
    .btn-print{background:#454C54;color:#fff}
    .sketch{background:#fff;border:1px solid #C7D0D6;padding:14px;border-radius:6px;margin:16px 0}
    .sketch svg{width:100%;height:auto}
    .price-card{background:#fafbfb;border:2px solid #20242A;color:#20242A;border-radius:8px;padding:18px 22px;text-align:center;margin:18px 0}
    .price-card .amount-row{display:flex;align-items:center;justify-content:center;gap:8px}
    .price-card input.amount-input{width:220px;background:#fff;border:1px solid #C7D0D6;color:#20242A;font-size:26px;font-weight:700;text-align:center;border-radius:6px;padding:4px 8px}
    .price-card .ft-suffix{font-size:18px;color:#454C54}
    .price-card .label{font-size:10px;color:#8a5a03;text-transform:uppercase;letter-spacing:.06em;margin-top:3px;font-weight:bold}
    .price-card .advance{font-size:12px;color:#454C54;margin-top:10px;border-top:1px solid #e0e3e5;padding-top:8px}
    .price-card .cash-note{font-size:9.5px;color:#7a828a;margin-top:6px;line-height:1.4}
    .price-card button.save-price{margin-top:10px;background:#F2B705;color:#20242A;padding:8px 16px;font-size:0.8rem}
    .invoice-box{border:2px solid #F2B705;border-radius:8px;padding:18px 20px;margin:20px 0;background:#fffdf5}
    .invoice-box h3{margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.03em;color:#454C54}
    @media print{ button, input[type=file], .no-print{display:none !important} }
  </style></head><body>
  <div class="box">
    <h2>Zamówienie — ${escapeHtml(c.name)}</h2>

    <div class="cust-grid">
      <div><span class="l">Imię i nazwisko</span><input id="f_name" value="${escapeHtml(c.name)}"></div>
      <div><span class="l">Telefon</span><input id="f_phone" value="${escapeHtml(c.phone)}"></div>
      <div><span class="l">Email</span><input id="f_email" value="${escapeHtml(c.email)}"></div>
      <div><span class="l">Kod pocztowy</span><input id="f_zip" value="${escapeHtml(c.zip)}"></div>
      <div><span class="l">Miasto</span><input id="f_city" value="${escapeHtml(c.city)}"></div>
      <div><span class="l">Adres (ulica, nr domu)</span><input id="f_address" value="${escapeHtml(c.address)}"></div>
    </div>

    ${fd.truckParkingDistance ? `<p style="background:#fff7e0;border:1px solid #F2B705;padding:8px 12px;border-radius:4px;font-size:0.85rem"><strong>Parkowanie ciężarówki przy miejscu montażu:</strong> ${escapeHtml(fd.truckParkingDistance)}</p>` : ''}
    ${companySection ? editableSectionHtml(companySection) : ''}
    ${lightSketch ? `<div class="sketch">${lightSketch}</div>` : ''}

    <div class="two-col">
      <div>${otherSections.slice(0, Math.ceil(otherSections.length/2)).map(editableSectionHtml).join('')}</div>
      <div>${otherSections.slice(Math.ceil(otherSections.length/2)).map(editableSectionHtml).join('')}</div>
    </div>

    <div class="price-card">
      <div class="amount-row">
        <input type="number" id="priceInput" class="amount-input" value="${quote ? quote.displayTotal : 0}">
        <span class="ft-suffix">Ft</span>
      </div>
      <div class="label">${quote ? (quote.displayLabel||'').toUpperCase() : ''}</div>
      <div class="advance" id="advanceText"></div>
      <div class="cash-note" id="cashNoteText"></div>
      <div class="no-print"><button class="save-price" onclick="savePrice()">Zapisz cenę</button></div>
    </div>

    <div class="no-print">
      <button onclick="saveData()">Zapisz zmiany</button>
      <button class="btn-approve" onclick="approveOrder()">Zatwierdź</button>
      <button class="btn-print" onclick="window.print()">Drukuj</button>
    </div>

    <div class="invoice-box no-print">
      <h3>Faktura zaliczkowa</h3>
      <input type="file" id="invoiceFile" accept="application/pdf">
      <button onclick="uploadInvoice()">Wyślij fakturę do klienta</button>
    </div>
    <div id="statusMsg" style="margin-top:14px;font-weight:bold"></div>
  </div>
  <script>
    const token = ${JSON.stringify(c.colleague_token)};
    const isPrivateIndividual = ${JSON.stringify(fd.custInvoice === 'nem')};
    function fmt(n){ return Math.round(n).toLocaleString('hu-HU'); }
    function updatePricePreview(){
      const total = parseFloat(document.getElementById('priceInput').value) || 0;
      const advance = Math.round(total*0.30/100)*100;
      document.getElementById('advanceText').textContent = 'Zaliczka (30%): ' + fmt(advance) + ' Ft';
      const cashNoteEl = document.getElementById('cashNoteText');
      if(isPrivateIndividual){
        const discounted = Math.round(total*0.85/100)*100;
        cashNoteEl.textContent = 'Jeśli pozostała kwota zostanie uregulowana gotówką, osoby prywatne otrzymują 15% rabatu od kwoty całkowitej. Kwota po rabacie: ' + fmt(discounted) + ' Ft.';
      } else {
        cashNoteEl.textContent = '';
      }
    }
    document.getElementById('priceInput').addEventListener('input', updatePricePreview);
    updatePricePreview();
    async function savePrice(){
      const total = parseFloat(document.getElementById('priceInput').value) || 0;
      const res = await fetch('/public/colleague/'+token+'/update-price', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ total }) });
      const data = await res.json();
      msg(res.ok ? 'Cena zapisana.' : 'Błąd: '+data.error);
    }
    function msg(t){ document.getElementById('statusMsg').textContent = t; }
    async function saveData(){
      const formData = {};
      document.querySelectorAll('[data-key]').forEach(el => { formData[el.dataset.key] = (el.type==='checkbox') ? el.checked : el.value; });
      const body = {
        name: document.getElementById('f_name').value,
        phone: document.getElementById('f_phone').value,
        email: document.getElementById('f_email').value,
        zip: document.getElementById('f_zip').value,
        city: document.getElementById('f_city').value,
        address: document.getElementById('f_address').value,
        formData: formData,
      };
      const res = await fetch('/public/colleague/'+token+'/save', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      const data = await res.json();
      msg(res.ok ? 'Zapisano.' : 'Błąd: '+data.error);
      if(res.ok) setTimeout(()=>location.reload(), 800);
    }
    async function approveOrder(){
      if(!confirm('Na pewno zatwierdzić i wysłać do klienta?')) return;
      const res = await fetch('/public/colleague/'+token+'/approve', { method:'POST' });
      const data = await res.json();
      msg(res.ok ? 'Zatwierdzono i wysłano do klienta.' : 'Błąd: '+data.error);
    }
    async function uploadInvoice(){
      const fileInput = document.getElementById('invoiceFile');
      if(!fileInput.files[0]) return alert('Wybierz plik.');
      const form = new FormData();
      form.append('invoice', fileInput.files[0]);
      const res = await fetch('/public/colleague/'+token+'/upload-invoice', { method:'POST', body: form });
      const data = await res.json();
      msg(res.ok ? 'Faktura wysłana.' : 'Błąd: '+data.error);
    }
  </script>
  </body></html>`;
}

function logStatus(customerId, status, note) {
  db.prepare('INSERT INTO status_log (customer_id, status, changed_at, note) VALUES (?, ?, ?, ?)')
    .run(customerId, status, new Date().toISOString(), note || '');
}

function simplePage(message) {
  return `<!DOCTYPE html><html lang="hu"><head><meta charset="UTF-8"><title>Pol-Bram</title>
  <style>body{font-family:Arial,sans-serif;background:#EEF1F2;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
  .box{background:#fff;padding:32px 40px;border-radius:6px;border-top:4px solid #F2B705;max-width:480px;text-align:center}</style>
  </head><body><div class="box"><h2>Pol-Bram</h2><p>${message}</p></div></body></html>`;
}

function satisfactionFormPage(token) {
  return `<!DOCTYPE html><html lang="hu"><head><meta charset="UTF-8"><title>Elégedettség értékelése</title>
  <style>body{font-family:Arial,sans-serif;background:#EEF1F2;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
  .box{background:#fff;padding:32px 40px;border-radius:6px;border-top:4px solid #F2B705;max-width:480px;text-align:center}
  button{background:#F2B705;border:none;padding:10px 18px;margin:4px;border-radius:4px;cursor:pointer;font-size:1rem}</style>
  </head><body><div class="box">
  <h2>Mennyire elégedett a garázsával?</h2>
  <form method="POST" action="/public/satisfaction/${token}">
    ${[1,2,3,4,5].map(n=>`<button type="submit" name="rating" value="${n}">${n} ⭐</button>`).join('')}
  </form>
  </div></body></html>`;
}

function complaintFormPage(token) {
  return `<!DOCTYPE html><html lang="hu"><head><meta charset="UTF-8"><title>Reklamáció beküldése</title>
  <style>body{font-family:Arial,sans-serif;background:#EEF1F2;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}
  .box{background:#fff;padding:32px 40px;border-radius:6px;border-top:4px solid #b23a3a;max-width:480px;width:100%}
  textarea{width:100%;min-height:100px;padding:8px;margin:10px 0}
  button{background:#b23a3a;color:#fff;border:none;padding:10px 18px;border-radius:4px;cursor:pointer;font-size:1rem}</style>
  </head><body><div class="box">
  <h2>Reklamáció beküldése</h2>
  <form method="POST" action="/public/complaint/${token}" enctype="multipart/form-data">
    <textarea name="text" placeholder="Írja le a problémát..." required></textarea>
    <input type="file" name="photos" accept="image/*" multiple>
    <br><br>
    <button type="submit">Beküldés</button>
  </form>
  </div></body></html>`;
}

module.exports = router;
