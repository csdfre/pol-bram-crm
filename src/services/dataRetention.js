const fs = require('fs');
const path = require('path');
const db = require('../../db');

/**
 * Adatmegőrzési / anonimizálási szolgáltatás
 * ---------------------------------------------------------------
 * Az adatkezelési tájékoztató szerint az ajánlatkéréshez kapcsolódó személyes adatokat a
 * beérkezéstől számított 2 évig őrzi a Torusz Trade Kft. (DATA_RETENTION_YEARS env-változóval
 * felülírható, alapértelmezetten 2). A lejárat után a rekordból a SZEMÉLYES adatokat töröljük
 * (anonimizáljuk) — de a számlafájlt (invoice_file) NEM, mert a megrendelés véglegesülése után a
 * PUH Pol-Bram (a garázs tényleges eladója és a számla kiállítója) önálló adatkezelőként felel a
 * számlázási bizonylat lengyel számviteli szabályok szerinti megőrzéséért, amíg az ebben a
 * rendszerben (is) tárolásra kerül. Ez a fájl a bizonylat maga (PDF), ami már eleve tartalmazza a
 * jogszabály által megkövetelt adatokat — nem az adatbázis-sor "name" mezőjétől függ, tehát a sor
 * anonimizálása nem sérti a PUH Pol-Bram számviteli megőrzési kötelezettségét.
 *
 * A folyamat idempotens: egy már anonimizált rekordot (anonymized_at IS NOT NULL) nem nyúl hozzá
 * újra, tehát bármikor, akárhányszor lefuttatható kockázat nélkül.
 */

const RETENTION_YEARS = parseInt(process.env.DATA_RETENTION_YEARS) || 2;
const UPLOADS_ROOT = path.join(__dirname, '..', '..', 'data', 'uploads');

function cutoffIso() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - RETENTION_YEARS);
  return d.toISOString();
}

/**
 * A ténylegesen anonimizálandó (lejárt megőrzési idejű, még nem anonimizált) ügyfelek listája.
 * Dry-run / előnézet célra is használható (lásd admin route).
 */
function findExpiredCustomers() {
  const cutoff = cutoffIso();
  return db.prepare(`
    SELECT id, name, email, created_at, status, invoice_file
    FROM customers
    WHERE created_at <= ? AND anonymized_at IS NULL
    ORDER BY created_at ASC
  `).all(cutoff);
}

function deleteUploadedFileSafely(relPath) {
  if (!relPath) return;
  try {
    // relPath tipikusan "/uploads/complaints/xxxx.jpg" formátumú (lásd routes/public.js) —
    // a "data/uploads" a tényleges gyökere a lemezen (server.js static mountja szerint).
    const withoutPrefix = relPath.replace(/^\/?uploads\//, '');
    const abs = path.join(UPLOADS_ROOT, withoutPrefix);
    if (abs.startsWith(UPLOADS_ROOT) && fs.existsSync(abs)) {
      fs.unlinkSync(abs);
    }
  } catch (err) {
    console.error(`[adatmegőrzés] Nem sikerült törölni a fájlt (${relPath}):`, err.message);
  }
}

/**
 * Egyetlen ügyfél-rekord anonimizálása. A SZÁMLA (invoice_file) és az ehhez elengedhetetlen mezők
 * (ár, dátum, státusz) MEGMARADNAK — minden más személyes/azonosító adat törlődik vagy semlegesítődik.
 */
function anonymizeCustomer(customer) {
  const now = new Date().toISOString();

  // A panasz-fényképeket ténylegesen is töröljük lemezről (nem csak a DB-hivatkozást) — ezek nem
  // számviteli bizonylatok, tehát nincs jogi indok a további megőrzésükre.
  const full = db.prepare('SELECT complaint_files FROM customers WHERE id = ?').get(customer.id);
  if (full && full.complaint_files) {
    try {
      const files = JSON.parse(full.complaint_files);
      if (Array.isArray(files)) files.forEach(deleteUploadedFileSafely);
    } catch (e) { /* ha nem parse-olható, nincs mit törölni */ }
  }

  db.prepare(`
    UPDATE customers SET
      name = '[törölve]',
      phone = NULL,
      email = '[törölve]',
      zip = NULL,
      city = NULL,
      address = NULL,
      form_data = NULL,
      summary_text = NULL,
      sketch_svg = NULL,
      complaint_text = NULL,
      complaint_files = NULL,
      modify_request_text = NULL,
      customer_edit_note = NULL,
      reject_reason = NULL,
      status_alert_note = NULL,
      colleague_token = NULL,
      accept_token = NULL,
      satisfaction_token = NULL,
      complaint_token = NULL,
      pre_edit_form_data = NULL,
      anonymized_at = ?,
      updated_at = ?
    WHERE id = ?
  `).run(now, now, customer.id);

  db.prepare('INSERT INTO status_log (customer_id, status, changed_at, note) VALUES (?, ?, ?, ?)')
    .run(customer.id, customer.status, now, `Automatikus anonimizálás (${RETENTION_YEARS} év megőrzési idő lejárt) — a számlázási adat (ha volt) megmaradt`);
}

/**
 * Lefuttatja az anonimizálást minden lejárt rekordon. Visszaadja, hány rekordot érintett.
 */
function runAnonymization() {
  const expired = findExpiredCustomers();
  for (const c of expired) {
    try {
      anonymizeCustomer(c);
      console.log(`[adatmegőrzés] Anonimizálva: ügyfél #${c.id}`);
    } catch (err) {
      console.error(`[adatmegőrzés] Hiba az ügyfél #${c.id} anonimizálásakor:`, err.message);
    }
  }
  return expired.length;
}

module.exports = { runAnonymization, findExpiredCustomers, RETENTION_YEARS };
