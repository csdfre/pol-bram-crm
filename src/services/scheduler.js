const cron = require('node-cron');
const db = require('../../db');
const email = require('./email');

const REMINDER_AFTER_DAYS = parseInt(process.env.REMINDER_AFTER_DAYS) || 5;

async function checkAndSendReminders(){
  const cutoff = new Date(Date.now() - REMINDER_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const candidates = db.prepare(`
    SELECT * FROM customers
    WHERE status = 'ajanlat_kikuldve'
      AND offer_sent_at IS NOT NULL
      AND offer_sent_at <= ?
      AND reminder_sent_at IS NULL
      AND price_breakdown IS NOT NULL
  `).all(cutoff);

  if (candidates.length === 0) return;
  console.log(`[emlékeztető] ${candidates.length} ügyfélnek küldünk automatikus emlékeztetőt (${REMINDER_AFTER_DAYS} nap óta nincs válasz).`);

  for (const c of candidates) {
    try {
      const quote = JSON.parse(c.price_breakdown);
      const priceText = `${quote.displayTotal.toLocaleString('hu-HU')} Ft (${quote.displayLabel})`;
      await email.sendOfferReminder(c, priceText);
      db.prepare('UPDATE customers SET reminder_sent_at=?, updated_at=? WHERE id=?')
        .run(new Date().toISOString(), new Date().toISOString(), c.id);
      db.prepare('INSERT INTO status_log (customer_id, status, changed_at, note) VALUES (?, ?, ?, ?)')
        .run(c.id, c.status, new Date().toISOString(), `Automatikus emlékeztető kiküldve (${REMINDER_AFTER_DAYS} nap után)`);
      console.log(`[emlékeztető] Kiküldve: ${c.name} (#${c.id})`);
    } catch (err) {
      console.error(`[emlékeztető] Hiba a(z) ${c.name} (#${c.id}) ügyfélnél:`, err.message);
    }
  }
}

function startScheduler(){
  // Minden nap reggel 9:00-kor (szerver saját időzónája szerint) ellenőrzi a válasz nélküli ajánlatokat
  cron.schedule('0 9 * * *', () => {
    checkAndSendReminders().catch(err => console.error('[emlékeztető] Ütemezett futás hiba:', err));
  });
  console.log('Emlékeztető-ütemező elindítva (naponta 9:00-kor fut).');
}

module.exports = { startScheduler, checkAndSendReminders };
