const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../../db');
const requireAuth = require('../middleware/requireAuth');
const { calculateQuote } = require('../services/pricing');
const { generateOrderFormPdf } = require('../services/pdf');
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
    FROM customers ORDER BY created_at DESC
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
    await email.sendOffer(c, priceText);
    db.prepare('UPDATE customers SET status=?, updated_at=? WHERE id=?')
      .run('ajanlat_kikuldve', new Date().toISOString(), c.id);
    logStatus(c.id, 'ajanlat_kikuldve', 'Ajánlat kiküldve az ügyfélnek');
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Hiba az e-mail küldése közben: ' + err.message });
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
