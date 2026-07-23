const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../../db');
const requireAuth = require('../middleware/requireAuth');
const { calculateQuote } = require('../services/pricing');
const { generateOrderFormPdf, buildOrderFields, sectionHtml, editableSectionHtml } = require('../services/pdf');
const email = require('../services/email');

const router = express.Router();
router.use(requireAuth);

const invoiceUploadDir = path.join(__dirname, '..', '..', 'uploads', 'invoices');
if (!fs.existsSync(invoiceUploadDir)) fs.mkdirSync(invoiceUploadDir, { recursive: true });
const invoiceUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, invoiceUploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  }),
});

// ---------------------------------------------------------------
// Ügyfelek listája
// ---------------------------------------------------------------
router.get('/customers', (req, res) => {
  const rows = db.prepare(`
    SELECT id, created_at, status, name, address, zip, city, phone, email, price_huf
    FROM customers ORDER BY updated_at DESC
  `).all();
  res.json(rows);
});

// ---------------------------------------------------------------
// Egy ügyfél teljes adatlapja
// ---------------------------------------------------------------
router.get('/customers/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Nem található.' });
  res.json({
    ...c,
    form_data: JSON.parse(c.form_data || '{}'),
    price_breakdown: c.price_breakdown ? JSON.parse(c.price_breakdown) : null,
    complaint_files: c.complaint_files ? JSON.parse(c.complaint_files) : [],
  });
});

