const express = require('express');
const db = require('../../db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();
router.use(requireAuth);

const ORDERED_STATUSES = ['ajanlat_elfogadva', 'megrendelolap_kikuldve', 'megrendelolap_elfogadva', 'elolegszamla_kikuldve', 'telepitve', 'garancialis_problema'];

// FONTOS: a dátum-szűrést a SQLite saját date() függvényével normalizáljuk mindkét oldalon
// (a created_at ISO-időbélyegét ÉS a from/to határokat is), nem nyers szöveg-összehasonlítással.
// Ez megbízhatóbb, mint a korábbi "created_at >= from AND created_at <= to+'T23:59:59.999Z'"
// string-konkatenációs megoldás — az utóbbi elméletileg működik tiszta ISO-formátumú adatokon, de
// bármilyen apró formátum-eltérés (pl. régebbi, kézzel beszúrt rekord más dátumformátummal) esetén
// csendben rossz (akár nulla) találatot adhat. A date() function mindkét oldalon YYYY-MM-DD alakra
// hozza az értékeket, így a tartomány-szűrés az órától/formátumtól függetlenül helyesen működik.
const inRange = `date(created_at) >= date(?) AND date(created_at) <= date(?)`;

router.get('/summary', (req, res) => {
  const from = req.query.from || '1970-01-01';
  const to = req.query.to || '2999-12-31';

  const offersSent = db.prepare(`SELECT COUNT(*) c FROM customers WHERE offer_sent_at IS NOT NULL AND ${inRange}`).get(from, to).c;

  const orderedPlaceholders = ORDERED_STATUSES.map(() => '?').join(',');
  const ordered = db.prepare(`SELECT COUNT(*) c FROM customers WHERE status IN (${orderedPlaceholders}) AND ${inRange}`).get(...ORDERED_STATUSES, from, to).c;

  const rejected = db.prepare(`SELECT COUNT(*) c FROM customers WHERE status = 'elutasitva' AND ${inRange}`).get(from, to).c;
  const noResponse = db.prepare(`SELECT COUNT(*) c FROM customers WHERE status = 'ajanlat_kikuldve' AND ${inRange}`).get(from, to).c;

  const avgRow = db.prepare(`SELECT AVG(price_huf) a FROM customers WHERE status IN (${orderedPlaceholders}) AND price_huf IS NOT NULL AND ${inRange}`).get(...ORDERED_STATUSES, from, to);
  const avgOrderValueNet = avgRow.a ? Math.round(avgRow.a) : 0;

  const typeBreakdown = db.prepare(`
    SELECT COALESCE(garage_type_used, 'Egyedi összeállítás') AS type_name, COUNT(*) c
    FROM customers WHERE ${inRange}
    GROUP BY type_name ORDER BY c DESC
  `).all(from, to);

  const statusBreakdown = db.prepare(`
    SELECT status, COUNT(*) c FROM customers WHERE ${inRange} GROUP BY status
  `).all(from, to);

  res.json({
    from, to,
    offersSent,
    ordered,
    rejected,
    noResponse,
    avgOrderValueNet,
    typeBreakdown,
    statusBreakdown,
  });
});

// Egy adott státuszú ügyfelek listája (dátum-intervallumon belül)
router.get('/by-status', (req, res) => {
  const { status } = req.query;
  const from = req.query.from || '1970-01-01';
  const to = req.query.to || '2999-12-31';
  if (!status) return res.status(400).json({ error: 'Hiányzik a status paraméter.' });

  const rows = db.prepare(`
    SELECT id, name, email, phone, created_at, price_huf, price_breakdown FROM customers
    WHERE status = ? AND ${inRange}
    ORDER BY created_at DESC
  `).all(status, from, to);
  const result = rows.map(r => {
    let totalPLN = null;
    if (r.price_breakdown) {
      try { totalPLN = JSON.parse(r.price_breakdown).totalPLN; } catch (e) { /* ignore */ }
    }
    return { id: r.id, name: r.name, email: r.email, phone: r.phone, created_at: r.created_at, price_huf: r.price_huf, price_pln: totalPLN };
  });
  res.json(result);
});

module.exports = router;
