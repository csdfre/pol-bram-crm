const express = require('express');
const cookieSession = require('cookie-session');
const db = require('../../db');
const { resolveDeliveryAddress } = require('../services/deliveryLocation');
const { planRoute } = require('../services/routePlanner');
const { buildOrderFields } = require('../services/pdf');

const router = express.Router();

router.use(cookieSession({
  name: 'logistics_session',
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  maxAge: 180 * 24 * 60 * 60 * 1000,
}));
router.use(express.urlencoded({ extended: true }));

const LOGISTICS_USERNAME = 'Logistyka';
const LOGISTICS_PASSWORD = '9876543';

const LOGISTICS_STATUSES = ['megrendelolap_kikuldve', 'megrendelolap_elfogadva', 'elolegszamla_kikuldve'];

/**
 * Rövid, lengyel nyelvű specifikáció-összefoglaló a garázsról — a logisztikusnak ez alapján kell
 * tudnia megbecsülni/ellenőrizni a telepítési időt (egy nagyobb, több kapus, összetettebb garázs
 * nyilván tovább tart, mint egy egyszerű, kisebb). Ugyanazt a karbantartott HU/PL fordítási
 * szótárat használja (buildOrderFields, pdf.js), amit a kolléganő-Excel és a PL PDF is használ.
 */
function buildSpecSummary(formDataJson) {
  if (!formDataJson) return '-';
  let fd;
  try { fd = JSON.parse(formDataJson); } catch (e) { return '-'; }
  const sections = buildOrderFields(fd, 'pl', false, null);
  function val(sectionName, label) {
    const sec = sections.find(function (s) { return s.section === sectionName; });
    if (!sec) return null;
    const item = sec.items.find(function (i) { return i.label === label; });
    return item ? item.value : null;
  }
  const w = (parseFloat(fd.width) || 0) / 100;
  const l = (parseFloat(fd.length) || 0) / 100;
  const h = fd.height || 213;
  const roofType = val('Dach', 'Typ dachu') || '-';
  const gateSection = sections.find(function (s) { return s.section === 'Brama garażowa'; });
  let gateInfo = 'brak bramy';
  if (gateSection && !gateSection.isEmpty) {
    const count = val('Brama garażowa', 'Ilość bram (szt.)') || 1;
    const gw = val('Brama garażowa', 'Szerokość bramy') || '-';
    gateInfo = count + 'x brama (' + gw + ')';
  }
  const structType = val('Konstrukcja', 'Typ') || '-';
  return w + 'x' + l + ' m (wys. ' + h + ' cm), dach: ' + roofType + ', ' + gateInfo + ', konstrukcja: ' + structType;
}

function requireLogisticsAuth(req, res, next) {
  if (req.session && req.session.logisticsAuthed) return next();
  return res.redirect('/logistics/login');
}

