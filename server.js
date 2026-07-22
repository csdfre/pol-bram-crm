require('dotenv').config();
const express = require('express');
const cookieSession = require('cookie-session');
const path = require('path');

require('./db'); // inicializálja az adatbázist / táblákat

const app = express();

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(cookieSession({
  name: 'session',
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  maxAge: 12 * 60 * 60 * 1000, // 12 óra
}));

// Statikus fájlok: feltöltött PDF-ek/képek + a backoffice frontend + az ügyfél-oldali igénylő form
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/admin', express.static(path.join(__dirname, 'public', 'admin')));
app.use(express.static(path.join(__dirname, 'public', 'site'))); // pl. polbram.hu gyökerén a garázs-igénylő form

// API route-ok
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/admin', require('./src/routes/admin'));
app.use('/api/admin/garage-types', require('./src/routes/garageTypes'));
app.use('/public', require('./src/routes/public'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Pol-Bram Garage CRM fut: http://localhost:${PORT}`);
  console.log(`Backoffice: http://localhost:${PORT}/admin`);
});
