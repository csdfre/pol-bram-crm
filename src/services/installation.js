const db = require('../../db');
const email = require('./email');

// Egy megrendelés "telepítve"-re állítása + záró (elégedettség/reklamáció linkes) e-mail.
// Kézi gomb és automatika is ezt használja, hogy a viselkedés azonos legyen.
async function markInstalled(c, note) {
  await email.sendInstalledNotice(c);
  const now = new Date().toISOString();
  db.prepare('UPDATE customers SET status=?, installed_at=?, updated_at=? WHERE id=?').run('telepitve', now, now, c.id);
  db.prepare('INSERT INTO status_log (customer_id, status, changed_at, note) VALUES (?, ?, ?, ?)')
    .run(c.id, 'telepitve', now, note || 'Garázs telepítve, értesítés kiküldve');
}

function localDateStr(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const AUTO_INSTALL_AFTER_DAYS = parseInt(process.env.AUTO_INSTALL_AFTER_DAYS) || 2;
const SKIP_STATUSES = ['telepitve', 'garancialis_problema', 'elutasitva', 'kiszallitas_csak'];

// A kiszállítási listában dátumot kapott ügyfelek: a dátum + 2 nap után automatikusan "telepítve"
// státusz és záró e-mail. Ha a levél nem megy ki, a státusz marad, és másnap újra próbálkozik.
async function autoMarkInstalled() {
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - AUTO_INSTALL_AFTER_DAYS);
  const cutoffStr = localDateStr(cutoff);
  const ph = SKIP_STATUSES.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT * FROM customers
    WHERE delivery_date IS NOT NULL AND delivery_date != '' AND substr(delivery_date,1,10) <= ?
      AND status NOT IN (${ph}) AND email IS NOT NULL AND email != ''
  `).all(cutoffStr, ...SKIP_STATUSES);
  if (!rows.length) return 0;
  console.log(`[telepítés] ${rows.length} ügyfél automatikus "telepítve" váltása (${AUTO_INSTALL_AFTER_DAYS} nap a kiszállítás után).`);
  let done = 0;
  for (const c of rows) {
    try {
      await markInstalled(c, `Automatikus: telepítve (${AUTO_INSTALL_AFTER_DAYS} nappal a kiszállítás, ${String(c.delivery_date).slice(0, 10)} után), záró e-mail kiküldve`);
      done++;
    } catch (err) {
      console.error(`[telepítés] Hiba a(z) ${c.name} (#${c.id}) ügyfélnél:`, err.message);
    }
  }
  return done;
}

module.exports = { markInstalled, autoMarkInstalled };
