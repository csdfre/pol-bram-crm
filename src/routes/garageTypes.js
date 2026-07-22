const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../../db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();
router.use(requireAuth);

const imageDir = path.join(__dirname, '..', '..', 'uploads', 'garage-types');
if (!fs.existsSync(imageDir)) fs.mkdirSync(imageDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, imageDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
});

// Lista
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT id, name, image_path, updated_at FROM garage_types ORDER BY name ASC').all();
  res.json(rows);
});

// Egy típus teljes adatlapja
router.get('/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM garage_types WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Nem található.' });
  res.json({ ...t, form_data: JSON.parse(t.form_data || '{}') });
});

// Új típus létrehozása (kép + form adatok)
router.post('/', upload.single('image'), (req, res) => {
  const { name, formData } = req.body;
  if (!name) return res.status(400).json({ error: 'Adjon nevet a típusnak.' });
  const now = new Date().toISOString();
  const imagePath = req.file ? `/uploads/garage-types/${path.basename(req.file.path)}` : null;

  const info = db.prepare(`
    INSERT INTO garage_types (name, image_path, form_data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, imagePath, formData || '{}', now, now);

  res.json({ ok: true, id: info.lastInsertRowid });
});

// Típus módosítása (kép opcionális — ha nincs új kép feltöltve, a régi marad)
router.put('/:id', upload.single('image'), (req, res) => {
  const existing = db.prepare('SELECT * FROM garage_types WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Nem található.' });

  const { name, formData } = req.body;
  const imagePath = req.file ? `/uploads/garage-types/${path.basename(req.file.path)}` : existing.image_path;

  db.prepare(`
    UPDATE garage_types SET name=?, image_path=?, form_data=?, updated_at=? WHERE id=?
  `).run(name || existing.name, imagePath, formData || existing.form_data, new Date().toISOString(), req.params.id);

  res.json({ ok: true });
});

// Típus törlése
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM garage_types WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
