const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../../db');
const requireAuth = require('../middleware/requireAuth');
const { calculateQuote } = require('../services/pricing');
const { generateOrderFormPdf, buildOrderFields, sectionHtml, sectionHtmlEmail, editableSectionHtml, renderSketchToPngBuffer, LOGO_B64, UNIT_TOGGLE_CSS, UNIT_TOGGLE_SCRIPT } = require('../services/pdf');
const email = require('../services/email');
const { buildColleagueReportBuffer } = require('../services/colleagueExcel');

const router = express.Router();
router.use(requireAuth);

const invoiceUploadDir = path.join(__dirname, '..', '..', 'data', 'uploads', 'invoices');
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
    SELECT id, created_at, status, name, address, zip, city, phone, email, price_huf, customer_edited_at, status_alert_at, status_alert_note
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
  if (c.customer_edited_at) {
    db.prepare('UPDATE customers SET customer_edited_at = NULL WHERE id = ?').run(req.params.id);
  }
  if (c.status_alert_at) {
    db.prepare('UPDATE customers SET status_alert_at = NULL, status_alert_note = NULL WHERE id = ?').run(req.params.id);
  }
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
// ---------------------------------------------------------------
// Ügyfél/igény törlése
// ---------------------------------------------------------------
router.delete('/customers/:id', (req, res) => {
  db.prepare('DELETE FROM status_log WHERE customer_id = ?').run(req.params.id);
  const info = db.prepare('DELETE FROM customers WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Nem található.' });
  res.json({ ok: true });
});

// ---------------------------------------------------------------
// Egy ügyfél teljes esemény-története (státuszváltások, megjegyzésekkel)
// ---------------------------------------------------------------
router.get('/customers/:id/history', (req, res) => {
  const rows = db.prepare('SELECT status, changed_at, note FROM status_log WHERE customer_id = ? ORDER BY changed_at DESC').all(req.params.id);
  res.json(rows);
});

