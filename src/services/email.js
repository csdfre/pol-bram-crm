const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

async function sendMail({ to, subject, html, attachments }) {
  return transporter.sendMail({
    from: `"Pol-Bram" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    html,
    attachments: attachments || [],
  });
}

// ---------------------------------------------------------------
// 1. Automatikus visszaigazolás, amikor beérkezik az igény
// ---------------------------------------------------------------
async function sendInquiryReceived(customer) {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
      <h2 style="color:#20242A">Köszönjük megkeresését!</h2>
      <p>Kedves ${escapeHtml(customer.name || '')}!</p>
      <p>Megkaptuk a garázs árajánlat-igényét. Munkatársunk hamarosan, személyre szabott
      árajánlattal jelentkezik ezen az e-mail címen.</p>
      <p style="background:#fff7e0;border:1px solid #f2b705;padding:10px 14px;border-radius:4px">
      <strong>Fontos:</strong> kérjük, időnként nézze meg a <strong>Spam / Levélszemét</strong> mappáját is,
      előfordulhat, hogy a válaszunk oda kerül.</p>
      <p>Üdvözlettel,<br>Pol-Bram csapata</p>
    </div>`;
  return sendMail({ to: customer.email, subject: 'Megkaptuk az árajánlat-igényét – Pol-Bram', html });
}

// ---------------------------------------------------------------
// 2. Árajánlat kiküldése az ügyfélnek (elfogadás gombbal)
// ---------------------------------------------------------------
async function sendOffer(customer, quote) {
  const acceptUrl = `${process.env.BASE_URL}/public/accept-offer/${customer.accept_token}`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
      <h2 style="color:#20242A">Egyedi árajánlata elkészült</h2>
      <p>Kedves ${escapeHtml(customer.name || '')}!</p>
      <p>Az Ön által kért garázs végleges, egyedi árajánlata:</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        ${quote.lines.map(l => `<tr><td style="padding:4px 0;color:#454C54">${escapeHtml(l.label)}</td><td style="padding:4px 0;text-align:right">${l.huf.toLocaleString('hu-HU')} Ft</td></tr>`).join('')}
        <tr style="border-top:2px solid #20242A;font-weight:bold;font-size:1.15em">
          <td style="padding:10px 0">Összesen</td><td style="padding:10px 0;text-align:right">${quote.totalHUF.toLocaleString('hu-HU')} Ft</td>
        </tr>
      </table>
      <p style="text-align:center;margin:28px 0">
        <a href="${acceptUrl}" style="background:#F2B705;color:#20242A;text-decoration:none;padding:14px 28px;border-radius:4px;font-weight:bold;display:inline-block">
          Ajánlat elfogadása
        </a>
      </p>
      <p style="font-size:0.85em;color:#7a828a">Ha kérdése van az ajánlattal kapcsolatban, egyszerűen válaszoljon erre az e-mailre.</p>
      <p>Üdvözlettel,<br>Pol-Bram csapata</p>
    </div>`;
  return sendMail({ to: customer.email, subject: 'Egyedi árajánlata elkészült – Pol-Bram', html });
}

// ---------------------------------------------------------------
// 3. Megrendelőlap kiküldése a lengyel kolléganőnek (jóváhagyásra)
// ---------------------------------------------------------------
async function sendOrderFormToColleague(customer, pdfPlBuffer) {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
      <h2>Nowe zamówienie do weryfikacji</h2>
      <p>Klient: ${escapeHtml(customer.name || '')}</p>
      <p>W załączniku znajduje się karta zamówienia (PL). Prosimy o sprawdzenie i, jeśli to konieczne,
      naniesienie poprawek przed ostatecznym zatwierdzeniem.</p>
    </div>`;
  return sendMail({
    to: process.env.COLLEAGUE_EMAIL,
    subject: `Nowe zamówienie – ${customer.name || 'klient'}`,
    html,
    attachments: [{ filename: `zamowienie_${customer.id}.pdf`, content: pdfPlBuffer }],
  });
}

// ---------------------------------------------------------------
// 4. Végleges megrendelőlap kiküldése az ügyfélnek (magyarul, PDF-ben)
// ---------------------------------------------------------------
async function sendFinalOrderFormToCustomer(customer, pdfHuBuffer) {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
      <h2 style="color:#20242A">Köszönjük megrendelését!</h2>
      <p>Kedves ${escapeHtml(customer.name || '')}!</p>
      <p>Mellékletben csatolva küldjük a megrendelőlapját. Hamarosan küldjük az előlegszámlát is.</p>
      <p>Üdvözlettel,<br>Pol-Bram csapata</p>
    </div>`;
  return sendMail({
    to: customer.email,
    subject: 'Megrendelőlap – Pol-Bram',
    html,
    attachments: [{ filename: `megrendelolap_${customer.name || customer.id}.pdf`, content: pdfHuBuffer }],
  });
}

// ---------------------------------------------------------------
// 5. Előlegszámla kiküldése
// ---------------------------------------------------------------
async function sendAdvanceInvoice(customer, invoiceBuffer, invoiceFilename) {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
      <h2 style="color:#20242A">Előlegszámla</h2>
      <p>Kedves ${escapeHtml(customer.name || '')}!</p>
      <p>Mellékletben küldjük az előlegszámlát a garázs megrendeléséhez.</p>
      <p>Üdvözlettel,<br>Pol-Bram csapata</p>
    </div>`;
  return sendMail({
    to: customer.email,
    subject: 'Előlegszámla – Pol-Bram',
    html,
    attachments: [{ filename: invoiceFilename || `elolegszamla_${customer.id}.pdf`, content: invoiceBuffer }],
  });
}

// ---------------------------------------------------------------
// 6. Telepítés visszaigazolása, elégedettség-link + reklamáció gomb
// ---------------------------------------------------------------
async function sendInstalledNotice(customer) {
  const satisfactionUrl = `${process.env.BASE_URL}/public/satisfaction/${customer.satisfaction_token}`;
  const complaintUrl = `${process.env.BASE_URL}/public/complaint/${customer.complaint_token}`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
      <h2 style="color:#20242A">Köszönjük megrendelését!</h2>
      <p>Kedves ${escapeHtml(customer.name || '')}!</p>
      <p>Garázsa telepítése megtörtént. Reméljük, elégedett az eredménnyel!</p>
      <p style="text-align:center;margin:24px 0">
        <a href="${satisfactionUrl}" style="background:#2F6B4F;color:#fff;text-decoration:none;padding:12px 22px;border-radius:4px;font-weight:bold;display:inline-block;margin-right:8px">
          Elégedettség értékelése
        </a>
        <a href="${complaintUrl}" style="background:#b23a3a;color:#fff;text-decoration:none;padding:12px 22px;border-radius:4px;font-weight:bold;display:inline-block">
          Reklamáció beküldése
        </a>
      </p>
      <p>Üdvözlettel,<br>Pol-Bram csapata</p>
    </div>`;
  return sendMail({ to: customer.email, subject: 'Garázs telepítve – Pol-Bram', html });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = {
  sendInquiryReceived,
  sendOffer,
  sendOrderFormToColleague,
  sendFinalOrderFormToCustomer,
  sendAdvanceInvoice,
  sendInstalledNotice,
};
