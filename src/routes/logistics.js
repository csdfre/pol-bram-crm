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

// A telepítésre-alkalmas dátum (amit vagy az ügyfél adott meg a tervező oldalon, vagy amit itt a
// logisztikus manuálisan felülír/pontosít) szerkesztése — ugyanabba az install_availability_date
// mezőbe ír, amit az admin ügyfél-adatlap is lát/szerkeszthet.
router.post('/customers/:id/availability-date', requireLogisticsAuth, function (req, res) {
  const date = req.body.date;
  db.prepare('UPDATE customers SET install_availability_date=?, updated_at=? WHERE id=?')
    .run(date || null, new Date().toISOString(), req.params.id);
  res.json({ ok: true });
});

router.get('/api/customers', requireLogisticsAuth, async function (req, res) {
  const placeholders = LOGISTICS_STATUSES.map(function () { return '?'; }).join(',');
  const stmt = db.prepare(
    'SELECT id, name, phone, email, address, zip, city, price_huf, created_at, offer_sent_at, '
    + 'delivery_lat, delivery_lng, delivery_address, installation_duration_min, form_data, colleague_token, '
    + 'install_availability_date, delivery_completed_at, '
    + 'logistics_plan_day, logistics_plan_order, logistics_plan_eta '
    + 'FROM customers WHERE status IN (' + placeholders + ') AND delivery_completed_at IS NULL ORDER BY created_at ASC'
  );
  const rows = stmt.all(...LOGISTICS_STATUSES);
  await ensureCoordinates(rows);
  const withAddress = rows.map(function (c) {
    const specSummary = buildSpecSummary(c.form_data);
    const clean = Object.assign({}, c);
    delete clean.form_data;
    // Ha az ügyfél (vagy az admin manuálisan) megadott egy telepítésre-alkalmas dátumot, amíg az még
    // több mint 14 napra van, ne "ajánljuk" alapból bejelölve az útvonaltervezéshez — az admin
    // persze kézzel bepipálhatja, ha mégis szeretné, de alapból ne kerüljön bele egy soron
    // következő tervbe egy olyan ügyfél, aki még nem is ér rá.
    const daysUntilAvailable = c.install_availability_date
      ? Math.ceil((new Date(c.install_availability_date) - new Date()) / (1000 * 60 * 60 * 24))
      : null;
    const tooFarInFuture = daysUntilAvailable != null && daysUntilAvailable > 14;
    return Object.assign(clean, {
      resolved_address: resolveDeliveryAddress(c),
      spec_summary: specSummary,
      too_far_in_future: tooFarInFuture,
      is_installed: !!c.delivery_completed_at,
    });
  });
  res.json({ ok: true, customers: withAddress });
});

// Külön, egyszerű nézet a már kész (a sofőr által "Gotowe"-nek jelölt) telepítéseknek — ezek nem
// zavarják a fő tervezési listát/térképet, de a logisztikus itt bármikor visszanézheti őket.
router.get('/api/completed', requireLogisticsAuth, function (req, res) {
  const rows = db.prepare(`
    SELECT id, name, phone, address, zip, city, price_huf, delivery_completed_at, delivery_date, colleague_token
    FROM customers
    WHERE delivery_completed_at IS NOT NULL
    ORDER BY delivery_completed_at DESC
  `).all();
  const withAddress = rows.map((c) => Object.assign({}, c, { resolved_address: resolveDeliveryAddress(c) }));
  res.json({ ok: true, customers: withAddress });
});

// Reklamációk, amiket az ügyfél a "sikeres telepítés" emailben kapott linken keresztül küldött be —
// a logisztikusnak is látnia kell ezeket, mert ő tudja leghamarabb elérni a helyszínt. A szöveget
// (ha sikerült) lefordítva, lengyelül mutatjuk — ha a fordítás nem sikerült, az eredeti (magyar)
// szöveg jelenik meg.
router.get('/api/complaints', requireLogisticsAuth, function (req, res) {
  const rows = db.prepare(`
    SELECT id, name, phone, address, zip, city, complaint_text, complaint_text_pl, complaint_alert_at, complaint_files
    FROM customers
    WHERE complaint_alert_at IS NOT NULL
    ORDER BY complaint_alert_at DESC
  `).all();
  const withAddress = rows.map((c) => Object.assign({}, c, { resolved_address: resolveDeliveryAddress(c) }));
  res.json({ ok: true, complaints: withAddress });
});

