const db = require('../../db');

const DEFAULT_TEMPLATES = [
  {
    key: 'inquiry_received',
    label: 'Igény beérkezett (automatikus visszaigazolás)',
    subject: 'Megkaptuk az árajánlat-igényét – Pol-Bram',
    html_body: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
  <h2 style="color:#20242A">Köszönjük megkeresését!</h2>
  <p>Kedves {{name}}!</p>
  <p>Megkaptuk a garázs árajánlat-igényét. Munkatársunk hamarosan, személyre szabott
  árajánlattal jelentkezik ezen az e-mail címen.</p>
  <p style="background:#fff7e0;border:1px solid #f2b705;padding:10px 14px;border-radius:4px">
  <strong>Fontos:</strong> kérjük, időnként nézze meg a <strong>Spam / Levélszemét</strong> mappáját is,
  előfordulhat, hogy a válaszunk oda kerül.</p>
  <p>Üdvözlettel,<br>Pol-Bram csapata</p>
</div>`,
  },
  {
    key: 'offer',
    label: 'Árajánlat kiküldése az ügyfélnek',
    subject: 'Egyedi árajánlata elkészült – Pol-Bram',
    html_body: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto">
  <div style="background:#20242A;padding:20px 26px;border-bottom:4px solid #F2B705">
    <h1 style="color:#fff;margin:0;font-size:18px;text-transform:uppercase;letter-spacing:0.02em">Árajánlat</h1>
  </div>
  <div style="padding:20px 26px">
    <p>Kedves {{name}}!</p>
    <p>Az Ön által kért garázs egyedi árajánlata alább található.</p>

    {{sketchHtml}}

    {{detailsHtml}}

    <div style="background:linear-gradient(135deg,#20242A,#2c333b);color:#fff;border-radius:8px;padding:18px 22px;text-align:center;margin:18px 0">
      <div style="font-size:26px;font-weight:700">{{price}}</div>
    </div>

    <p style="text-align:center;margin:26px 0">
      <a href="{{acceptUrl}}" style="background:#2F6B4F;color:#fff;text-decoration:none;padding:13px 22px;border-radius:4px;font-weight:bold;display:inline-block;margin:4px">Ajánlat elfogadása</a>
      <a href="{{modifyUrl}}" style="background:#454C54;color:#fff;text-decoration:none;padding:13px 22px;border-radius:4px;font-weight:bold;display:inline-block;margin:4px">Módosítást szeretnék</a>
      <a href="{{rejectUrl}}" style="background:#b23a3a;color:#fff;text-decoration:none;padding:13px 22px;border-radius:4px;font-weight:bold;display:inline-block;margin:4px">Elutasítom</a>
    </p>

    <p style="font-size:0.85em;color:#7a828a">Ha kérdése van az ajánlattal kapcsolatban, egyszerűen válaszoljon erre az e-mailre.</p>
    <p>Üdvözlettel,<br>Pol-Bram csapata</p>
  </div>
</div>`,
  },
  {
    key: 'order_form_colleague',
    label: 'Megrendelőlap a kolléganőnek (lengyel, jóváhagyásra)',
    subject: 'Nowe zamówienie do weryfikacji – {{name}}',
    html_body: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
  <h2>Nowe zamówienie do weryfikacji</h2>
  <p>Klient: {{name}}</p>
  <p>Proszę kliknąć poniższy link, aby sprawdzić i w razie potrzeby poprawić dane zamówienia (cena, specyfikacja).
  Po zatwierdzeniu karta zamówienia zostanie automatycznie wysłana do klienta.</p>
  <p style="text-align:center;margin:28px 0">
    <a href="{{colleagueUrl}}" style="background:#F2B705;color:#20242A;text-decoration:none;padding:14px 28px;border-radius:4px;font-weight:bold;display:inline-block">
      Otwórz zamówienie
    </a>
  </p>
</div>`,
  },
  {
    key: 'order_form_customer',
    label: 'Végleges megrendelőlap az ügyfélnek (magyar, PDF melléklettel)',
    subject: 'Megrendelőlapja – Pol-Bram',
    html_body: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
  <h2 style="color:#20242A">Köszönjük megrendelését!</h2>
  <p>Kedves {{name}}!</p>
  <p>Mellékletben csatolva küldjük a megrendelőlapját. Hamarosan küldjük az előlegszámlát is.</p>
  <p style="text-align:center;margin:28px 0">
    <a href="{{approveUrl}}" style="background:#2F6B4F;color:#fff;text-decoration:none;padding:12px 22px;border-radius:4px;font-weight:bold;display:inline-block;margin-right:8px">
      Megrendelőlap elfogadása
    </a>
    <a href="{{modifyUrl}}" style="background:#454C54;color:#fff;text-decoration:none;padding:12px 22px;border-radius:4px;font-weight:bold;display:inline-block">
      Módosítást szeretnék
    </a>
  </p>
  <p>Üdvözlettel,<br>Pol-Bram csapata</p>
</div>`,
  },
  {
    key: 'invoice',
    label: 'Előlegszámla kiküldése',
    subject: 'Előlegszámla – Pol-Bram',
    html_body: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
  <h2 style="color:#20242A">Előlegszámla</h2>
  <p>Kedves {{name}}!</p>
  <p>Mellékletben küldjük az előlegszámlát a garázs megrendeléséhez.</p>
  <p>Üdvözlettel,<br>Pol-Bram csapata</p>
</div>`,
  },
  {
    key: 'installed',
    label: 'Telepítve értesítés (elégedettség + reklamáció linkkel)',
    subject: 'Garázs telepítve – Pol-Bram',
    html_body: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
  <h2 style="color:#20242A">Köszönjük megrendelését!</h2>
  <p>Kedves {{name}}!</p>
  <p>Garázsa telepítése megtörtént. Reméljük, elégedett az eredménnyel!</p>
  <p style="text-align:center;margin:24px 0">
    <a href="{{satisfactionUrl}}" style="background:#2F6B4F;color:#fff;text-decoration:none;padding:12px 22px;border-radius:4px;font-weight:bold;display:inline-block;margin-right:8px">
      Elégedettség értékelése
    </a>
    <a href="{{complaintUrl}}" style="background:#b23a3a;color:#fff;text-decoration:none;padding:12px 22px;border-radius:4px;font-weight:bold;display:inline-block">
      Reklamáció beküldése
    </a>
  </p>
  <p>Üdvözlettel,<br>Pol-Bram csapata</p>
</div>`,
  },
];

function ensureDefaultTemplates(){
  const now = new Date().toISOString();
  DEFAULT_TEMPLATES.forEach(t=>{
    const existing = db.prepare('SELECT id FROM email_templates WHERE key = ?').get(t.key);
    if(!existing){
      db.prepare('INSERT INTO email_templates (key, label, subject, html_body, updated_at) VALUES (?,?,?,?,?)')
        .run(t.key, t.label, t.subject, t.html_body, now);
    }
  });
}
ensureDefaultTemplates();

function getTemplate(key){
  const t = db.prepare('SELECT * FROM email_templates WHERE key = ?').get(key);
  if(!t) throw new Error('Nincs ilyen email sablon: '+key);
  return t;
}

function render(str, vars){
  return str.replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
}

function renderTemplate(key, vars){
  const t = getTemplate(key);
  return { subject: render(t.subject, vars), html: render(t.html_body, vars) };
}

module.exports = { ensureDefaultTemplates, getTemplate, renderTemplate, DEFAULT_TEMPLATES };
