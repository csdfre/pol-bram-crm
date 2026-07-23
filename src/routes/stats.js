const express = require('express');
const db = require('../../db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();
router.use(requireAuth);

const ORDERED_STATUSES = ['ajanlat_elfogadva', 'megrendelolap_kikuldve', 'megrendelolap_elfogadva', 'elolegszamla_kikuldve', 'telepitve', 'garancialis_problema'];

router.get('/summary', (req, res) => {
  const from = req.query.from || '1970-01-01';
  const to = req.query.to || '2999-12-31';
  const toExclusive = to + 'T23:59:59.999Z';

  const inRange = `created_at >= ? AND created_at <= ?`;

  const offersSent = db.prepare(`SELECT COUNT(*) c FROM customers WHERE offer_sent_at IS NOT NULL AND ${inRange}`).get(from, toExclusive).c;

  const orderedPlaceholders = ORDERED_STATUSES.map(() => '?').join(',');
  const ordered = db.prepare(`SELECT COUNT(*) c FROM customers WHERE status IN (${orderedPlaceholders}) AND ${inRange}`).get(...ORDERED_STATUSES, from, toExclusive).c;

  const rejected = db.prepare(`SELECT COUNT(*) c FROM customers WHERE status = 'elutasitva' AND ${inRange}`).get(from, toExclusive).c;
  const noResponse = db.prepare(`SELECT COUNT(*) c FROM customers WHERE status = 'ajanlat_kikuldve' AND ${inRange}`).get(from, toExclusive).c;

  const avgRow = db.prepare(`SELECT AVG(price_huf) a FROM customers WHERE status IN (${orderedPlaceholders}) AND price_huf IS NOT NULL AND ${inRange}`).get(...ORDERED_STATUSES, from, toExclusive);
  const avgOrderValueNet = avgRow.a ? Math.round(avgRow.a) : 0;

  const typeBreakdown = db.prepare(`
    SELECT COALESCE(garage_type_used, 'Egyedi összeállítás') AS type_name, COUNT(*) c
    FROM customers WHERE ${inRange}
    GROUP BY type_name ORDER BY c DESC
  `).all(from, toExclusive);

  const statusBreakdown = db.prepare(`
    SELECT status, COUNT(*) c FROM customers WHERE ${inRange} GROUP BY status
  `).all(from, toExclusive);

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
  const toExclusive = to + 'T23:59:59.999Z';
  if (!status) return res.status(400).json({ error: 'Hiányzik a status paraméter.' });

  const rows = db.prepare(`
    SELECT id, name, email, phone, created_at, price_huf FROM customers
    WHERE status = ? AND created_at >= ? AND created_at <= ?
    ORDER BY created_at DESC
  `).all(status, from, toExclusive);
  res.json(rows);
});

module.exports = router;