// A logisztikus nyugtázza, hogy látta a reklamációt — ez csak a SAJÁT felületén lévő jelzést törli,
// az admin felületén lévő (status_alert_at alapú) jelzést nem érinti.
router.post('/api/complaints/:id/acknowledge', requireLogisticsAuth, function (req, res) {
  db.prepare('UPDATE customers SET complaint_alert_at=NULL WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/api/generate-plan', requireLogisticsAuth, function (req, res) {
  const customerIds = req.body.customerIds;
  const days = req.body.days;
  const dayStart = req.body.dayStart || '04:30';
  const dayEnd = req.body.dayEnd || '20:30';
  const priorityDirection = req.body.priorityDirection === 'newest' ? 'newest' : 'oldest';
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
  // Egyetlen, a legrövidebb útvonalat célzó terv — a régebbi (vagy a priorityDirection="newest"
  // esetén a frissebb) megrendeléseknek adva egy mérsékelt előnyt, amíg az nem töri meg a
  // dél-észak haladást. A tényleges mentés csak az /api/apply-plan végponton keresztül történik.
  const plan = planRoute(input, { days: days === 2 ? 2 : 1, dayStart: dayStart, dayEnd: dayEnd, priorityDirection: priorityDirection });
  res.json({ ok: true, plan: plan });
});

// A logisztikus által kiválasztott konkrét terv-változat véglegesítése — csak ekkor írjuk vissza
// az adatbázisba a nap/sorrend/ETA mezőket.
router.post('/api/apply-plan', requireLogisticsAuth, function (req, res) {
  const plan = req.body.plan;
  if (!plan) return res.status(400).json({ error: 'Hianyzik a terv.' });
  const now = new Date().toISOString();
  [plan.day1 || [], plan.day2 || []].forEach(function (dayStops, dayIdx) {
    dayStops.forEach(function (stop, orderIdx) {
      db.prepare('UPDATE customers SET logistics_plan_day=?, logistics_plan_order=?, logistics_plan_eta=?, updated_at=? WHERE id=?')
        .run(dayIdx + 1, orderIdx + 1, stop.eta, now, stop.id);
    });
  });
  (plan.unscheduled || []).forEach(function (stop) {
    db.prepare('UPDATE customers SET logistics_plan_day=NULL, logistics_plan_order=NULL, logistics_plan_eta=NULL, updated_at=? WHERE id=?')
      .run(now, stop.id);
  });
  res.json({ ok: true });
});

router.get('/', requireLogisticsAuth, function (req, res) {
  res.send(layout('Logistyka',
    '<header><h1>Logistyka Pol-Bram</h1><a href="/logistics/logout">Wyloguj</a></header>'
    + '<main>'
    + '<div class="panel">'
    + '<h3 style="margin-top:0">Zamowienia oczekujace na montaz</h3>'
    + '<div style="margin-bottom:10px"><label style="font-size:0.85rem">Filtruj po regionie (miasto / kod pocztowy): </label><input type="text" id="regionFilter" oninput="renderTable()" placeholder="np. Budapeszt lub 1000" style="padding:6px 10px;border:1px solid #ccc;border-radius:4px"></div>'
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
    + '<div><label>Godzina rozpoczecia</label><br><input type="time" id="planDayStart" value="04:30"></div>'
    + '<div><label>Godzina zakonczenia</label><br><input type="time" id="planDayEnd" value="20:30"></div>'
    + '<div><label>Priorytet</label><br><select id="planPriority"><option value="oldest">Najstarsze zamówienia</option><option value="newest">Najnowsze zamówienia</option></select></div>'
    + '<button onclick="generatePlan()">Wygeneruj plan trasy (najkrótsza trasa)</button>'
    + '</div>'
    + '<div id="planResult"></div>'
    + '</div>'
    + '<div class="panel">'
    + '<h3 style="margin-top:0">Reklamacje <button onclick="toggleComplaints()" style="font-size:0.75rem;padding:4px 10px;margin-left:8px">Pokaz / ukryj</button></h3>'
    + '<div id="complaintsTableWrap" style="display:none">Ladowanie...</div>'
    + '</div>'
    + '<div class="panel">'
    + '<h3 style="margin-top:0">Zakonczone montaze <button onclick="toggleCompleted()" style="font-size:0.75rem;padding:4px 10px;margin-left:8px">Pokaz / ukryj</button></h3>'
    + '<div id="completedTableWrap" style="display:none">Ladowanie...</div>'
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
    + '  const regionQuery = (document.getElementById("regionFilter").value || "").trim().toLowerCase();'
    + '  const rowsToShow = regionQuery'
    + '    ? customersData.filter(function (c) { return (c.resolved_address || "").toLowerCase().indexOf(regionQuery) !== -1 || (c.zip || "").toLowerCase().indexOf(regionQuery) !== -1 || (c.city || "").toLowerCase().indexOf(regionQuery) !== -1; })'
    + '    : customersData;'
    + '  if (!rowsToShow.length) {'
    + '    wrap.innerHTML = "<p style=\\"color:#7a828a\\">Brak wynikow dla tego regionu.</p>";'
    + '    return;'
    + '  }'
    + '  let html = "<table><thead><tr><th></th><th>Klient</th><th>Status</th><th>Adres</th><th>Szczegóły</th><th>Telefon</th><th>Cena</th><th>Zgloszono</th><th>Dostepny od</th><th>Czas montazu (min)</th><th>Ostatni plan</th></tr></thead><tbody>";'
    + '  rowsToShow.forEach(function (c) {'
    + '    const price = c.price_huf ? Number(c.price_huf).toLocaleString("pl-PL") + " Ft" : "-";'
    + '    const created = new Date(c.created_at).toLocaleDateString("pl-PL");'
    + '    const planInfo = c.logistics_plan_day ? ("Dzien " + c.logistics_plan_day + ", #" + c.logistics_plan_order + " (" + c.logistics_plan_eta + ")") : "-";'
    + '    const detailsBtn = c.colleague_token ? ("<a href=\\"/public/colleague/" + c.colleague_token + "\\" target=\\"_blank\\" style=\\"display:inline-block;background:#20242A;color:#fff;text-decoration:none;padding:6px 10px;border-radius:4px;font-size:0.78rem\\">Zobacz szczegóły + rysunek</a>") : "<span style=\\"color:#7a828a;font-size:0.78rem\\">brak danych</span>";'
    + '    const statusBadge = c.is_installed ? "<span style=\\"background:#2F6B4F;color:#fff;font-size:0.72rem;font-weight:bold;padding:3px 8px;border-radius:10px\\">Zamontowane</span>" : "<span style=\\"color:#7a828a;font-size:0.78rem\\">w toku</span>";'
    + '    const farNote = c.too_far_in_future ? "<div style=\\"color:#b23a3a;font-size:0.7rem;margin-top:2px\\">ponad 14 dni</div>" : "";'
    + '    const checkedAttr = c.too_far_in_future ? "" : "checked";'
    + '    html += "<tr" + (c.is_installed ? " style=\\"opacity:0.55\\"" : "") + ">"'
    + '      + "<td><input type=\\"checkbox\\" class=\\"planCheck\\" value=\\"" + c.id + "\\" " + checkedAttr + "></td>"'
    + '      + "<td>" + escapeHtml(c.name || "") + "</td>"'
    + '      + "<td>" + statusBadge + "</td>"'
    + '      + "<td>" + escapeHtml(c.resolved_address || "") + "</td>"'
    + '      + "<td>" + detailsBtn + "</td>"'
    + '      + "<td>" + escapeHtml(c.phone || "") + "</td>"'
    + '      + "<td>" + price + "</td>"'
    + '      + "<td>" + created + "</td>"'
    + '      + "<td><input type=\\"date\\" value=\\"" + (c.install_availability_date || "") + "\\" style=\\"width:130px\\" onchange=\\"saveAvailability(" + c.id + ", this.value)\\">" + farNote + "</td>"'
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
    + 'async function saveAvailability(id, date) {'
    + '  await fetch("/logistics/customers/" + id + "/availability-date", {'
    + '    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },'
    + '    body: "date=" + encodeURIComponent(date),'
    + '  });'
    + '  loadCustomers();'
    + '}'
    + 'function renderMap() {'
    + '  if (!map) { map = L.map("map").setView([47.1625, 19.5033], 7);'
    + '    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap" }).addTo(map); }'
    + '  markers.forEach(function (m) { map.removeLayer(m); });'
    + '  markers = [];'
    + '  customersData.forEach(function (c) {'
    + '    if (c.delivery_lat != null && c.delivery_lng != null) {'
    + '      const popupHtml = escapeHtml(c.name || "") + "<br>" + escapeHtml(c.resolved_address || "") + "<br><small>" + escapeHtml(c.spec_summary || "") + "</small>" + (c.colleague_token ? ("<br><a href=\\"/public/colleague/" + c.colleague_token + "\\" target=\\"_blank\\">Zobacz szczegóły + rysunek</a>") : "");'
    + '      const m = L.marker([c.delivery_lat, c.delivery_lng]).addTo(map).bindPopup(popupHtml);'
    + '      markers.push(m);'
    + '    }'
    + '  });'
    + '}'
    + 'let routeLayers = [];'
    + 'function renderRouteOnMap(plan) {'
    + '  routeLayers.forEach(function (l) { map.removeLayer(l); });'
    + '  routeLayers = [];'
    + '  const dayStyles = [ { color: "#2a72c4", label: "1" }, { color: "#c4622a", label: "2" } ];'
    + '  [plan.day1, plan.day2].forEach(function (stops, dayIdx) {'
    + '    if (!stops.length) return;'
    + '    const style = dayStyles[dayIdx];'
    + '    const latlngs = stops.filter(function(s){return s.lat!=null && s.lng!=null;}).map(function (s) { return [s.lat, s.lng]; });'
    + '    if (latlngs.length > 1) {'
    + '      const line = L.polyline(latlngs, { color: style.color, weight: 4, opacity: 0.8, dashArray: dayIdx === 1 ? "8,6" : null }).addTo(map);'
    + '      routeLayers.push(line);'
    + '    }'
    + '    stops.forEach(function (s, i) {'
    + '      if (s.lat == null || s.lng == null) return;'
    + '      const icon = L.divIcon({'
    + '        className: "",'
    + '        html: "<div style=\\"background:" + style.color + ";color:#fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)\\">" + (i+1) + "</div>",'
    + '        iconSize: [26, 26], iconAnchor: [13, 13],'
    + '      });'
    + '      const marker = L.marker([s.lat, s.lng], { icon: icon }).addTo(map)'
    + '        .bindPopup("Dzien " + style.label + ", #" + (i+1) + " - " + s.eta + "<br>" + escapeHtml(s.name || ""));'
    + '      routeLayers.push(marker);'
    + '    });'
    + '  });'
    + '  if (plan.day1.length && plan.day2.length) {'
    + '    const lastDay1 = plan.day1[plan.day1.length - 1];'
    + '    const firstDay2 = plan.day2[0];'
    + '    if (lastDay1.lat != null && firstDay2.lat != null) {'
    + '      const connector = L.polyline([[lastDay1.lat, lastDay1.lng], [firstDay2.lat, firstDay2.lng]], { color: "#7a828a", weight: 3, opacity: 0.7, dashArray: "2,10" }).addTo(map)'
    + '        .bindPopup("Przejazd z dnia 1 na dzien 2");'
    + '      routeLayers.push(connector);'
    + '    }'
    + '  }'
    + '  const allLatLngs = [];'
    + '  [plan.day1, plan.day2].forEach(function (stops) { stops.forEach(function (s) { if (s.lat != null && s.lng != null) allLatLngs.push([s.lat, s.lng]); }); });'
    + '  if (allLatLngs.length) map.fitBounds(allLatLngs, { padding: [30, 30] });'
    + '}'
    + 'let lastPlan = null;'
    + 'async function generatePlan() {'
    + '  const ids = Array.from(document.querySelectorAll(".planCheck:checked")).map(function (el) { return Number(el.value); });'
    + '  if (!ids.length) { alert("Zaznacz przynajmniej jedno zamowienie."); return; }'
    + '  const days = Number(document.getElementById("planDays").value);'
    + '  const dayStart = document.getElementById("planDayStart").value || "04:30";'
    + '  const dayEnd = document.getElementById("planDayEnd").value || "20:30";'
    + '  const priorityDirection = document.getElementById("planPriority").value || "oldest";'
    + '  const res = await fetch("/logistics/api/generate-plan", {'
    + '    method: "POST", headers: { "Content-Type": "application/json" },'
    + '    body: JSON.stringify({ customerIds: ids, days: days, dayStart: dayStart, dayEnd: dayEnd, priorityDirection: priorityDirection }),'
    + '  });'
    + '  const data = await res.json();'
    + '  if (!res.ok) { alert(data.error || "Blad"); return; }'
    + '  lastPlan = data.plan;'
    + '  renderRouteOnMap(data.plan);'
    + '  renderPlanResult(data.plan);'
    + '}'
    + 'function renderPlanResult(plan) {'
    + '  const el = document.getElementById("planResult");'
    + '  const s = summarizePlanClient(plan);'
    + '  let html = "<div style=\\"font-size:0.85rem;color:#454C54;margin-bottom:10px\\">";'
    + '  html += "Zatrzymania: " + s.stopCount + (s.unscheduledCount ? (" (" + s.unscheduledCount + " nie zmiescilo sie)") : "") + "<br>";'
    + '  html += "Koniec: dzien " + s.finishDay + ", " + (s.finishTime || "-") + "<br>";'
    + '  html += "Laczny czas dojazdu: " + s.totalTravelMin + " min";'
    + '  if (s.overrunCount) html += "<br><span style=\\"color:#b23a3a\\">" + s.overrunCount + " zatrzymanie(a) przekracza planowana godzine</span>";'
    + '  html += "</div>";'
    + '  html += "<button onclick=\\"applyPlan()\\">Zastosuj ten plan</button>";'
    + '  html += renderPlanDetailHtml(plan);'
    + '  el.innerHTML = html;'
    + '}'
    + 'function summarizePlanClient(plan) {'
    + '  const allStops = plan.day1.concat(plan.day2);'
    + '  const totalTravelMin = allStops.reduce(function(sum, s){ return sum + (s.travelMin || 0); }, 0);'
    + '  const overrunCount = allStops.filter(function(s){ return s.overrun; }).length;'
    + '  const lastStop = plan.day2.length ? plan.day2[plan.day2.length - 1] : plan.day1[plan.day1.length - 1];'
    + '  return { stopCount: allStops.length, unscheduledCount: plan.unscheduled.length, totalTravelMin: Math.round(totalTravelMin), overrunCount: overrunCount, finishDay: plan.day2.length ? 2 : 1, finishTime: lastStop ? lastStop.doneAt : null };'
    + '}'
    + 'async function applyPlan() {'
    + '  if (!lastPlan) return;'
    + '  const res = await fetch("/logistics/api/apply-plan", {'
    + '    method: "POST", headers: { "Content-Type": "application/json" },'
    + '    body: JSON.stringify({ plan: lastPlan }),'
    + '  });'
    + '  const data = await res.json();'
    + '  if (!res.ok) { alert(data.error || "Blad"); return; }'
    + '  alert("Plan zastosowany.");'
    + '  loadCustomers();'
    + '}'
    + 'function renderPlanDetailHtml(plan) {'
    + '  function renderDay(title, stops) {'
    + '    if (!stops.length) return "";'
    + '    let html = "<div class=\\"day-col\\"><h4>" + title + "</h4>";'
    + '    stops.forEach(function (s, i) {'
    + '      html += "<div class=\\"stop\\"><span class=\\"eta\\">#" + (i+1) + " - " + s.eta + "</span> (koniec: " + s.doneAt + ") - " + escapeHtml(s.name || "") + (s.travelMin ? " <span style=\\"color:#7a828a\\">(dojazd: " + s.travelMin + " min)</span>" : "") + (s.overrun ? " <span style=\\"color:#b23a3a;font-weight:bold\\">[przekracza planowana godzine zakonczenia]</span>" : "") + "</div>";'
    + '    });'
    + '    html += "</div>";'
    + '    return html;'
    + '  }'
    + '  let html = "<div style=\\"display:flex;gap:20px;flex-wrap:wrap;margin-top:10px\\">";'
    + '  html += renderDay("Dzien 1", plan.day1);'
    + '  html += renderDay("Dzien 2", plan.day2);'
    + '  html += "</div>";'
    + '  if (plan.unscheduled && plan.unscheduled.length) {'
    + '    html += "<div class=\\"warn\\">Nie zmiescily sie w planie: " + plan.unscheduled.map(function(s){return escapeHtml(s.name||"");}).join(", ") + "</div>";'
    + '  }'
    + '  if (plan.skippedNoLocation && plan.skippedNoLocation.length) {'
    + '    html += "<div class=\\"warn\\">Brak lokalizacji (nie udalo sie zgeokodowac adresu): " + plan.skippedNoLocation.map(function(s){return escapeHtml(s.name||"");}).join(", ") + "</div>";'
    + '  }'
    + '  return html;'
    + '}'
    + 'function escapeHtml(s) {'
    + '  const d = document.createElement("div"); d.innerText = s; return d.innerHTML;'
    + '}'
    + 'let completedLoaded = false;'
    + 'async function toggleCompleted() {'
    + '  const wrap = document.getElementById("completedTableWrap");'
    + '  if (wrap.style.display === "none") {'
    + '    wrap.style.display = "block";'
    + '    if (!completedLoaded) { await loadCompleted(); completedLoaded = true; }'
    + '  } else {'
    + '    wrap.style.display = "none";'
    + '  }'
    + '}'
    + 'async function loadCompleted() {'
    + '  const wrap = document.getElementById("completedTableWrap");'
    + '  const res = await fetch("/logistics/api/completed");'
    + '  const data = await res.json();'
    + '  const rows = data.customers;'
    + '  if (!rows.length) { wrap.innerHTML = "<p style=\\"color:#7a828a\\">Meg nincs lezart montaz.</p>"; return; }'
    + '  let html = "<table><thead><tr><th>Klient</th><th>Adres</th><th>Telefon</th><th>Cena</th><th>Zakonczono</th><th>Szczegoly</th></tr></thead><tbody>";'
    + '  rows.forEach(function (c) {'
    + '    const price = c.price_huf ? Number(c.price_huf).toLocaleString("pl-PL") + " Ft" : "-";'
    + '    const completedDate = new Date(c.delivery_completed_at).toLocaleString("pl-PL");'
    + '    const detailsBtn = c.colleague_token ? ("<a href=\\"/public/colleague/" + c.colleague_token + "\\" target=\\"_blank\\">Zobacz szczegoly</a>") : "-";'
    + '    html += "<tr>"'
    + '      + "<td>" + escapeHtml(c.name || "") + "</td>"'
    + '      + "<td>" + escapeHtml(c.resolved_address || "") + "</td>"'
    + '      + "<td>" + escapeHtml(c.phone || "") + "</td>"'
    + '      + "<td>" + price + "</td>"'
    + '      + "<td>" + completedDate + "</td>"'
    + '      + "<td>" + detailsBtn + "</td>"'
    + '      + "</tr>";'
    + '  });'
    + '  html += "</tbody></table>";'
    + '  wrap.innerHTML = html;'
    + '}'
    + 'let complaintsLoaded = false;'
    + 'async function toggleComplaints() {'
    + '  const wrap = document.getElementById("complaintsTableWrap");'
    + '  if (wrap.style.display === "none") {'
    + '    wrap.style.display = "block";'
    + '    await loadComplaints();'
    + '  } else {'
    + '    wrap.style.display = "none";'
    + '  }'
    + '}'
    + 'async function loadComplaints() {'
    + '  const wrap = document.getElementById("complaintsTableWrap");'
    + '  const res = await fetch("/logistics/api/complaints");'
    + '  const data = await res.json();'
    + '  const rows = data.complaints;'
    + '  if (!rows.length) { wrap.innerHTML = "<p style=\\"color:#7a828a\\">Brak zgloszonych reklamacji.</p>"; return; }'
    + '  let html = "";'
    + '  rows.forEach(function (c) {'
    + '    const reportedDate = new Date(c.complaint_alert_at).toLocaleString("pl-PL");'
    + '    const text = c.complaint_text_pl || c.complaint_text || "";'
    + '    const originalNote = c.complaint_text_pl ? ("<div style=\\"font-size:0.72rem;color:#7a828a;margin-top:6px\\">Oryginal (HU): " + escapeHtml(c.complaint_text || "") + "</div>") : "<div style=\\"font-size:0.72rem;color:#b23a3a;margin-top:6px\\">(nie udalo sie przetlumaczyc, powyzej oryginalny tekst)</div>";'
    + '    html += "<div class=\\"stop\\" style=\\"border-left:4px solid #b23a3a\\">"'
    + '      + "<strong>" + escapeHtml(c.name || "") + "</strong> — " + escapeHtml(c.resolved_address || "") + " — " + escapeHtml(c.phone || "") + "<br>"'
    + '      + "<span style=\\"color:#7a828a;font-size:0.78rem\\">Zgloszono: " + reportedDate + "</span>"'
    + '      + "<p style=\\"margin:8px 0\\">" + escapeHtml(text) + "</p>"'
    + '      + originalNote'
    + '      + "<button onclick=\\"acknowledgeComplaint(" + c.id + ")\\" style=\\"font-size:0.75rem;padding:4px 10px;margin-top:6px\\">Oznacz jako przeczytane</button>"'
    + '      + "</div>";'
    + '  });'
    + '  wrap.innerHTML = html;'
    + '}'
    + 'async function acknowledgeComplaint(id) {'
    + '  await fetch("/logistics/api/complaints/" + id + "/acknowledge", { method: "POST" });'
    + '  loadComplaints();'
    + '}'
    + 'loadCustomers();'
    + '</script>';
}

module.exports = router;
