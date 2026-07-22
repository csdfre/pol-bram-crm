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
`);

module.exports = db;