// A "MÓDOSÍTOTT" jelzés gyors törlése (a lista-elemre kattintva, a teljes adatlap megnyitása nélkül)
router.post('/customers/:id/dismiss-edited-flag', (req, res) => {
  db.prepare('UPDATE customers SET customer_edited_at = NULL, recalculated_price_huf = NULL WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/customers/:id/dismiss-status-alert', (req, res) => {
  db.prepare('UPDATE customers SET status_alert_at = NULL, status_alert_note = NULL WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.get('/customers/:id/editor', (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).send('Nem található.');
  const fd = JSON.parse(c.form_data || '{}');
  const prevFd = c.pre_edit_form_data ? JSON.parse(c.pre_edit_form_data) : null;
  const quote = c.price_breakdown ? JSON.parse(c.price_breakdown) : null;
  const sections = buildOrderFields(fd, 'hu', true, prevFd);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  if (c.pre_edit_form_data) {
    db.prepare('UPDATE customers SET pre_edit_form_data = NULL WHERE id = ?').run(req.params.id);
  }

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
    ${UNIT_TOGGLE_CSS}
  </style></head><body>
  <div class="box">
    <h2>Adatok szerkesztése — ${esc(c.name)}</h2>
    <p style="font-size:0.85rem;color:#7a828a;margin-top:-8px;margin-bottom:14px">Választott típus: <strong>${esc(c.garage_type_used || 'Egyedi összeállítás')}</strong></p>
    ${prevFd ? `<div style="background:#fff7e0;border:1px solid #F2B705;border-radius:6px;padding:10px 14px;margin-bottom:14px;font-size:0.85rem"><strong>Az ügyfél módosított néhány adatot.</strong> A sárga kerettel jelölt mezők azok, amik az ügyfél szerkesztése előtti állapothoz képest megváltoztak.</div>` : ''}
    <div class="cust-grid">
      <div><span class="l">Név</span><input id="f_name" value="${esc(c.name)}"></div>
      <div><span class="l">Telefon</span><input id="f_phone" value="${esc(c.phone)}"></div>
      <div><span class="l">Email</span><input id="f_email" value="${esc(c.email)}"></div>
      <div><span class="l">Irányítószám</span><input id="f_zip" value="${esc(c.zip)}"></div>
      <div><span class="l">Város</span><input id="f_city" value="${esc(c.city)}"></div>
      <div><span class="l">Cím</span><input id="f_address" value="${esc(c.address)}"></div>
    </div>

    <div class="sketch" id="sketchBox">${c.sketch_svg || ''}</div>
    <div style="text-align:center;margin:-10px 0 16px">
      <button onclick="refreshSketch()" style="background:#454C54;font-size:0.8rem;padding:6px 14px">↻ Rajz frissítése a jelenlegi adatokkal</button>
      <button onclick="regenerateAndSaveSketch()" style="background:#2F6B4F;font-size:0.8rem;padding:6px 14px">💾 Rajz újragenerálása és mentése (ha elromlott)</button>
    </div>

    <div class="two-col">
      <div>${sections.slice(0, Math.ceil(sections.length/2)).map(editableSectionHtml).join('')}</div>
      <div>${sections.slice(Math.ceil(sections.length/2)).map(editableSectionHtml).join('')}</div>
    </div>

    <div class="price-card">
      <div class="amount-row" style="display:flex;align-items:center;justify-content:center;gap:8px">
        <input type="number" id="priceAmount" value="${quote ? quote.displayTotal : 0}" style="width:220px;background:#fff;border:1px solid #C7D0D6;color:#20242A;font-size:22px;font-weight:700;text-align:center;border-radius:6px;padding:4px 8px">
        <span style="font-size:16px;color:#454C54">Ft</span>
      </div>
      <div class="label" id="priceLabel">${quote ? (quote.displayLabel||'').toUpperCase() : ''}</div>
      <button onclick="savePrice()" style="margin-top:10px;font-size:0.8rem">Ár mentése (ez nem küld emailt)</button>
    </div>

    <button onclick="saveChanges()">💾 Mentés</button>
    <button onclick="recalcPrice()" style="background:#454C54;color:#fff">↻ Összeg újraszámolása</button>
    <div id="statusMsg" style="margin-top:14px;font-weight:bold"></div>
  </div>
  <script>
    ${UNIT_TOGGLE_SCRIPT}
    async function regenerateAndSaveSketch(){
      const box = document.getElementById('sketchBox');
      box.style.opacity = '0.5';
      try{
        const res = await fetch(window.location.pathname.replace('/editor','')+'/regenerate-sketch', { method:'POST' });
        const data = await res.json();
        if(res.ok){ box.innerHTML = data.svg; alert('A rajz sikeresen újragenerálva és elmentve.'); }
        else alert('Hiba: '+data.error);
      } catch(e){ alert('Hiba a rajz mentése közben: '+e.message); }
      box.style.opacity = '1';
    }
    async function refreshSketch(){
      const formData = {};
      document.querySelectorAll('[data-key]').forEach(el => { formData[el.dataset.key] = (el.type==='checkbox') ? el.checked : el.value; });
      const fullData = Object.assign({}, ${JSON.stringify(fd)}, formData);
      const box = document.getElementById('sketchBox');
      box.style.opacity = '0.5';
      try{
        const res = await fetch(window.location.pathname.replace('/editor','')+'/render-sketch', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ formData: fullData }) });
        const data = await res.json();
        if(res.ok) box.innerHTML = '<img src="'+data.image+'" style="max-width:100%;height:auto;display:block;margin:0 auto">';
        else alert('Hiba: '+data.error);
      } catch(e){ alert('Hiba a rajz frissítése közben: '+e.message); }
      box.style.opacity = '1';
    }
    async function savePrice(){
      const total = parseFloat(document.getElementById('priceAmount').value) || 0;
      const res = await fetch(window.location.pathname.replace('/editor','')+'/update-price', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ total }) });
      const data = await res.json();
      document.getElementById('statusMsg').textContent = res.ok ? 'Ár elmentve.' : 'Hiba: '+data.error;
      if(res.ok) notifyOpenerToRefresh();
    }
    // Ha ez az oldal egy másik (fő admin) ablakból nyílt meg, szólunk neki, hogy frissítse
    // a saját felugró ablakában (ügyfél-adatlap modal) megjelenő adatokat is, mentés után.
    function notifyOpenerToRefresh(){
      try{
        if(window.opener && !window.opener.closed && typeof window.opener.refreshOpenCustomerDetail === 'function'){
          window.opener.refreshOpenCustomerDetail();
        }
      } catch(e){ /* más eredetű (cross-origin) ablak esetén csendben elnyeljük */ }
    }
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
        msgEl.textContent = 'Mentve. (Az összeg nem változott — ha kell, kattints az "Összeg újraszámolása" gombra.)';
        notifyOpenerToRefresh();
        setTimeout(()=>location.reload(), 800);
      } else {
        msgEl.textContent = 'Hiba: '+data.error;
      }
    }
    // Külön, tudatos lépés — csak az árat számolja újra a jelenleg ELMENTETT adatok alapján.
    // Szándékosan nem fut le automatikusan mentéskor, hogy a kolléganő lássa és irányítsa,
    // mikor változik az ügyfélnek mutatott összeg.
    async function recalcPrice(){
      const msgEl = document.getElementById('statusMsg');
      msgEl.textContent = 'Összeg újraszámolása...';
      try{
        const res = await fetch(window.location.pathname.replace('/editor','')+'/calculate', { method:'POST' });
        const quote = await res.json();
        if(!res.ok) throw new Error(quote.error || 'Ismeretlen hiba');
        document.getElementById('priceAmount').value = quote.displayTotal;
        const labelEl = document.getElementById('priceLabel');
        if(labelEl) labelEl.textContent = (quote.displayLabel||'').toUpperCase();
        msgEl.textContent = 'Összeg újraszámolva a mentett adatok alapján.';
        notifyOpenerToRefresh();
      } catch(e){ msgEl.textContent = 'Hiba: '+e.message; }
    }
  </script>
  </body></html>`);
});

router.post('/customers/:id/update-price', (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Nem található.' });
  const newTotal = parseInt(req.body.total);
  if (!newTotal || newTotal <= 0) return res.status(400).json({ error: 'Érvénytelen összeg.' });
  const quote = c.price_breakdown ? JSON.parse(c.price_breakdown) : {};
  quote.displayTotal = newTotal;
  quote.manuallyEdited = true;
  db.prepare('UPDATE customers SET price_huf=?, price_breakdown=?, recalculated_price_huf=NULL, updated_at=? WHERE id=?')
    .run(newTotal, JSON.stringify(quote), new Date().toISOString(), c.id);
  res.json({ ok: true });
});

router.post('/customers/:id/update-form-data', async (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Nem található.' });
  const { name, phone, email: custEmail, zip, city, address, formData } = req.body;
  const merged = { ...JSON.parse(c.form_data || '{}'), ...(formData || {}) };
  if (merged.__gateType) merged.gateType = merged.__gateType;
  let newSketchSvg = c.sketch_svg;
  try {
    const { renderLiveSketchSvg } = require('../services/liveSketch');
    newSketchSvg = await renderLiveSketchSvg(merged);
  } catch (err) {
    console.error('Rajz újragenerálási hiba mentéskor (megmarad a régi rajz):', err.message);
  }
  // Szándékosan CSAK az adatokat (és a rajzot) menti — az árat nem számolja újra és nem
  // írja felül. Az újraszámolás külön, tudatos lépés a kolléganő részéről
  // (lásd: POST /customers/:id/calculate a "Összeg újraszámolása" gombhoz),
  // hogy a mentés és az árváltozás soha ne essen egybe észrevétlenül.
  db.prepare(`
    UPDATE customers SET name=?, phone=?, email=?, zip=?, city=?, address=?, form_data=?, sketch_svg=?, updated_at=?
    WHERE id=?
  `).run(name || c.name, phone || c.phone, custEmail || c.email, zip || c.zip, city || c.city, address || c.address,
    JSON.stringify(merged), newSketchSvg, new Date().toISOString(), c.id);
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

  db.prepare('UPDATE customers SET price_huf=?, price_breakdown=?, recalculated_price_huf=NULL, updated_at=? WHERE id=?')
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
    const detailsHtml = `<div>${sections.map(sectionHtmlEmail).join('')}</div>`;
    const logoBuffer = Buffer.from(LOGO_B64, 'base64');
    let sketchBuffer = null;
    if (c.sketch_svg) {
      try {
        sketchBuffer = await renderSketchToPngBuffer(c.sketch_svg);
      } catch (sketchErr) {
        console.error('Rajz PNG generálási hiba (email):', sketchErr);
      }
    }
    const isPrivateIndividual = fd.custInvoice !== 'igen';
    let cashNoteHtml = '';
    if (isPrivateIndividual) {
      const discountedTotal = Math.round(quote.displayTotal * 0.85 / 100) * 100;
      cashNoteHtml = `<p style="text-align:center;font-size:0.8em;color:#7a828a;margin-top:10px">Készpénzes fizetés esetén <strong>15% kedvezményt</strong> tudunk biztosítani a teljes összegből (kizárólag magánszemélyek részére). Kedvezményes végösszeg: <strong>${discountedTotal.toLocaleString('hu-HU')} Ft</strong>.</p>`;
    }
    await email.sendOffer(c, priceText, { detailsHtml, sketchBuffer, logoBuffer, cashNoteHtml });
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
    const excelBuffer = await buildColleagueReportBuffer(c);
    await email.sendOrderFormToColleague(c, excelBuffer);
    db.prepare('UPDATE customers SET status=?, updated_at=? WHERE id=?').run('kolleganonek_kikuldve', new Date().toISOString(), c.id);
    logStatus(c.id, 'kolleganonek_kikuldve', 'Link kiküldve a lengyel kolléganőnek jóváhagyásra');
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
    // FONTOS: a c.invoice_file '/uploads/invoices/xxx.pdf' formátumban van tárolva (ez a webes
    // elérési út, lásd server.js: app.use('/uploads', express.static('data/uploads'))), a fájl
    // viszont ténylegesen a lemezen a data/uploads/invoices/ mappában van — korábban itt hiányzott
    // a 'data' mappa a path.join-ból, emiatt a fájl sosem lett megtalálva (kiküldéskor hibát dobott).
    const filePath = path.join(__dirname, '..', '..', 'data', c.invoice_file);
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

router.post('/email-templates/:key/reset', (req, res) => {
  const { DEFAULT_TEMPLATES } = require('../services/emailTemplates');
  const def = DEFAULT_TEMPLATES.find(t => t.key === req.params.key);
  if (!def) return res.status(404).json({ error: 'Nincs ilyen alapértelmezett sablon.' });
  db.prepare('UPDATE email_templates SET subject=?, html_body=?, updated_at=? WHERE key=?')
    .run(def.subject, def.html_body, new Date().toISOString(), req.params.key);
  res.json({ ok: true, subject: def.subject, html_body: def.html_body });
});

// ---------------------------------------------------------------
// Az ügyféllel folytatott email-levelezés lekérése (IMAP-on keresztül) + válasz küldése
// ---------------------------------------------------------------
router.get('/customers/:id/emails', async (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Nem található.' });
  if (!c.email) return res.status(400).json({ error: 'Az ügyfélnek nincs email címe.' });
  try {
    const { fetchConversation } = require('../services/imapService');
    const messages = await fetchConversation(c.email);
    res.json(messages);
  } catch (err) {
    console.error('IMAP levelezés-lekérési hiba:', err);
    res.status(500).json({ error: 'Nem sikerült lekérni a levelezést: ' + err.message });
  }
});

router.post('/customers/:id/reply-email', async (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Nem található.' });
  const { subject, message } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'A levél szövege nem lehet üres.' });
  try {
    const html = `<div style="font-family:Arial,sans-serif;white-space:pre-wrap">${message.replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]))}</div>`;
    await email.sendMail({ to: c.email, subject: subject || 'Re: Pol-Bram', html });
    res.json({ ok: true });
  } catch (err) {
    console.error('Válasz-email küldési hiba:', err);
    res.status(500).json({ error: 'Nem sikerült elküldeni a választ: ' + err.message });
  }
});

router.post('/customers/:id/render-sketch', async (req, res) => {
  try {
    const { renderLiveSketchPng } = require('../services/liveSketch');
    const image = await renderLiveSketchPng(req.body.formData || {});
    res.json({ ok: true, image });
  } catch (err) {
    console.error('Élő rajz-renderelési hiba:', err);
    res.status(500).json({ error: 'Nem sikerült frissíteni a rajzot: ' + err.message });
  }
});

// Ha egy korábbi (hibás) mentés miatt a tárolt rajz elromlott, ezzel egy kattintással
// újragenerálható és el is menthető, anélkül hogy bármi más adatot módosítani kellene.
router.post('/customers/:id/regenerate-sketch', async (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Nem található.' });
  try {
    const { renderLiveSketchSvg } = require('../services/liveSketch');
    const fd = JSON.parse(c.form_data || '{}');
    const newSketchSvg = await renderLiveSketchSvg(fd);
    db.prepare('UPDATE customers SET sketch_svg=?, updated_at=? WHERE id=?').run(newSketchSvg, new Date().toISOString(), c.id);
    res.json({ ok: true, svg: newSketchSvg });
  } catch (err) {
    console.error('Rajz újragenerálási hiba:', err);
    res.status(500).json({ error: 'Nem sikerült újragenerálni a rajzot: ' + err.message });
  }
});

// ---------------------------------------------------------------
// Adatmegőrzés / anonimizálás (GDPR) — előnézet és kézi futtatás
// ---------------------------------------------------------------
// Előnézet: mely rekordok járnának le a megőrzési idő (jelenleg 2 év) alapján, ha most futna le
// az anonimizálás — semmit nem módosít, csak megmutatja.
router.get('/data-retention/preview', (req, res) => {
  try {
    const { findExpiredCustomers, RETENTION_YEARS } = require('../services/dataRetention');
    const expired = findExpiredCustomers();
    res.json({ ok: true, retentionYears: RETENTION_YEARS, count: expired.length, customers: expired });
  } catch (err) {
    res.status(500).json({ error: 'Hiba az előnézet lekérésekor: ' + err.message });
  }
});

// Kézi futtatás — ugyanazt csinálja, mint a napi 3:00-kor automatikusan lefutó ütemezett job
// (lásd src/services/scheduler.js), csak azonnal, admin kérésre.
router.post('/data-retention/run', (req, res) => {
  try {
    const { runAnonymization } = require('../services/dataRetention');
    const count = runAnonymization();
    res.json({ ok: true, anonymizedCount: count });
  } catch (err) {
    res.status(500).json({ error: 'Hiba az anonimizálás futtatásakor: ' + err.message });
  }
});

// ---------------------------------------------------------------
// Kolléganő-Excel letöltése bármikor (admin felületről, "Kolléganő-Excel letöltése" gomb)
// ---------------------------------------------------------------
router.get('/customers/:id/colleague-report.xlsx', async (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).send('Nem található.');
  try {
    const buffer = await buildColleagueReportBuffer(c);
    const safeName = (c.name || 'megrendeles').trim().replace(/\s+/g, '_').replace(/[^\w\-]/g, '');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error('Kolléganő-Excel generálási hiba:', err);
    res.status(500).send('Nem sikerült előállítani az Excel-fájlt: ' + err.message);
  }
});

// ---------------------------------------------------------------
// Az összes, korábban a kolléganőnek már kiküldött megrendelés Excel-riportjának ÚJRAKÜLDÉSE
// a javított (A4-re illeszkedő) sablonnal. Egyszeri, kézi indítású admin-akció — minden érintett
// ügyfélnél újra lefut a küldés (ugyanaz az email megy ki, csak a frissített melléklettel).
// ---------------------------------------------------------------
router.post('/customers/resend-colleague-reports', async (req, res) => {
  const customers = db.prepare(`SELECT * FROM customers WHERE colleague_token IS NOT NULL AND colleague_token != ''`).all();
  const results = { total: customers.length, sent: 0, failed: [] };
  for (const c of customers) {
    try {
      const buffer = await buildColleagueReportBuffer(c);
      await email.sendOrderFormToColleague(c, buffer);
      results.sent++;
    } catch (err) {
      console.error(`Hiba a(z) #${c.id} (${c.name}) kolléganő-riport újraküldésekor:`, err.message);
      results.failed.push({ id: c.id, name: c.name, error: err.message });
    }
  }
  res.json({ ok: true, ...results });
});

module.exports = router;
