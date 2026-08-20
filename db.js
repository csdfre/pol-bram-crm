const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'garage-crm.sqlite'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ajanlatra_var',

  name TEXT,
  phone TEXT,
  email TEXT,
  zip TEXT,
  city TEXT,
  address TEXT,

  form_data TEXT,        -- teljes JSON: a garázs összes beállítása
  summary_text TEXT,      -- ember-olvasható összefoglaló
  sketch_svg TEXT,         -- a felülnézeti vázlat SVG markup-ja

  price_huf INTEGER,
  price_breakdown TEXT,   -- JSON: tételes bontás

  accept_token TEXT,
  satisfaction_token TEXT,
  complaint_token TEXT,

  invoice_file TEXT,
  complaint_text TEXT,
  complaint_files TEXT,   -- JSON tömb a feltöltött fájlok elérési útjaival
  satisfaction_rating INTEGER
);

CREATE TABLE IF NOT EXISTS garage_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  image_path TEXT,
  form_data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS status_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  note TEXT,
  FOREIGN KEY(customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS email_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  subject TEXT NOT NULL,
  html_body TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pricing_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  config_key TEXT UNIQUE NOT NULL,
  config_json TEXT NOT NULL,
  source_file TEXT,
  updated_at TEXT NOT NULL
);
`);

// Meglévő customers táblához hiányzó oszlopok pótlása (ha korábbi verzióból frissítünk)
const customerCols = db.prepare("PRAGMA table_info(customers)").all().map(c => c.name);
function addColIfMissing(name, def){
  if(!customerCols.includes(name)) db.exec(`ALTER TABLE customers ADD COLUMN ${name} ${def}`);
}
addColIfMissing('colleague_token', 'TEXT');
addColIfMissing('colleague_approved', 'INTEGER DEFAULT 0');
addColIfMissing('modify_request_text', 'TEXT');
addColIfMissing('modify_request_at', 'TEXT');
addColIfMissing('vat_requested', 'INTEGER DEFAULT 0');
addColIfMissing('reject_reason', 'TEXT');
addColIfMissing('reject_at', 'TEXT');
addColIfMissing('offer_sent_at', 'TEXT');
addColIfMissing('reminder_sent_at', 'TEXT');
addColIfMissing('garage_type_used', 'TEXT');
addColIfMissing('customer_edited_at', 'TEXT');
addColIfMissing('pre_edit_form_data', 'TEXT');
addColIfMissing('status_alert_at', 'TEXT');
addColIfMissing('status_alert_note', 'TEXT');
addColIfMissing('customer_edit_note', 'TEXT'); // az ügyfél opcionális megjegyzése, amikor módosít az ajánlaton
addColIfMissing('recalculated_price_huf', 'INTEGER'); // ha az ár kézzel be volt állítva, ide kerül, mennyi lenne a képlet szerint az ügyfél módosítása után (nem írja felül a tényleges árat)
addColIfMissing('consent_accepted_at', 'TEXT'); // mikor fogadta el az ügyfél az adatkezelési tájékoztatót (beküldéskor)
addColIfMissing('consent_version', 'TEXT');     // a tájékoztató melyik verzióját fogadta el (lásd src/services/consent.js)
addColIfMissing('anonymized_at', 'TEXT');       // mikor lett a rekord automatikusan anonimizálva a megőrzési idő lejártával (lásd src/services/dataRetention.js)
addColIfMissing('delivery_date', 'TEXT');             // kiszállítási lista: hozzárendelt dátum (YYYY-MM-DD)
addColIfMissing('delivery_time', 'TEXT');             // kiszállítási lista: hozzávetőleges időpont (szabad szöveg, pl. "10:00" vagy "délelőtt")
addColIfMissing('delivery_remaining_amount', 'INTEGER'); // kiszállítási lista: a helyszínen fizetendő fennmaradó összeg (Ft)
addColIfMissing('delivery_notice_sent_at', 'TEXT');   // mikor küldtük ki az ügyfélnek a kiszállítási értesítőt
addColIfMissing('delivery_address', 'TEXT');    // kiszállítási cím felülírása (ha üres, az eredeti address/zip/city az irányadó) — ezt módosíthatja az admin anélkül, hogy a megrendelés eredeti adatait átírná
addColIfMissing('delivery_lat', 'REAL');         // pontos helyszín (Google Maps pin) szélesség — ha meg van adva, ez élvez elsőbbséget a cím-alapú kereséssel szemben
addColIfMissing('delivery_lng', 'REAL');         // pontos helyszín (Google Maps pin) hosszúság
addColIfMissing('delivery_arrival_time', 'TEXT'); // ÜRES ELŐKÉSZÍTÉS a jövőbeli funkcióhoz: a telepítő kolléga által helyszínről/útközben megadható pontos érkezési időpont
                                                   // (a jelenlegi delivery_time az admin által ELŐRE megadott hozzávetőleges időpont — ez itt majd a
                                                   // valós idejű finomítás lesz, amit a kolléga ad meg, és amiről az ügyfél email/SMS értesítést kap)
addColIfMissing('delivery_customer_edited_at', 'TEXT'); // mikor módosította az ÜGYFÉL saját maga a kiszállítási címet/helyszínt (a delivery-location oldalon) — az admin
                                                         // felületen ez egy jelzést/értesítést jelenít meg, amíg az admin nyugtázza (törli ezt az időbélyeget)
addColIfMissing('delivery_completed_at', 'TEXT');       // a sofőr által a driver-oldalon bepipálva: "kész vagyok ezzel az ügyféllel" — csak megjelenítési/rendezési
                                                         // célra (a kártya máshogy jelenik meg, a lista aljára kerül), a megrendelés státuszát nem érinti
addColIfMissing('delivery_sequence', 'INTEGER');        // a szállítási sorrend (adott napon belül) — admin állítja be, ez alapján rendeződik mind az admin
                                                         // kiszállítási lista, mind a sofőr-nézet; ha nincs megadva, időpont szerint esik a lista végére
addColIfMissing('installation_duration_min', 'INTEGER'); // a logisztikus által megadott becsült telepítési időtartam (perc) — az automatikus útvonalterv
                                                          // ehhez adja hozzá az odautazás idejét, alapértelmezetten 90 perc, ha nincs megadva
addColIfMissing('logistics_plan_day', 'INTEGER');        // az utoljára legenerált útvonaltervben hányadik napra (1 vagy 2) került ez a megrendelés
addColIfMissing('logistics_plan_order', 'INTEGER');      // az utoljára legenerált útvonaltervben hányadik megálló volt az adott napon belül
addColIfMissing('logistics_plan_eta', 'TEXT');           // az utoljára legenerált útvonaltervben számított becsült érkezési időpont (szöveg, "HH:MM")

// Az email_templates táblához: nyomon követjük, hogy a kódban definiált alapértelmezés melyik
// verzióját szinkronizáltuk utoljára az adott sablonhoz — így ha az admin NEM módosította kézzel
// a sablont, egy kódbeli szöveg-frissítés automatikusan érvényesülhet nála is; ha viszont
// módosította, a saját szövege sosem íródik felül (lásd emailTemplates.js ensureDefaultTemplates).
const templateCols = db.prepare("PRAGMA table_info(email_templates)").all().map(c => c.name);
function addTemplateColIfMissing(name, def) {
  if (!templateCols.includes(name)) db.exec(`ALTER TABLE email_templates ADD COLUMN ${name} ${def}`);
}
addTemplateColIfMissing('default_subject', 'TEXT');
addTemplateColIfMissing('default_html_body', 'TEXT');

module.exports = db;
