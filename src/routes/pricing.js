const express = require('express');
const multer = require('multer');
const db = require('../../db');
const requireAuth = require('../middleware/requireAuth');
const { parseWorkbook } = require('../services/pricingExcelParser');

const router = express.Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const { DISCOUNT_PERCENT_DEFAULT } = require('../services/pricing');

// Jelenleg aktív (felülírt, ha van) árazási konfiguráció lekérése
router.get('/current', (req, res) => {
  const base = db.prepare('SELECT config_json, source_file, updated_at FROM pricing_config WHERE config_key = ?').get('base_price_table');
  const addon = db.prepare('SELECT config_json, source_file, updated_at FROM pricing_config WHERE config_key = ?').get('addon');
  const discountRow = db.prepare('SELECT config_json FROM pricing_config WHERE config_key = ?').get('discount_percent');
  const discountPercent = discountRow ? JSON.parse(discountRow.config_json) : DISCOUNT_PERCENT_DEFAULT;
  res.json({
    basePriceTable: base ? { ...JSON.parse(base.config_json), _meta: { source: base.source_file, updated_at: base.updated_at } } : null,
    addon: addon ? { ...JSON.parse(addon.config_json), _meta: { source: addon.source_file, updated_at: addon.updated_at } } : null,
    discountPercent,
  });
});

// Rabat (kedvezmény %) beállítása — 1-10 közötti érték
router.post('/discount', (req, res) => {
  let pct = parseFloat(req.body.percent);
  if (isNaN(pct)) return res.status(400).json({ error: 'Érvénytelen érték.' });
  pct = Math.max(1, Math.min(10, pct));
  db.prepare(`
    INSERT INTO pricing_config (config_key, config_json, source_file, updated_at) VALUES ('discount_percent', ?, NULL, ?)
    ON CONFLICT(config_key) DO UPDATE SET config_json=excluded.config_json, updated_at=excluded.updated_at
  `).run(JSON.stringify(pct), new Date().toISOString());
  res.json({ ok: true, discountPercent: pct });
});

// Excel feltöltése — csak ELEMZÉS, nem menti automatikusan (az admin nézi át, mielőtt jóváhagyja)
router.post('/upload-excel', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nincs feltöltött fájl.' });
  try {
    const parsed = parseWorkbook(req.file.buffer);
    res.json({ ok: true, filename: req.file.originalname, parsed });
  } catch (err) {
    res.status(500).json({ error: 'Hiba az Excel feldolgozása közben: ' + err.message });
  }
});

// Jóváhagyott árazási adatok tényleges elmentése (felülírás)
router.post('/apply', (req, res) => {
  const { basePriceTable, addon, filename } = req.body;
  const now = new Date().toISOString();
  if (basePriceTable) {
    db.prepare(`
      INSERT INTO pricing_config (config_key, config_json, source_file, updated_at) VALUES ('base_price_table', ?, ?, ?)
      ON CONFLICT(config_key) DO UPDATE SET config_json=excluded.config_json, source_file=excluded.source_file, updated_at=excluded.updated_at
    `).run(JSON.stringify(basePriceTable), filename || null, now);
  }
  if (addon) {
    db.prepare(`
      INSERT INTO pricing_config (config_key, config_json, source_file, updated_at) VALUES ('addon', ?, ?, ?)
      ON CONFLICT(config_key) DO UPDATE SET config_json=excluded.config_json, source_file=excluded.source_file, updated_at=excluded.updated_at
    `).run(JSON.stringify(addon), filename || null, now);
  }
  res.json({ ok: true });
});

// Visszaállítás a beépített alapértékekre
router.post('/reset', (req, res) => {
  db.prepare("DELETE FROM pricing_config WHERE config_key IN ('base_price_table','addon','discount_percent')").run();
  res.json({ ok: true });
});

module.exports = router;
