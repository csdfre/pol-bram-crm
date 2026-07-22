const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../../db');
const email = require('../services/email');

const router = express.Router();

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
// Ügyfél beküldi az igényét a garázs-konfigurátor oldalról
// ---------------------------------------------------------------
router.post('/submit', async (req, res) => {
  try {
    const { name, phone, email: custEmail, zip, city, address, formData, summaryText, sketchSvg } = req.body;

    if (!custEmail) return res.status(400).json({ error: 'Hiányzik az e-mail cím.' });

    const now = new Date().toISOString();
    const acceptToken = uuidv4();
    const satisfactionToken = uuidv4();
    const complaintToken = uuidv4();

    const info = db.prepare(`
      INSERT INTO customers
        (created_at, updated_at, status, name, phone, email, zip, city, address, form_data, summary_text, sketch_svg,
         accept_token, satisfaction_token, complaint_token)
      VALUES (?, ?, 'ajanlatra_var', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(now, now, name, phone, custEmail, zip, city, address,
      JSON.stringify(formData || {}), summaryText || '', sketchSvg || '',
      acceptToken, satisfactionToken, complaintToken);

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
