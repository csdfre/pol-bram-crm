const puppeteer = require('puppeteer');

let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browserPromise;
}

async function renderHtmlToPdf(html) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const buffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
    });
    return buffer;
  } finally {
    await page.close();
  }
}

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Megrendelőlap HTML sablon. lang: 'hu' vagy 'pl'
 */
function orderFormHtml(customer, quote, lang) {
  const t = lang === 'pl' ? TEXT_PL : TEXT_HU;
  const fd = JSON.parse(customer.form_data || '{}');

  return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="UTF-8"><style>
  body{font-family:'Helvetica Neue',Arial,sans-serif;color:#20242A;font-size:12px;}
  h1{font-size:20px;border-bottom:3px solid #F2B705;padding-bottom:8px;}
  h2{font-size:14px;margin-top:22px;border-bottom:1px solid #ccc;padding-bottom:4px;}
  table{width:100%;border-collapse:collapse;margin-top:6px;}
  td{padding:3px 4px;vertical-align:top;}
  td.label{color:#454C54;width:45%;}
  .sketch{margin-top:14px;border:1px solid #ccc;padding:8px;text-align:center;}
  .total{font-size:16px;font-weight:bold;border-top:2px solid #20242A;padding-top:8px;margin-top:10px;}
  .footer{margin-top:30px;font-size:10px;color:#7a828a;}
</style></head>
<body>
  <h1>${t.title} — ${escapeHtml(customer.name)}</h1>

  <h2>${t.customerData}</h2>
  <table>
    <tr><td class="label">${t.name}</td><td>${escapeHtml(customer.name)}</td></tr>
    <tr><td class="label">${t.phone}</td><td>${escapeHtml(customer.phone)}</td></tr>
    <tr><td class="label">${t.email}</td><td>${escapeHtml(customer.email)}</td></tr>
    <tr><td class="label">${t.address}</td><td>${escapeHtml(customer.zip)} ${escapeHtml(customer.city)}, ${escapeHtml(customer.address)}</td></tr>
  </table>

  <h2>${t.garageData}</h2>
  <table>
    <tr><td class="label">${t.size}</td><td>${escapeHtml(fd.width)} × ${escapeHtml(fd.length)} cm, ${t.height}: ${escapeHtml(fd.height)}</td></tr>
    <tr><td class="label">${t.roof}</td><td>${escapeHtml(fd.roofType)}</td></tr>
  </table>
  <pre style="white-space:pre-wrap;font-family:inherit;font-size:11px;background:#fafbfb;border:1px solid #eee;padding:8px;margin-top:8px">${escapeHtml(customer.summary_text || '')}</pre>

  ${customer.sketch_svg ? `<div class="sketch"><div style="font-size:11px;color:#7a828a;margin-bottom:6px">${t.sketch}</div>${customer.sketch_svg}</div>` : ''}

  <h2>${t.price}</h2>
  <table>
    ${quote ? quote.lines.map(l => `<tr><td class="label">${escapeHtml(l.label)}</td><td style="text-align:right">${l.huf.toLocaleString('hu-HU')} Ft</td></tr>`).join('') : ''}
  </table>
  <div class="total">${t.total}: ${quote ? quote.totalHUF.toLocaleString('hu-HU') : '—'} Ft</div>

  <div class="footer">Pol-Bram — ${t.generatedOn} ${new Date().toLocaleDateString(lang === 'pl' ? 'pl-PL' : 'hu-HU')}</div>
</body>
</html>`;
}

const TEXT_HU = {
  title: 'Megrendelőlap', customerData: 'Ügyfél adatai', name: 'Név', phone: 'Telefon', email: 'E-mail',
  address: 'Cím', garageData: 'Garázs adatai', size: 'Méret', height: 'oldalmagasság', roof: 'Tetőtípus',
  sketch: 'Felülnézeti vázlat', price: 'Ár', total: 'Végösszeg', generatedOn: 'Létrehozva:',
};
const TEXT_PL = {
  title: 'Karta zamówienia', customerData: 'Dane klienta', name: 'Imię i nazwisko', phone: 'Telefon', email: 'E-mail',
  address: 'Adres', garageData: 'Dane garażu', size: 'Wymiary', height: 'wysokość ściany', roof: 'Typ dachu',
  sketch: 'Szkic z góry', price: 'Cena', total: 'Suma', generatedOn: 'Wygenerowano:',
};

async function generateOrderFormPdf(customer, quote, lang) {
  const html = orderFormHtml(customer, quote, lang);
  return renderHtmlToPdf(html);
}

module.exports = { generateOrderFormPdf };