// ---------------------------------------------------------------
// Ügyféladatok módosítása és mentése (a felugró ablakban szerkesztve)
// ---------------------------------------------------------------
router.put('/customers/:id', (req, res) => {
  const { name, phone, email: custEmail, zip, city, address, formData, summaryText, sketchSvg } = req.body;
  db.prepare(`
    UPDATE customers SET name=?, phone=?, email=?, zip=?, city=?, address=?,
      form_data=?, summary_text=?, sketch_svg=?, updated_at=?
    WHERE id=?
  `).run(name, phone, custEmail, zip, city, address,
    JSON.stringify(formData || {}), summaryText || '', sketchSvg || '', new Date().toISOString(), req.params.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------
// Admin oldali teljes adat-szerkesztő (ugyanaz, mint a kolléganőnek, csak bejelentkezéssel védve)
// ---------------------------------------------------------------
router.get('/customers/:id/editor', (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).send('Nem található.');
  const fd = JSON.parse(c.form_data || '{}');
  const quote = c.price_breakdown ? JSON.parse(c.price_breakdown) : null;
  const sections = buildOrderFields(fd, 'hu', true);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  res.send(`<!DOCTYPE html><html lang="hu"><head><meta charset="UTF-8"><title>Adatok szerkesztése – ${esc(c.name)}</title>
  <style>
    body{font-family:Arial,sans-serif;background:#EEF1F2;margin:0;padding:20px;color:#20242A}
    .box{background:#fff;max-width:820px;margin:0 auto;padding:30px;border-radius:6px;border-top:4px solid #F2B705}
    .cust-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;background:#fafbfb;border:1px solid #e6e8ea;border-radius:8px;padding:16px 20px;margin-bottom:16px}
    .cust-grid div{font-size:15px}
    .cust-grid .l{color:#7a828a;font-size:11px;text-transform:uppercase;letter-spacing:.03em;display:block;margin-bottom:2px}
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
    input,select{padding:4px 6px;border:1px solid #C7D0D6;border-radius:3px;font-size:11px;width:100%}
  </style></head><body>
  <div class="box">
    <h2>Adatok szerkesztése — ${esc(c.name)}</h2>
    <div class="cust-grid">
      <div><span class="l">Név</span><input id="f_name" value="${esc(c.name)}"></div>
      <div><span class="l">Telefon</span><input id="f_phone" value="${esc(c.phone)}"></div>
      <div><span class="l">Email</span><input id="f_email" value="${esc(c.email)}"></div>
      <div><span class="l">Irányítószám</span><input id="f_zip" value="${esc(c.zip)}"></div>
      <div><span class="l">Város</span><input id="f_city" value="${esc(c.city)}"></div>
      <div><span class="l">Cím</span><input id="f_address" value="${esc(c.address)}"></div>
    </div>

    ${c.sketch_svg ? `<div class="sketch">${c.sketch_svg}</div>` : ''}

    <div class="two-col">
      <div>${sections.slice(0, Math.ceil(sections.length/2)).map(editableSectionHtml).join('')}</div>
      <div>${sections.slice(Math.ceil(sections.length/2)).map(editableSectionHtml).join('')}</div>
    </div>

    <div class="price-card">
      <div class="amount" id="priceAmount">${quote ? quote.displayTotal.toLocaleString('hu-HU') : '—'} Ft</div>
      <div class="label">${quote ? (quote.displayLabel||'').toUpperCase() : ''}</div>
    </div>

    <button onclick="saveChanges()">Mentés és újraszámolás</button>
    <div id="statusMsg" style="margin-top:14px;font-weight:bold"></div>
  </div>
  <script>
    async function saveChanges(){
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
      const res = await fetch(window.location.pathname.replace('/editor','')+'/update-form-data', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      const data = await res.json();
      const msgEl = document.getElementById('statusMsg');
      if(res.ok){
        msgEl.textContent = 'Mentve, ár újraszámolva.';
        setTimeout(()=>location.reload(), 800);
      } else {
        msgEl.textContent = 'Hiba: '+data.error;
      }
    }
  </script>
  </body></html>`);
});

router.post('/customers/:id/update-form-data', (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Nem található.' });
  const { name, phone, email: custEmail, zip, city, address, formData } = req.body;
  const merged = { ...JSON.parse(c.form_data || '{}'), ...(formData || {}) };
  if (merged.__gateType) merged.gateType = merged.__gateType;
  const quote = calculateQuote(merged);
  db.prepare(`
    UPDATE customers SET name=?, phone=?, email=?, zip=?, city=?, address=?, form_data=?, price_huf=?, price_breakdown=?, updated_at=?
    WHERE id=?
  `).run(name || c.name, phone || c.phone, custEmail || c.email, zip || c.zip, city || c.city, address || c.address,
    JSON.stringify(merged), quote.totalHUF, JSON.stringify(quote), new Date().toISOString(), c.id);
  res.json({ ok: true, quote });
});

// ---------------------------------------------------------------
// Ár kiszámítása (Excel-logika alapján)
// ---------------------------------------------------------------
router.post('/customers/:id/calculate', (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Nem található.' });

  const formData = JSON.parse(c.form_data || '{}');
  const quote = calculateQuote(formData);

  db.prepare('UPDATE customers SET price_huf=?, price_breakdown=?, updated_at=? WHERE id=?')
    .run(quote.totalHUF, JSON.stringify(quote), new Date().toISOString(), c.id);

  res.json(quote);
});

// ---------------------------------------------------------------
// Ajánlat kiküldése az ügyfélnek — csak egy végösszeg (áfa igény szerint nettó/bruttó), tételezés nélkül
// ---------------------------------------------------------------
router.post('/customers/:id/send-offer', async (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Nem található.' });
  if (!c.price_breakdown) return res.status(400).json({ error: 'Előbb számolja ki az árat.' });

  const quote = JSON.parse(c.price_breakdown);
  const priceText = `${quote.displayTotal.toLocaleString('hu-HU')} Ft (${quote.displayLabel})`;
  try {
    const fd = JSON.parse(c.form_data || '{}');
    const sections = buildOrderFields(fd, 'hu');
    const detailsHtml = `<div>${sections.map(sectionHtml).join('')}</div>`;
    const sketchHtml = c.sketch_svg ? `<div style="background:#161A1E;border-radius:8px;padding:14px;text-align:center;margin:16px 0">${c.sketch_svg}</div>` : '';
    await email.sendOffer(c, priceText, { detailsHtml, sketchHtml });
    db.prepare('UPDATE customers SET status=?, offer_sent_at=?, reminder_sent_at=NULL, updated_at=? WHERE id=?')
      .run('ajanlat_kikuldve', new Date().toISOString(), new Date().toISOString(), c.id);
    logStatus(c.id, 'ajanlat_kikuldve', 'Ajánlat kiküldve az ügyfélnek');
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Hiba az e-mail küldése közben: ' + err.message });
  }
});

// ---------------------------------------------------------------
// Emlékeztető email kézi kiküldése bármikor (az automatikus, 5 napos emlékeztetőtől függetlenül)
// ---------------------------------------------------------------
router.post('/customers/:id/send-reminder', async (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Nem található.' });
  if (!c.price_breakdown) return res.status(400).json({ error: 'Nincs kiszámolt ár.' });

  const quote = JSON.parse(c.price_breakdown);
  const priceText = `${quote.displayTotal.toLocaleString('hu-HU')} Ft (${quote.displayLabel})`;
  try {
    await email.sendOfferReminder(c, priceText);
    db.prepare('UPDATE customers SET reminder_sent_at=?, updated_at=? WHERE id=?')
      .run(new Date().toISOString(), new Date().toISOString(), c.id);
    logStatus(c.id, c.status, 'Emlékeztető e-mail kiküldve (kézi)');
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Hiba az emlékeztető küldése közben: ' + err.message });
  }
});

// ---------------------------------------------------------------
// Megrendelőlap-folyamat indítása: link kiküldése a lengyel kolléganőnek (ő tekinti át/javítja, majd hagyja jóvá)
// ---------------------------------------------------------------
router.post('/customers/:id/send-order-form-colleague', async (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Nem található.' });

  try {
    let token = c.colleague_token;
    if (!token) {
      token = uuidv4();
      db.prepare('UPDATE customers SET colleague_token=? WHERE id=?').run(token, c.id);
      c.colleague_token = token;
    }
    await email.sendOrderFormToColleague(c);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Hiba a kolléganőnek szóló e-mail küldése közben: ' + err.message });
  }
});

// ---------------------------------------------------------------
// Végleges megrendelőlap kézi (újra-)küldése az ügyfélnek (HU PDF) — normál esetben ezt a
// kolléganő jóváhagyása indítja automatikusan (lásd /public/colleague/:token/approve), ez a gomb
// csak tartalék / kézi újraküldésre szolgál.
// ---------------------------------------------------------------
router.post('/customers/:id/send-order-form-customer', async (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Nem található.' });
  const quote = c.price_breakdown ? JSON.parse(c.price_breakdown) : null;

  try {
    const pdfBuffer = await generateOrderFormPdf(c, quote, 'hu');
    await email.sendFinalOrderFormToCustomer(c, pdfBuffer);
    db.prepare('UPDATE customers SET status=?, updated_at=? WHERE id=?')
      .run('megrendelolap_kikuldve', new Date().toISOString(), c.id);
    logStatus(c.id, 'megrendelolap_kikuldve', 'Megrendelőlap kiküldve az ügyfélnek (kézi)');
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Hiba a megrendelőlap küldése közben: ' + err.message });
  }
});

// ---------------------------------------------------------------
// Előlegszámla feltöltése
// ---------------------------------------------------------------
router.post('/customers/:id/upload-invoice', invoiceUpload.single('invoice'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nincs feltöltött fájl.' });
  const relPath = `/uploads/invoices/${path.basename(req.file.path)}`;
  db.prepare('UPDATE customers SET invoice_file=?, updated_at=? WHERE id=?')
    .run(relPath, new Date().toISOString(), req.params.id);
  res.json({ ok: true, file: relPath });
});

// ---------------------------------------------------------------
// Előlegszámla kiküldése
// ---------------------------------------------------------------
router.post('/customers/:id/send-invoice', async (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Nem található.' });
  if (!c.invoice_file) return res.status(400).json({ error: 'Előbb töltse fel az előlegszámla PDF-et.' });

  try {
    const filePath = path.join(__dirname, '..', '..', c.invoice_file);
    const buffer = fs.readFileSync(filePath);
    await email.sendAdvanceInvoice(c, buffer, path.basename(c.invoice_file));
    db.prepare('UPDATE customers SET status=?, updated_at=? WHERE id=?')
      .run('elolegszamla_kikuldve', new Date().toISOString(), c.id);
    logStatus(c.id, 'elolegszamla_kikuldve', 'Előlegszámla kiküldve');
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Hiba az előlegszámla küldése közben: ' + err.message });
  }
});

// ---------------------------------------------------------------
// Telepítve gomb: státusz + értesítő e-mail (elégedettség + reklamáció linkkel)
// ---------------------------------------------------------------
router.post('/customers/:id/mark-installed', async (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Nem található.' });

  try {
    await email.sendInstalledNotice(c);
    db.prepare('UPDATE customers SET status=?, updated_at=? WHERE id=?')
      .run('telepitve', new Date().toISOString(), c.id);
    logStatus(c.id, 'telepitve', 'Garázs telepítve, értesítés kiküldve');
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Hiba az értesítés küldése közben: ' + err.message });
  }
});

// ---------------------------------------------------------------
// Státusz manuális felülírása (ha valamit kézzel kell javítani)
// ---------------------------------------------------------------
router.put('/customers/:id/status', (req, res) => {
  const { status } = req.body;
  db.prepare('UPDATE customers SET status=?, updated_at=? WHERE id=?').run(status, new Date().toISOString(), req.params.id);
  logStatus(req.params.id, status, 'Kézi státuszváltás a backoffice-ban');
  res.json({ ok: true });
});

function logStatus(customerId, status, note) {
  db.prepare('INSERT INTO status_log (customer_id, status, changed_at, note) VALUES (?, ?, ?, ?)')
    .run(customerId, status, new Date().toISOString(), note || '');
}

// ---------------------------------------------------------------
// Email sablonok kezelése
// ---------------------------------------------------------------
router.get('/email-templates', (req, res) => {
  const rows = db.prepare('SELECT key, label, subject, updated_at FROM email_templates ORDER BY label ASC').all();
  res.json(rows);
});
router.get('/email-templates/:key', (req, res) => {
  const t = db.prepare('SELECT * FROM email_templates WHERE key = ?').get(req.params.key);
  if (!t) return res.status(404).json({ error: 'Nem található.' });
  res.json(t);
});
router.put('/email-templates/:key', (req, res) => {
  const { subject, html_body } = req.body;
  db.prepare('UPDATE email_templates SET subject=?, html_body=?, updated_at=? WHERE key=?')
    .run(subject, html_body, new Date().toISOString(), req.params.key);
  res.json({ ok: true });
});

module.exports = router;