async function geocodeAddress(address) {
  try {
    const res = await fetch(
      'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(address),
      { headers: { 'User-Agent': 'PolBramCRM-Logistics/1.0' } }
    );
    const data = await res.json();
    if (data && data.length) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch (e) {
    console.error('Geokodolasi hiba:', address, e.message);
  }
  return null;
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function ensureCoordinates(customers) {
  for (const c of customers) {
    if (c.delivery_lat == null || c.delivery_lng == null) {
      const address = resolveDeliveryAddress(c);
      if (!address) continue;
      const coords = await geocodeAddress(address);
      if (coords) {
        db.prepare('UPDATE customers SET delivery_lat=?, delivery_lng=? WHERE id=?').run(coords.lat, coords.lng, c.id);
        c.delivery_lat = coords.lat;
        c.delivery_lng = coords.lng;
      }
      await sleep(1100);
    }
  }
}

function layout(title, bodyHtml) {
  return '<!DOCTYPE html><html lang="pl"><head><meta charset="UTF-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>' + title + ' - Pol-Bram</title>'
    + '<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">'
    + '<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>'
    + '<style>'
    + '* { box-sizing: border-box; }'
    + 'body { font-family: -apple-system, Arial, sans-serif; background: #EEF1F2; margin: 0; padding: 0; color: #20242A; }'
    + 'header { background: #20242A; border-bottom: 4px solid #F2B705; padding: 16px 18px; display: flex; justify-content: space-between; align-items: center; }'
    + 'header h1 { color: #fff; font-size: 1.05rem; margin: 0; text-transform: uppercase; letter-spacing: 0.03em; }'
    + 'header a { color: #F2B705; font-size: 0.85rem; text-decoration: none; }'
    + 'main { padding: 16px; max-width: 1100px; margin: 0 auto; }'
    + '.login-box { background: #fff; border-radius: 8px; padding: 28px 22px; margin: 40px auto; max-width: 340px; border-top: 4px solid #F2B705; }'
    + '.login-box h2 { margin-top: 0; text-align: center; }'
    + 'input[type=text], input[type=password], input[type=number], select { padding: 10px; border: 1px solid #ccc; border-radius: 6px; font-size: 0.95rem; }'
    + 'button { background: #F2B705; border: none; padding: 11px 18px; border-radius: 6px; cursor: pointer; font-size: 0.95rem; font-weight: bold; }'
    + '.error { color: #b23a3a; font-size: 0.9rem; text-align: center; margin-top: -8px; margin-bottom: 12px; }'
    + 'table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; margin-bottom: 20px; }'
    + 'th, td { padding: 8px 10px; text-align: left; font-size: 0.85rem; border-bottom: 1px solid #eee; }'
    + 'th { background: #fafbfb; color: #7a828a; font-size: 0.72rem; text-transform: uppercase; }'
    + '.panel { background: #fff; border-radius: 8px; padding: 16px 18px; margin-bottom: 18px; }'
    + '#map { height: 420px; border-radius: 8px; margin-bottom: 18px; }'
    + '.plan-controls { display: flex; gap: 14px; align-items: end; flex-wrap: wrap; margin-bottom: 14px; }'
    + '.day-col { flex: 1; min-width: 280px; }'
    + '.stop { background: #fafbfb; border: 1px solid #e6e8ea; border-radius: 6px; padding: 10px 12px; margin-bottom: 8px; }'
    + '.stop .eta { font-weight: bold; color: #20242A; }'
    + '.warn { background: #fff7e0; border: 1px solid #F2B705; border-radius: 6px; padding: 10px 12px; margin-bottom: 10px; font-size: 0.85rem; }'
    + '</style>'
    + '</head><body>' + bodyHtml + '</body></html>';
}

router.get('/login', function (req, res) {
  if (req.session && req.session.logisticsAuthed) return res.redirect('/logistics');
  const error = req.query.error ? '<div class="error">Nieprawidlowa nazwa uzytkownika lub haslo.</div>' : '';
  res.send(layout('Logowanie',
    '<div class="login-box">'
    + '<h2>Pol-Bram<br>Logistyka</h2>'
    + '<form method="POST" action="/logistics/login">'
    + error
    + '<input type="text" name="username" placeholder="Nazwa uzytkownika" autocomplete="username" required style="width:100%;margin-bottom:12px">'
    + '<input type="password" name="password" placeholder="Haslo" autocomplete="current-password" required style="width:100%;margin-bottom:16px">'
    + '<button type="submit" style="width:100%">Zaloguj sie</button>'
    + '</form>'
    + '</div>'
  ));
});

router.post('/login', function (req, res) {
  const username = req.body.username;
  const password = req.body.password;
  if (username === LOGISTICS_USERNAME && password === LOGISTICS_PASSWORD) {
    req.session.logisticsAuthed = true;
    return res.redirect('/logistics');
  }
  res.redirect('/logistics/login?error=1');
});

router.get('/logout', function (req, res) {
  req.session.logisticsAuthed = null;
  res.redirect('/logistics/login');
});

router.post('/customers/:id/installation-duration', requireLogisticsAuth, function (req, res) {
  const minutes = req.body.minutes;
  db.prepare('UPDATE customers SET installation_duration_min=?, updated_at=? WHERE id=?')
    .run(minutes === '' || minutes == null ? null : Number(minutes), new Date().toISOString(), req.params.id);
  res.json({ ok: true });
});

router.get('/api/customers', requireLogisticsAuth, async function (req, res) {
  const placeholders = LOGISTICS_STATUSES.map(function () { return '?'; }).join(',');
  const stmt = db.prepare(
    'SELECT id, name, phone, email, address, zip, city, price_huf, created_at, offer_sent_at, '
    + 'delivery_lat, delivery_lng, delivery_address, installation_duration_min, form_data, '
    + 'logistics_plan_day, logistics_plan_order, logistics_plan_eta '
    + 'FROM customers WHERE status IN (' + placeholders + ') ORDER BY created_at ASC'
  );
  const rows = stmt.all(...LOGISTICS_STATUSES);
  await ensureCoordinates(rows);
  const withAddress = rows.map(function (c) {
    const specSummary = buildSpecSummary(c.form_data);
    const clean = Object.assign({}, c);
    delete clean.form_data;
    return Object.assign(clean, {
      resolved_address: resolveDeliveryAddress(c),
      spec_summary: specSummary,
    });
  });
  res.json({ ok: true, customers: withAddress });
});

router.post('/api/generate-plan', requireLogisticsAuth, function (req, res) {
  const customerIds = req.body.customerIds;
  const days = req.body.days;
  if (!Array.isArray(customerIds) || !customerIds.length) return res.status(400).json({ error: 'Nincs kivalasztott megrendeles.' });
  const placeholders = customerIds.map(function () { return '?'; }).join(',');
  const stmt = db.prepare('SELECT * FROM customers WHERE id IN (' + placeholders + ')');
  const rows = stmt.all(...customerIds);
  const input = rows.map(function (c) {
    return {
      id: c.id,
      name: c.name,
      lat: c.delivery_lat,
      lng: c.delivery_lng,
      createdAt: c.created_at,
      installationMin: c.installation_duration_min || 90,
    };
  });
  const plan = planRoute(input, { days: days === 2 ? 2 : 1 });

  const now = new Date().toISOString();
  [plan.day1, plan.day2].forEach(function (dayStops, dayIdx) {
    dayStops.forEach(function (stop, orderIdx) {
      db.prepare('UPDATE customers SET logistics_plan_day=?, logistics_plan_order=?, logistics_plan_eta=?, updated_at=? WHERE id=?')
        .run(dayIdx + 1, orderIdx + 1, stop.eta, now, stop.id);
    });
  });
  plan.unscheduled.forEach(function (stop) {
    db.prepare('UPDATE customers SET logistics_plan_day=NULL, logistics_plan_order=NULL, logistics_plan_eta=NULL, updated_at=? WHERE id=?')
      .run(now, stop.id);
  });

  res.json({ ok: true, plan: plan });
});

router.get('/', requireLogisticsAuth, function (req, res) {
  res.send(layout('Logistyka',
    '<header><h1>Logistyka Pol-Bram</h1><a href="/logistics/logout">Wyloguj</a></header>'
    + '<main>'
    + '<div class="panel">'
    + '<h3 style="margin-top:0">Zamowienia oczekujace na montaz</h3>'
    + '<div id="customerTableWrap">Ladowanie...</div>'
    + '</div>'
    + '<div class="panel">'
    + '<h3 style="margin-top:0">Mapa</h3>'
    + '<div id="map"></div>'
    + '</div>'
    + '<div class="panel">'
    + '<h3 style="margin-top:0">Automatyczny plan trasy</h3>'
    + '<div class="plan-controls">'
    + '<div><label>Liczba dni</label><br><select id="planDays"><option value="1">1 dzien</option><option value="2">2 dni</option></select></div>'
    + '<button onclick="generatePlan()">Wygeneruj plan trasy</button>'
    + '</div>'
    + '<div id="planResult"></div>'
    + '</div>'
    + '</main>'
    + buildClientScript()
  ));
});

function buildClientScript() {
  return '<script>'
    + 'let customersData = [];'
    + 'let map, markers = [];'
    + 'async function loadCustomers() {'
    + '  const res = await fetch("/logistics/api/customers");'
    + '  const data = await res.json();'
    + '  customersData = data.customers;'
    + '  renderTable();'
    + '  renderMap();'
    + '}'
    + 'function renderTable() {'
    + '  const wrap = document.getElementById("customerTableWrap");'
    + '  if (!customersData.length) {'
    + '    wrap.innerHTML = "<p style=\\"color:#7a828a\\">Brak zamowien oczekujacych na montaz.</p>";'
    + '    return;'
    + '  }'
    + '  let html = "<table><thead><tr><th></th><th>Klient</th><th>Adres</th><th>Specyfikacja</th><th>Telefon</th><th>Cena</th><th>Zgloszono</th><th>Czas montazu (min)</th><th>Ostatni plan</th></tr></thead><tbody>";'
    + '  customersData.forEach(function (c) {'
    + '    const price = c.price_huf ? Number(c.price_huf).toLocaleString("pl-PL") + " Ft" : "-";'
    + '    const created = new Date(c.created_at).toLocaleDateString("pl-PL");'
    + '    const planInfo = c.logistics_plan_day ? ("Dzien " + c.logistics_plan_day + ", #" + c.logistics_plan_order + " (" + c.logistics_plan_eta + ")") : "-";'
    + '    html += "<tr>"'
    + '      + "<td><input type=\\"checkbox\\" class=\\"planCheck\\" value=\\"" + c.id + "\\" checked></td>"'
    + '      + "<td>" + escapeHtml(c.name || "") + "</td>"'
    + '      + "<td>" + escapeHtml(c.resolved_address || "") + "</td>"'
    + '      + "<td style=\\"max-width:260px\\">" + escapeHtml(c.spec_summary || "-") + "</td>"'
    + '      + "<td>" + escapeHtml(c.phone || "") + "</td>"'
    + '      + "<td>" + price + "</td>"'
    + '      + "<td>" + created + "</td>"'
    + '      + "<td><input type=\\"number\\" value=\\"" + (c.installation_duration_min || 90) + "\\" style=\\"width:70px\\" onchange=\\"saveDuration(" + c.id + ", this.value)\\"></td>"'
    + '      + "<td>" + planInfo + "</td>"'
    + '      + "</tr>";'
    + '  });'
    + '  html += "</tbody></table>";'
    + '  wrap.innerHTML = html;'
    + '}'
    + 'async function saveDuration(id, minutes) {'
    + '  await fetch("/logistics/customers/" + id + "/installation-duration", {'
    + '    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },'
    + '    body: "minutes=" + encodeURIComponent(minutes),'
    + '  });'
    + '}'
    + 'function renderMap() {'
    + '  if (!map) { map = L.map("map").setView([47.1625, 19.5033], 7);'
    + '    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap" }).addTo(map); }'
    + '  markers.forEach(function (m) { map.removeLayer(m); });'
    + '  markers = [];'
    + '  customersData.forEach(function (c) {'
    + '    if (c.delivery_lat != null && c.delivery_lng != null) {'
    + '      const m = L.marker([c.delivery_lat, c.delivery_lng]).addTo(map).bindPopup(escapeHtml(c.name || "") + "<br>" + escapeHtml(c.resolved_address || "") + "<br><small>" + escapeHtml(c.spec_summary || "") + "</small>");'
    + '      markers.push(m);'
    + '    }'
    + '  });'
    + '}'
    + 'async function generatePlan() {'
    + '  const ids = Array.from(document.querySelectorAll(".planCheck:checked")).map(function (el) { return Number(el.value); });'
    + '  if (!ids.length) { alert("Zaznacz przynajmniej jedno zamowienie."); return; }'
    + '  const days = Number(document.getElementById("planDays").value);'
    + '  const res = await fetch("/logistics/api/generate-plan", {'
    + '    method: "POST", headers: { "Content-Type": "application/json" },'
    + '    body: JSON.stringify({ customerIds: ids, days: days }),'
    + '  });'
    + '  const data = await res.json();'
    + '  if (!res.ok) { alert(data.error || "Blad"); return; }'
    + '  renderPlan(data.plan);'
    + '  loadCustomers();'
    + '}'
    + 'function renderPlan(plan) {'
    + '  const el = document.getElementById("planResult");'
    + '  function renderDay(title, stops) {'
    + '    if (!stops.length) return "";'
    + '    let html = "<div class=\\"day-col\\"><h4>" + title + "</h4>";'
    + '    stops.forEach(function (s, i) {'
    + '      html += "<div class=\\"stop\\"><span class=\\"eta\\">#" + (i+1) + " - " + s.eta + "</span> (koniec: " + s.doneAt + ") - " + escapeHtml(s.name || "") + (s.travelMin ? " <span style=\\"color:#7a828a\\">(dojazd: " + s.travelMin + " min)</span>" : "") + "</div>";'
    + '    });'
    + '    html += "</div>";'
    + '    return html;'
    + '  }'
    + '  let html = "<div style=\\"display:flex;gap:20px;flex-wrap:wrap\\">";'
    + '  html += renderDay("Dzien 1", plan.day1);'
    + '  html += renderDay("Dzien 2", plan.day2);'
    + '  html += "</div>";'
    + '  if (plan.unscheduled && plan.unscheduled.length) {'
    + '    html += "<div class=\\"warn\\">Nie zmiescily sie w planie: " + plan.unscheduled.map(function(s){return escapeHtml(s.name||"");}).join(", ") + "</div>";'
    + '  }'
    + '  if (plan.skippedNoLocation && plan.skippedNoLocation.length) {'
    + '    html += "<div class=\\"warn\\">Brak lokalizacji (nie udalo sie zgeokodowac adresu): " + plan.skippedNoLocation.map(function(s){return escapeHtml(s.name||"");}).join(", ") + "</div>";'
    + '  }'
    + '  el.innerHTML = html;'
    + '}'
    + 'function escapeHtml(s) {'
    + '  const d = document.createElement("div"); d.innerText = s; return d.innerHTML;'
    + '}'
    + 'loadCustomers();'
    + '</script>';
}

module.exports = router;
