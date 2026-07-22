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
      margin: { top: '0mm', bottom: '14mm', left: '0mm', right: '0mm' },
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
 * Megrendelőlap HTML sablon — mutatós, márkázott elrendezéssel. lang: 'hu' vagy 'pl'
 */
function orderFormHtml(customer, quote, lang) {
  const t = lang === 'pl' ? TEXT_PL : TEXT_HU;
  const fd = JSON.parse(customer.form_data || '{}');
  const priceHuf = quote ? quote.displayTotal : null;
  const priceLabel = quote ? quote.displayLabel : '';

  return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="UTF-8"><style>
  @page { margin: 0; }
  *{box-sizing:border-box;}
  body{font-family:'Helvetica Neue',Arial,sans-serif;color:#20242A;font-size:12px;margin:0;}
  .header{background:#20242A;color:#fff;padding:26px 32px;display:flex;justify-content:space-between;align-items:center;border-bottom:5px solid #F2B705;}
  .header h1{margin:0;font-size:22px;letter-spacing:0.02em;text-transform:uppercase;}
  .header .sub{font-size:11px;color:#c7d0d6;margin-top:4px;letter-spacing:0.04em;text-transform:uppercase;}
  .content{padding:26px 32px;}
  .section{margin-bottom:22px;}
  .section h2{font-size:13px;text-transform:uppercase;letter-spacing:0.04em;color:#454C54;border-bottom:2px solid #F2B705;padding-bottom:6px;margin-bottom:10px;}
  table{width:100%;border-collapse:collapse;}
  td{padding:5px 4px;vertical-align:top;font-size:12px;}
  td.label{color:#7a828a;width:38%;font-size:11px;text-transform:uppercase;letter-spacing:0.02em;}
  .summary-box{white-space:pre-wrap;font-family:'Courier New',monospace;font-size:10.5px;background:#fafbfb;border:1px solid #e6e8ea;border-radius:6px;padding:14px;line-height:1.5;}
  .sketch{border:1px solid #e6e8ea;border-radius:6px;padding:14px;text-align:center;background:#161A1E;}
  .price-card{background:linear-gradient(135deg,#20242A,#2c333b);color:#fff;border-radius:8px;padding:22px 26px;text-align:center;margin-top:8px;}
  .price-card .amount{font-size:30px;font-weight:700;letter-spacing:0.01em;}
  .price-card .label{font-size:11px;color:#F2B705;text-transform:uppercase;letter-spacing:0.06em;margin-top:4px;}
  .footer{padding:16px 32px;font-size:9.5px;color:#9aa2a8;border-top:1px solid #eee;display:flex;justify-content:space-between;}
</style></head>
<body>
  <div class="header">
    <div>
      <h1>${t.title}</h1>
      <div class="sub">Pol-Bram — F.P.H.U Pol Bram</div>
    </div>
    <div class="sub" style="text-align:right">${t.generatedOn}<br>${new Date().toLocaleDateString(lang === 'pl' ? 'pl-PL' : 'hu-HU')}</div>
  </div>

  <div class="content">
    <div class="section">
      <h2>${t.customerData}</h2>
      <table>
        <tr><td class="label">${t.name}</td><td>${escapeHtml(customer.name)}</td></tr>
        <tr><td class="label">${t.phone}</td><td>${escapeHtml(customer.phone)}</td></tr>
        <tr><td class="label">${t.email}</td><td>${escapeHtml(customer.email)}</td></tr>
        <tr><td class="label">${t.address}</td><td>${escapeHtml(customer.zip)} ${escapeHtml(customer.city)}, ${escapeHtml(customer.address)}</td></tr>
      </table>
    </div>

    <div class="section">
      <h2>${t.garageData}</h2>
      <table>
        <tr><td class="label">${t.size}</td><td>${escapeHtml(fd.width)} × ${escapeHtml(fd.length)} cm, ${t.height}: ${escapeHtml(fd.height)}</td></tr>
        <tr><td class="label">${t.roof}</td><td>${escapeHtml(fd.roofType)}</td></tr>
      </table>
      <div class="summary-box">${escapeHtml(customer.summary_text || '')}</div>
    </div>

    ${customer.sketch_svg ? `<div class="section"><h2>${t.sketch}</h2><div class="sketch">${customer.sketch_svg}</div></div>` : ''}

    <div class="section">
      <h2>${t.price}</h2>
      <div class="price-card">
        <div class="amount">${priceHuf != null ? priceHuf.toLocaleString('hu-HU') + ' Ft' : '—'}</div>
        <div class="label">${priceLabel || ''}</div>
      </div>
    </div>
  </div>

  <div class="footer">
    <span>Pol-Bram</span>
    <span>${t.title}</span>
  </div>
</body>
</html>`;
}

const TEXT_HU = {
  title: 'Megrendelőlap', customerData: 'Ügyfél adatai', name: 'Név', phone: 'Telefon', email: 'E-mail',
  address: 'Cím', garageData: 'Garázs adatai', size: 'Méret', height: 'oldalmagasság', roof: 'Tetőtípus',
  sketch: 'Felülnézeti vázlat', price: 'Ár', generatedOn: 'Létrehozva',
};
const TEXT_PL = {
  title: 'Karta zamówienia', customerData: 'Dane klienta', name: 'Imię i nazwisko', phone: 'Telefon', email: 'E-mail',
  address: 'Adres', garageData: 'Dane garażu', size: 'Wymiary', height: 'wysokość ściany', roof: 'Typ dachu',
  sketch: 'Szkic z góry', price: 'Cena', generatedOn: 'Wygenerowano',
};

async function generateOrderFormPdf(customer, quote, lang) {
  const html = orderFormHtml(customer, quote, lang);
  return renderHtmlToPdf(html);
}

module.exports = { generateOrderFormPdf };
