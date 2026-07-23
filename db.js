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

module.exports = db;
