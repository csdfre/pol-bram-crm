const express = require('express');
const cookieSession = require('cookie-session');
const db = require('../../db');
const { buildMapsLink, resolveDeliveryAddress } = require('../services/deliveryLocation');

const router = express.Router();

// A sofőr-oldal SAJÁT, az admin-felülettől független munkamenet-sütit használ, jóval hosszabb
// (180 napos) érvényességgel — a cél, hogy ha a sofőr egyszer bejelentkezett a telefonján, ne
// kelljen minden egyes megnyitáskor újra beírnia a jelszót. Külön cookie-nevet használunk
// ('driver_session'), hogy ne ütközzön az admin backoffice 12 órás 'session' sütijével.
router.use(cookieSession({
  name: 'driver_session',
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  maxAge: 180 * 24 * 60 * 60 * 1000, // 180 nap
}));
router.use(express.urlencoded({ extended: true }));

// Egyszerű, közös (nem személyre szabott) belépési adat a sofőrök számára.
const DRIVER_USERNAME = 'Polbram';
const DRIVER_PASSWORD = '123456';

function requireDriverAuth(req, res, next) {
  if (req.session && req.session.driverAuthed) return next();
  return res.redirect('/driver/login');
}

// Az oldal maga lengyelul van (a sofor lengyel), de az UGYFELNEK kuldott SMS-uzenet magyarul
// szol (lasd lejjebb, a kliens JS-ben) - az ugyfel magyar, ezt o olvassa.
function layout(title, bodyHtml) {
  return '<!DOCTYPE html><html lang="pl"><head><meta charset="UTF-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">'
    + '<title>' + title + ' - Pol-Bram</title>'
    + '<style>'
    + '* { box-sizing: border-box; }'
    + 'body { font-family: -apple-system, Arial, sans-serif; background: #EEF1F2; margin: 0; padding: 0; color: #20242A; }'
    + 'header { background: #20242A; border-bottom: 4px solid #F2B705; padding: 16px 18px; display: flex; justify-content: space-between; align-items: center; }'
    + 'header h1 { color: #fff; font-size: 1.05rem; margin: 0; text-transform: uppercase; letter-spacing: 0.03em; }'
    + 'header a { color: #F2B705; font-size: 0.85rem; text-decoration: none; }'
    + 'main { padding: 16px; max-width: 640px; margin: 0 auto; }'
    + '.card { background: #fff; border-radius: 8px; padding: 16px; margin-bottom: 14px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }'
    + '.card.done { background: #f2f4f3; opacity: 0.65; }'
    + '.done-badge { display: inline-block; background: #2e7d32; color: #fff; font-size: 0.72rem; font-weight: bold; padding: 2px 8px; border-radius: 10px; vertical-align: middle; }'
    + '.done-toggle { display: flex; align-items: center; gap: 8px; margin-top: 14px; padding-top: 12px; border-top: 1px solid #e6e8ea; font-size: 0.9rem; }'
    + '.done-toggle input { width: 20px; height: 20px; margin: 0; }'
    + '.login-box { background: #fff; border-radius: 8px; padding: 28px 22px; margin: 40px auto; max-width: 340px; border-top: 4px solid #F2B705; }'
    + '.login-box h2 { margin-top: 0; text-align: center; }'
    + 'input[type=text], input[type=password], input[type=date], input[type=time] { width: 100%; padding: 12px; margin: 8px 0 16px; border: 1px solid #ccc; border-radius: 6px; font-size: 1rem; }'
    + 'button { background: #F2B705; border: none; padding: 13px 20px; border-radius: 6px; cursor: pointer; font-size: 1rem; font-weight: bold; width: 100%; }'
    + '.error { color: #b23a3a; font-size: 0.9rem; text-align: center; margin-top: -8px; margin-bottom: 12px; }'
    + '.name { font-size: 1.15rem; font-weight: bold; margin-bottom: 6px; }'
    + '.row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 0.95rem; }'
    + '.row .label { color: #7a828a; }'
    + '.amount { font-size: 1.3rem; font-weight: bold; color: #20242A; margin-top: 8px; }'
    + '.maps-btn { display: block; text-align: center; background: #20242A; color: #fff; text-decoration: none; padding: 12px; border-radius: 6px; margin-top: 12px; font-weight: bold; }'
    + '.phone-btn { display: block; text-align: center; background: #fafbfb; border: 1px solid #e6e8ea; color: #20242A; text-decoration: none; padding: 10px; border-radius: 6px; margin-top: 8px; font-size: 0.9rem; }'
    + '.sms-box { border-top: 1px solid #e6e8ea; margin-top: 12px; padding-top: 12px; }'
    + '.sms-box label { display: block; font-size: 0.8rem; color: #7a828a; margin-bottom: 4px; }'
    + '.sms-box input { margin: 0 0 10px; }'
    + '.sms-btn { background: #20242A; color: #fff; }'
    + '.empty { text-align: center; color: #7a828a; padding: 40px 0; }'
    + '.date-picker { display: flex; gap: 8px; margin-bottom: 16px; }'
    + '.date-picker input { margin: 0; flex: 1; }'
    + '.date-picker button { width: auto; padding: 12px 16px; }'
    + '</style>'
    + '</head><body>' + bodyHtml + '</body></html>';
}

