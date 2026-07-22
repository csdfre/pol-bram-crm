require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../db');

const username = process.env.INIT_ADMIN_USERNAME || 'admin';
const password = process.env.INIT_ADMIN_PASSWORD;

if (!password) {
  console.error('Hiányzik az INIT_ADMIN_PASSWORD a .env fájlból!');
  process.exit(1);
}

const existing = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
const hash = bcrypt.hashSync(password, 10);

if (existing) {
  db.prepare('UPDATE admin_users SET password_hash = ? WHERE username = ?').run(hash, username);
  console.log(`Frissítve: "${username}" jelszava megváltoztatva.`);
} else {
  db.prepare('INSERT INTO admin_users (username, password_hash, created_at) VALUES (?, ?, ?)')
    .run(username, hash, new Date().toISOString());
  console.log(`Létrehozva: admin felhasználó "${username}" néven.`);
}
