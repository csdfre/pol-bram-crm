const express = require('express');
const cookieSession = require('cookie-session');
const db = require('../../db');
const { buildMapsLink, resolveDeliveryAddress } = require('../services/deliveryLocation');

const router = express.Router();

// A sofőr-oldal SAJÁT, a admin-felülettől független munkamenet-sütit használ, jóval hosszabb
// (180 napos) érvényességgel — a cél, hogy ha a sofőr egyszer bejelentkezett a telefonján, ne
// kelljen minden egyes megnyitáskor újra beírnia a jelszót. Külön cookie-nevet használunk
// ('driver_session'), hogy ne ütközzön az admin backoffice 12 órás 'session' sütijével.
router.use(cookieSession({
  name: 'driver_session',
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  maxAge: 180 * 24 * 60 * 60 * 1000, // 180 nap
}));

// Egyszerű, közös (nem személyre szabott) belépési adat a sofőrök számára — nincs külön
// felhasználó-kezelés, csak egy megosztott jelszó, ahogy kérve volt.
const DRIVER_USERNAME = 'Polbram';
const DRIVER_PASSWORD = '123456';

function requireDriverAuth(req, res, next) {
  if (req.session && req.session.driverAuthed) return next();
  return res.redirect('/driver/login');
}

function layout(title, bodyHtml) {
  return `<!DOCTYPE html><html lang="hu"><head><meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <title>${title} — Pol-Bram</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, Arial, sans-serif; background: #EEF1F2; margin: 0; padding: 0; color: #20242A; }
    header { background: #20242A; border-bottom: 4px solid #F2B705; padding: 16px 18px; display: flex; justify-content: space-between; align-items: center; }
    header h1 { color: #fff; font-size: 1.05rem; margin: 0; text-transform: uppercase; letter-spacing: 0.03em; }
    header a { color: #F2B705; font-size: 0.85rem; text-decoration: none; }
    main { padding: 16px; max-width: 640px; margin: 0 auto; }
    .card { background: #fff; border-radius: 8px; padding: 16px; margin-bottom: 14px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
    .login-box { background: #fff; border-radius: 8px; padding: 28px 22px; margin: 40px auto; max-width: 340px; border-top: 4px solid #F2B705; }
    .login-box h2 { margin-top: 0; text-align: center; }
    input[type=text], input[type=password], input[type=date] { width: 100%; padding: 12px; margin: 8px 0 16px; border: 1px solid #ccc; border-radius: 6px; font-size: 1rem; }
    button { background: #F2B705; border: none; padding: 13px 20px; border-radius: 6px; cursor: pointer; font-size: 1rem; font-weight: bold; width: 100%; }
    .error { color: #b23a3a; font-size: 0.9rem; text-align: center; margin-top: -8px; margin-bottom: 12px; }
    .name { font-size: 1.15rem; font-weight: bold; margin-bottom: 6px; }
    .row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 0.95rem; }
    .row .label { color: #7a828a; }
    .amount { font-size: 1.3rem; font-weight: bold; color: #20242A; margin-top: 8px; }
    .maps-btn { display: block; text-align: center; background: #20242A; color: #fff; text-decoration: none; padding: 12px; border-radius: 6px; margin-top: 12px; font-weight: bold; }
    .phone-btn { display: block; text-align: center; background: #fafbfb; border: 1px solid #e6e8ea; color: #20242A; text-decoration: none; padding: 10px; border-radius: 6px; margin-top: 8px; font-size: 0.9rem; }
    .empty { text-align: center; color: #7a828a; padding: 40px 0; }
    .date-picker { display: flex; gap: 8px; margin-bottom: 16px; }
    .date-picker input { margin: 0; flex: 1; }
    .date-picker button { width: auto; padding: 12px 16px; }
  </style>
  </head><body>${bodyHtml}</body></html>`;
}

router.get('/login', (req, res) => {
  if (req.session && req.session.driverAuthed) return res.redirect('/driver');
  const error = req.query.error ? '<div class="error">Hibás felhasználónév vagy jelszó.</div>' : '';
  res.send(layout('Belépés', `
    <div class="login-box">
      <h2>Pol-Bram<br>Sofőr-lista</h2>
      <form method="POST" action="/driver/login">
        ${error}
        <input type="text" name="username" placeholder="Felhasználónév" autocomplete="username" required>
        <input type="password" name="password" placeholder="Jelszó" autocomplete="current-password" required>
        <button type="submit">Belépés</button>
      </form>
    </div>
  `));
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === DRIVER_USERNAME && password === DRIVER_PASSWORD) {
    req.session.driverAuthed = true;
    return res.redirect('/driver');
  }
  res.redirect('/driver/login?error=1');
});

router.get('/logout', (req, res) => {
  req.session.driverAuthed = null;
  res.redirect('/driver/login');
});

router.get('/', requireDriverAuth, (req, res) => {
  // Alapértelmezetten a legközelebbi (legkorábbi, jövőbeli vagy mai) napra állunk rá, hogy a sofőr
  // ne egy üres/rossz napi listával találkozzon first megnyitáskor.
  const requestedDate = req.query.date;
  const todayIso = new Date().toISOString().slice(0, 10);

  let date = requestedDate;
  if (!date) {
    const nextRow = db.prepare(`
      SELECT delivery_date FROM customers
      WHERE delivery_date IS NOT NULL AND delivery_date != '' AND delivery_date >= ?
      ORDER BY delivery_date ASC LIMIT 1
    `).get(todayIso);
    date = nextRow ? nextRow.delivery_date : todayIso;
  }

  const rows = db.prepare(`
    SELECT id, name, phone, address, zip, city, delivery_date, delivery_time,
           delivery_remaining_amount, delivery_address, delivery_lat, delivery_lng
    FROM customers
    WHERE delivery_date = ?
    ORDER BY delivery_time ASC
  `).all(date);

  const cardsHtml = rows.length
    ? rows.map(c => {
      const mapsLink = buildMapsLink(c);
      const address = resolveDeliveryAddress(c);
      const amount = c.delivery_remaining_amount != null
        ? `<div class="amount">Fizetendő a helyszínen: ${Number(c.delivery_remaining_amount).toLocaleString('hu-HU')} Ft</div>`
        : '';
      return `
        <div class="card">
          <div class="row"><span class="label">Időpont</span><span><strong>${c.delivery_time || '—'}</strong></span></div>
          <div class="name">${esc(c.name || '')}</div>
          <div class="row"><span class="label">Cím</span><span>${esc(address)}</span></div>
          ${amount}
          ${mapsLink ? `<a class="maps-btn" href="${mapsLink}" target="_blank">📍 Navigálás Google Térképpel</a>` : ''}
          ${c.phone ? `<a class="phone-btn" href="tel:${esc(c.phone)}">📞 Hívás: ${esc(c.phone)}</a>` : ''}
        </div>`;
    }).join('')
    : `<div class="empty">Erre a napra nincs kiszállítás.</div>`;

  res.send(layout('Sofőr-lista', `
    <header>
      <h1>Sofőr-lista</h1>
      <a href="/driver/logout">Kilépés</a>
    </header>
    <main>
      <form class="date-picker" method="GET" action="/driver">
        <input type="date" name="date" value="${date}">
        <button type="submit">Mutasd</button>
      </form>
      ${cardsHtml}
    </main>
  `));
});

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

module.exports = router;