router.get('/login', (req, res) => {
  if (req.session && req.session.driverAuthed) return res.redirect('/driver');
  const error = req.query.error ? '<div class="error">Nieprawidłowa nazwa użytkownika lub hasło.</div>' : '';
  res.send(layout('Logowanie',
    '<div class="login-box">'
    + '<h2>Pol-Bram<br>Lista kierowcy</h2>'
    + '<form method="POST" action="/driver/login">'
    + error
    + '<input type="text" name="username" placeholder="Nazwa użytkownika" autocomplete="username" required>'
    + '<input type="password" name="password" placeholder="Hasło" autocomplete="current-password" required>'
    + '<button type="submit">Zaloguj się</button>'
    + '</form>'
    + '</div>'
  ));
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

// A sofor altal megadott pontos erkezesi idopont mentese (nem kuld semmit, csak elmenti - az SMS-t
// maga a telefon kuldi ki, lasd a kliens-oldali JS-t).
router.post('/customers/:id/arrival-time', requireDriverAuth, (req, res) => {
  const { arrivalTime } = req.body;
  db.prepare('UPDATE customers SET delivery_arrival_time=?, updated_at=? WHERE id=?')
    .run(arrivalTime || null, new Date().toISOString(), req.params.id);
  res.json({ ok: true });
});

// A sofőr által a jelölőnégyzettel megjelölt "kész vagyok ezzel az ügyféllel" állapot mentése.
// Ha ÉPP MOST jelölték késznek (nem korábban volt az, és nem most veszik le a pipát), az adminnak
// (Feri) egy értesítő emailt küldünk — ez CSAK tájékoztatás, a megrendelés státuszát nem módosítja.
router.post('/customers/:id/complete', requireDriverAuth, async (req, res) => {
  const { completed } = req.body;
  const isNowCompleted = completed === 'true' || completed === true;
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Nem található.' });
  const wasAlreadyCompleted = !!c.delivery_completed_at;

  db.prepare('UPDATE customers SET delivery_completed_at=?, updated_at=? WHERE id=?')
    .run(isNowCompleted ? new Date().toISOString() : null, new Date().toISOString(), c.id);

  if (isNowCompleted && !wasAlreadyCompleted) {
    try {
      const email = require('../services/email');
      await email.sendAdminInstalledNotice(c);
    } catch (err) {
      // Az admin-értesítő esetleges hibája (pl. email szolgáltatás átmeneti kiesése) ne akadályozza
      // meg a sofőrt abban, hogy a listáján kész-nek jelölje az ügyfelet.
      console.error('Admin "telepítve" értesítő küldési hiba:', err.message);
    }
  }

  res.json({ ok: true });
});

router.get('/', requireDriverAuth, (req, res) => {
  // Alapertelmezetten a legkozelebbi (legkorabbi, jovobeli vagy mai) napra allunk ra, hogy a sofor
  // ne egy ures/rossz napi listaval talalkozzon elso megnyitaskor.
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
           delivery_remaining_amount, delivery_address, delivery_lat, delivery_lng, delivery_arrival_time,
           delivery_completed_at
    FROM customers
    WHERE delivery_date = ?
    ORDER BY (delivery_completed_at IS NOT NULL), delivery_time ASC
  `).all(date);

  const cardsHtml = rows.length
    ? rows.map(c => {
      const mapsLink = buildMapsLink(c);
      const address = resolveDeliveryAddress(c);
      const isDone = !!c.delivery_completed_at;
      const amount = c.delivery_remaining_amount != null
        ? '<div class="amount">Do zapłaty na miejscu: ' + Number(c.delivery_remaining_amount).toLocaleString('pl-PL') + ' Ft</div>'
        : '';
      const safeName = esc(c.name || '').replace(/'/g, "\\'");
      const smsBox = c.phone ? (
        '<div class="sms-box">'
        + '<label for="arrival-' + c.id + '">Dokładna godzina przyjazdu</label>'
        + '<input type="time" id="arrival-' + c.id + '" value="' + esc(c.delivery_arrival_time || '') + '">'
        + '<button type="button" class="sms-btn" onclick="sendArrivalSms(' + c.id + ", '" + esc(c.phone) + "', '" + safeName + "')\">Wyślij SMS o godzinie przyjazdu</button>"
        + '</div>'
      ) : '';
      const doneToggle = (
        '<label class="done-toggle">'
        + '<input type="checkbox" ' + (isDone ? 'checked' : '') + ' onchange="toggleComplete(' + c.id + ', this.checked)">'
        + ' Gotowe z tym klientem'
        + '</label>'
      );
      return (
        '<div class="card' + (isDone ? ' done' : '') + '">'
        + '<div class="row"><span class="label">Godzina</span><span><strong>' + (c.delivery_time || '-') + '</strong></span></div>'
        + '<div class="name">' + esc(c.name || '') + (isDone ? ' <span class="done-badge">✔ Gotowe</span>' : '') + '</div>'
        + '<div class="row"><span class="label">Adres</span><span>' + esc(address) + '</span></div>'
        + amount
        + (mapsLink ? '<a class="maps-btn" href="' + mapsLink + '" target="_blank">Nawigacja Google Maps</a>' : '')
        + (c.phone ? '<a class="phone-btn" href="tel:' + esc(c.phone) + '">Zadzwoń: ' + esc(c.phone) + '</a>' : '')
        + smsBox
        + doneToggle
        + '</div>'
      );
    }).join('')
    : '<div class="empty">Brak dostaw na ten dzień.</div>';

  const script = '<script>'
    + 'async function toggleComplete(customerId, checked) {'
    + "  await fetch('/driver/customers/' + customerId + '/complete', {"
    + "    method: 'POST',"
    + "    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },"
    + "    body: 'completed=' + checked,"
    + '  });'
    + '  window.location.reload();'
    + '}'
    + 'async function sendArrivalSms(customerId, phone, name) {'
    + "  var input = document.getElementById('arrival-' + customerId);"
    + '  var time = input.value;'
    + "  if (!time) { alert('Proszę najpierw podać godzinę przyjazdu.'); return; }"
    + '  try {'
    + "    await fetch('/driver/customers/' + customerId + '/arrival-time', {"
    + "      method: 'POST',"
    + "      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },"
    + "      body: 'arrivalTime=' + encodeURIComponent(time),"
    + '    });'
    + '  } catch (e) { /* a mentes esetleges hibaja ne akadalyozza meg az SMS-t */ }'
    + "  var smsText = (name ? 'Kedves ' + name + '! ' : 'Tisztelt Ügyfelünk! ') + 'Garázsa kiszállítása ma kb. ' + time + ' órakor várható. Üdvözlettel: Pol-Bram csapata';"
    + "  window.location.href = 'sms:' + phone + '?body=' + encodeURIComponent(smsText);"
    + '}'
    + '</script>';

  res.send(layout('Lista kierowcy',
    '<header><h1>Lista kierowcy</h1><a href="/driver/logout">Wyloguj</a></header>'
    + '<main>'
    + '<form class="date-picker" method="GET" action="/driver">'
    + '<input type="date" name="date" value="' + date + '">'
    + '<button type="submit">Pokaż</button>'
    + '</form>'
    + cardsHtml
    + '</main>'
    + script
  ));
});

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

module.exports = router;
