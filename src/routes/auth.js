const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../../db');

const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password, remember } = req.body;
  const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Hibás felhasználónév vagy jelszó.' });
  }
  // "Maradjak bejelentkezve": a munkamenet-sütinek NEM a globális (rövid) érvényességi idejét
  // használjuk, hanem ennél a konkrét válasznál kitolt, hosszú (90 napos) lejáratot állítunk be —
  // a req.sessionOptions minden kéréshez saját (a globális beállításokat örökítő) példány, tehát ez
  // a módosítás csak ezt a bejelentkezést érinti, más admin-munkameneteket nem.
  if (remember) {
    req.sessionOptions.maxAge = 90 * 24 * 60 * 60 * 1000; // 90 nap
  }
  req.session.adminId = user.id;
  req.session.username = user.username;
  res.json({ ok: true, username: user.username });
});

router.post('/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (req.session && req.session.adminId) {
    return res.json({ loggedIn: true, username: req.session.username });
  }
  res.json({ loggedIn: false });
});

module.exports = router;
