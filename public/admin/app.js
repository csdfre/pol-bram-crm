const STATUS_LABELS = {
  ajanlatra_var: 'Ajánlatra vár',
  ajanlat_kikuldve: 'Ajánlat kiküldve',
  ajanlat_elfogadva: 'Ajánlat elfogadva',
  elutasitva: 'Elutasítva',
  megrendelolap_kikuldve: 'Megrendelőlap kiküldve',
  megrendelolap_elfogadva: 'Megrendelőlap elfogadva',
  elolegszamla_kikuldve: 'Előlegszámla kiküldve',
  telepitve: 'Telepítve',
  garancialis_problema: 'Garanciális probléma',
};

async function api(path, opts) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...opts,
  });
  if (res.status === 401) { showLogin(); throw new Error('Nincs bejelentkezve'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Hiba történt');
  return data;
}

function showLogin() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('appScreen').style.display = 'none';
}
function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = 'block';
  loadCustomers();
}

document.getElementById('loginBtn').addEventListener('click', async () => {
  const username = document.getElementById('loginUser').value;
  const password = document.getElementById('loginPass').value;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Hiba történt a bejelentkezés közben.');
    document.getElementById('whoami').textContent = data.username;
    showApp();
  } catch (e) {
    errEl.textContent = e.message;
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' });
  showLogin();
});

async function checkSession() {
  const data = await fetch('/api/auth/me').then(r => r.json());
  if (data.loggedIn) {
    document.getElementById('whoami').textContent = data.username;
    showApp();
  } else {
    showLogin();
  }
}

async function loadCustomers() {
  const rows = await api('/admin/customers');
  const tbody = document.getElementById('customerTableBody');
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${esc(r.name)}</td>
      <td>${esc(r.zip)} ${esc(r.city)}, ${esc(r.address)}</td>
      <td>${esc(r.phone)}</td>
      <td>${esc(r.email)}</td>
      <td>${new Date(r.created_at).toLocaleString('hu-HU')}</td>
      <td><span class="status-pill status-${r.status}">${STATUS_LABELS[r.status] || r.status}</span></td>
      <td><button class="link-btn" onclick="openDetail(${r.id})">Megnyitás</button></td>
    </tr>
  `).join('');
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

let currentCustomer = null;

async function openDetail(id) {
  currentCustomer = await api('/admin/customers/' + id);
  renderModal();
  document.getElementById('detailModal').style.display = 'flex';
}
document.getElementById('closeModalBtn').addEventListener('click', () => {
  document.getElementById('detailModal').style.display = 'none';
  loadCustomers();
});

function renderModal() {
  const c = currentCustomer;
  const quote = c.price_breakdown;
  const html = `
    <h2 style="font-family:'Oswald',sans-serif;text-transform:uppercase;margin-bottom:4px">${esc(c.name) || 'Névtelen ügyfél'}</h2>
    <div class="status-pill status-${c.status}">${STATUS_LABELS[c.status] || c.status}</div>

    <div class="field-row" style="margin-top:16px">
      <div><label>Név</label><input id="f_name" value="${esc(c.name)}"></div>
      <div><label>Telefon</label><input id="f_phone" value="${esc(c.phone)}"></div>
      <div><label>E-mail</label><input id="f_email" value="${esc(c.email)}"></div>
      <div><label>Irányítószám</label><input id="f_zip" value="${esc(c.zip)}"></div>
      <div><label>Város</label><input id="f_city" value="${esc(c.city)}"></div>
      <div><label>Cím</label><input id="f_address" value="${esc(c.address)}"></div>
    </div>
    ${c.form_data && c.form_data.truckParkingDistance ? `<p style="background:#fff7e0;border:1px solid #f2b705;padding:8px 12px;border-radius:4px;font-size:0.85rem"><strong>Teherautó-parkolás a telepítés helyszínén:</strong> ${esc(c.form_data.truckParkingDistance)}</p>` : ''}
    <label>Összefoglaló / garázs adatai (szabadon szerkeszthető)</label>
    <textarea id="f_summary" style="width:100%;min-height:160px;font-family:'IBM Plex Mono',monospace;font-size:0.78rem;padding:8px;border:1px solid var(--line);border-radius:4px">${esc(c.summary_text)}</textarea>

    ${c.sketch_svg ? `<div class="sketch-box">${c.sketch_svg}</div>` : ''}

    <div class="btn-row">
      <button class="btn-secondary" onclick="saveCustomer()">Mentés</button>
    </div>

    <hr>
    <h3>Árszámítás</h3>
    <div class="btn-row">
      <button class="btn-main" onclick="calculateQuote()">Ár kiszámítása</button>
      <button class="btn-secondary" onclick="editOrderData()">Adatok szerkesztése (mint a kolléganőnek)</button>
    </div>
    <div id="quoteBox">
      ${quote ? renderQuoteTable(quote) : '<p style="color:#7a828a;font-size:0.85rem">Még nincs kiszámolva.</p>'}
    </div>

    <div style="margin-top:12px;padding:12px;border:1px dashed var(--line);border-radius:6px">
      <label style="display:block;font-size:0.78rem;color:var(--graphite-soft);margin-bottom:6px">
        Ha ennél a konkrét megrendelésnél rosszul számol valamit a séma, itt is feltöltheted a helyes kalkulátor Excel-t —
        ez a teljes árazást (mindenkinél) frissíti, és ennek a megrendelésnek az árát is azonnal újraszámolja.
      </label>
      <input type="file" id="orderPricingExcelFile" accept=".xlsx,.xlsm,.xls">
      <button class="btn-secondary" onclick="uploadOrderPricingExcel()">Feltöltés és elemzés</button>
      <div id="orderPricingPreview"></div>
    </div>

    <hr>
    <h3>Folyamat</h3>
    <div class="btn-row">
      <button class="btn-main" onclick="sendOffer()">Ajánlat kiküldése</button>
      <button class="btn-secondary" onclick="sendReminder()">Emlékeztető küldése</button>
      <button class="btn-secondary" onclick="sendOrderFormColleague()">Link küldése a kolléganőnek (jóváhagyásra)</button>
      <button class="btn-secondary" onclick="sendOrderFormCustomer()">Megrendelőlap kézi (újra)küldése ügyfélnek</button>
    </div>
    ${c.reminder_sent_at ? `<p style="font-size:0.8rem;color:#7a828a">Emlékeztető kiküldve: ${new Date(c.reminder_sent_at).toLocaleString('hu-HU')}</p>` : ''}

    <div class="field-row" style="margin-top:10px">
      <div>
        <label>Előlegszámla PDF feltöltése</label>
        <input type="file" id="invoiceFile" accept="application/pdf">
        <button class="btn-secondary" style="margin-top:6px" onclick="uploadInvoice()">Feltöltés</button>
        ${c.invoice_file ? `<div style="font-size:0.78rem;margin-top:4px">Feltöltve: <a href="${c.invoice_file}" target="_blank">${c.invoice_file.split('/').pop()}</a></div>` : ''}
      </div>
      <div style="align-self:end">
        <button class="btn-main" onclick="sendInvoice()">Előlegszámla kiküldése</button>
      </div>
    </div>

    <div class="btn-row">
      <button class="btn-main" onclick="markInstalled()">Garázs telepítve</button>
      <select class="status-select" id="manualStatus" onchange="setStatusManually()">
        <option value="">— Kézi státuszváltás —</option>
        ${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
      </select>
    </div>

    ${c.status === 'garancialis_problema' ? `
    <div class="complaint-box">
      <h3 style="margin-top:0;color:var(--danger)">Reklamáció</h3>
      <p>${esc(c.complaint_text)}</p>
      <div>${(c.complaint_files || []).map(f => `<img src="${f}">`).join('')}</div>
    </div>` : ''}
    ${c.satisfaction_rating ? `<p style="margin-top:14px">Elégedettségi értékelés: <strong>${c.satisfaction_rating} / 5 ⭐</strong></p>` : ''}
    ${c.colleague_approved ? `<p style="margin-top:10px;color:var(--accept)">✓ A kolléganő jóváhagyta a megrendelőlapot.</p>` : ''}
    ${c.modify_request_text ? `<div class="complaint-box" style="border-color:#454C54;background:#f4f5f6"><h3 style="margin-top:0;color:#454C54">Ügyfél módosítást kért (${new Date(c.modify_request_at).toLocaleString('hu-HU')})</h3><p>${esc(c.modify_request_text)}</p></div>` : ''}
    ${c.reject_reason ? `<div class="complaint-box" style="border-color:#8a8a8a;background:#f0f0f0"><h3 style="margin-top:0;color:#555">Ügyfél elutasította az ajánlatot (${new Date(c.reject_at).toLocaleString('hu-HU')})</h3><p>${esc(c.reject_reason)}</p></div>` : ''}
  `;
  document.getElementById('modalContent').innerHTML = html;
}

function renderQuoteTable(quote) {
  return `<div class="price-box">
    <div style="font-size:1.5rem;font-weight:700">${quote.displayTotal.toLocaleString('hu-HU')} Ft</div>
    <div style="font-size:0.85rem;color:#7a828a;text-transform:uppercase;letter-spacing:.03em">${quote.displayLabel}${quote.vatRequested ? ' — áfás számla igénye alapján' : ' — nincs áfás számla igénye'}</div>
  </div>`;
}

async function saveCustomer() {
  const body = {
    name: document.getElementById('f_name').value,
    phone: document.getElementById('f_phone').value,
    email: document.getElementById('f_email').value,
    zip: document.getElementById('f_zip').value,
    city: document.getElementById('f_city').value,
    address: document.getElementById('f_address').value,
    formData: currentCustomer.form_data,
    summaryText: document.getElementById('f_summary').value,
    sketchSvg: currentCustomer.sketch_svg,
  };
  await api('/admin/customers/' + currentCustomer.id, { method: 'PUT', body: JSON.stringify(body) });
  alert('Mentve.');
}

async function calculateQuote() {
  try {
    const quote = await api(`/admin/customers/${currentCustomer.id}/calculate`, { method: 'POST' });
    currentCustomer.price_breakdown = quote;
    document.getElementById('quoteBox').innerHTML = renderQuoteTable(quote);
  } catch (e) { alert(e.message); }
}

function editOrderData(){
  window.open('/api/admin/customers/'+currentCustomer.id+'/editor', '_blank');
}

let lastOrderParsedPricing = null;
let lastOrderParsedFilename = null;
async function uploadOrderPricingExcel(){
  const fileInput = document.getElementById('orderPricingExcelFile');
  if(!fileInput.files[0]) return alert('Válasszon fájlt.');
  const form = new FormData();
  form.append('file', fileInput.files[0]);
  const res = await fetch('/api/admin/pricing/upload-excel', { method:'POST', body: form });
  const data = await res.json();
  if(!res.ok) return alert('Hiba: '+data.error);
  lastOrderParsedPricing = data.parsed;
  lastOrderParsedFilename = data.filename;
  const p = data.parsed;
  document.getElementById('orderPricingPreview').innerHTML = `
    <p style="font-size:0.8rem;margin-top:8px">Megtalált tételek: ${p.foundKeys.length} db — Nem talált: ${p.missingKeys.length ? esc(p.missingKeys.join(', ')) : 'nincs'}</p>
    <button class="btn-main" onclick="applyOrderPricingExcel()">Jóváhagyás — teljes árazás frissítése + ennek a rendelésnek az újraszámolása</button>
  `;
}
async function applyOrderPricingExcel(){
  const p = lastOrderParsedPricing;
  await api('/admin/pricing/apply', { method:'POST', body: JSON.stringify({ basePriceTable: p.basePriceTable, addon: p.addon, filename: lastOrderParsedFilename }) });
  await calculateQuote();
  document.getElementById('orderPricingPreview').innerHTML = '<p style="color:var(--accept);font-size:0.85rem">Árazás frissítve, ez a megrendelés is újraszámolva.</p>';
}

async function sendOffer() {
  if (!confirm('Biztosan kiküldi az ajánlatot az ügyfélnek?')) return;
  try {
    await api(`/admin/customers/${currentCustomer.id}/send-offer`, { method: 'POST' });
    alert('Ajánlat kiküldve.');
    openDetail(currentCustomer.id);
  } catch (e) { alert(e.message); }
}

async function sendReminder() {
  if (!confirm('Biztosan kiküld egy emlékeztetőt az ügyfélnek, hogy reagáljon az ajánlatra?')) return;
  try {
    await api(`/admin/customers/${currentCustomer.id}/send-reminder`, { method: 'POST' });
    alert('Emlékeztető kiküldve.');
    openDetail(currentCustomer.id);
  } catch (e) { alert(e.message); }
}

async function sendOrderFormColleague() {
  try {
    await api(`/admin/customers/${currentCustomer.id}/send-order-form-colleague`, { method: 'POST' });
    alert('Megrendelőlap (PL) kiküldve a kolléganőnek.');
  } catch (e) { alert(e.message); }
}

async function sendOrderFormCustomer() {
  if (!confirm('Biztosan kiküldi a végleges megrendelőlapot az ügyfélnek?')) return;
  try {
    await api(`/admin/customers/${currentCustomer.id}/send-order-form-customer`, { method: 'POST' });
    alert('Megrendelőlap (HU) kiküldve az ügyfélnek.');
    openDetail(currentCustomer.id);
  } catch (e) { alert(e.message); }
}

async function uploadInvoice() {
  const fileInput = document.getElementById('invoiceFile');
  if (!fileInput.files[0]) return alert('Válasszon fájlt.');
  const form = new FormData();
  form.append('invoice', fileInput.files[0]);
  const res = await fetch(`/api/admin/customers/${currentCustomer.id}/upload-invoice`, { method: 'POST', body: form });
  if (!res.ok) return alert('Hiba a feltöltés közben.');
  alert('Feltöltve.');
  openDetail(currentCustomer.id);
}

async function sendInvoice() {
  try {
    await api(`/admin/customers/${currentCustomer.id}/send-invoice`, { method: 'POST' });
    alert('Előlegszámla kiküldve.');
    openDetail(currentCustomer.id);
  } catch (e) { alert(e.message); }
}

async function markInstalled() {
  if (!confirm('Megerősíted, hogy a garázs telepítve lett? Ez e-mailt küld az ügyfélnek.')) return;
  try {
    await api(`/admin/customers/${currentCustomer.id}/mark-installed`, { method: 'POST' });
    alert('Jelezve, e-mail kiküldve.');
    openDetail(currentCustomer.id);
  } catch (e) { alert(e.message); }
}

async function setStatusManually() {
  const status = document.getElementById('manualStatus').value;
  if (!status) return;
  await api(`/admin/customers/${currentCustomer.id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
  openDetail(currentCustomer.id);
}

function switchTab(tab){
  ['Customers','Types','Emails','Pricing','Stats'].forEach(t=>{
    document.getElementById('tab'+t).classList.toggle('active', tab===t.toLowerCase());
  });
  document.getElementById('customersView').style.display = tab==='customers' ? 'block' : 'none';
  document.getElementById('typesView').style.display = tab==='types' ? 'block' : 'none';
  document.getElementById('emailsView').style.display = tab==='emails' ? 'block' : 'none';
  document.getElementById('pricingView').style.display = tab==='pricing' ? 'block' : 'none';
  document.getElementById('statsView').style.display = tab==='stats' ? 'block' : 'none';
  if(tab==='types') loadGarageTypes();
  if(tab==='emails') loadEmailTemplates();
  if(tab==='pricing') loadPricingConfig();
  if(tab==='stats') loadStats();
}

async function loadGarageTypes(){
  const rows = await api('/admin/garage-types');
  const grid = document.getElementById('typesGrid');
  grid.innerHTML = rows.map(t => `
    <div class="type-card">
      <div class="type-thumb">
        ${t.image_path ? `<img src="${t.image_path}" alt="${esc(t.name)}">` : `<span class="no-image">Nincs kép</span>`}
      </div>
      <div class="type-body">
        <h4>${esc(t.name)}</h4>
        <div class="type-actions">
          <a class="btn-secondary" href="type-editor.html?id=${t.id}" style="text-decoration:none;display:inline-block">Szerkesztés</a>
          <button class="btn-ghost" style="border-color:#b23a3a;color:#b23a3a" onclick="deleteGarageType(${t.id})">Törlés</button>
        </div>
      </div>
    </div>
  `).join('') || '<p style="color:#7a828a">Még nincs mentett típusgarázs.</p>';
}

async function deleteGarageType(id){
  if(!confirm('Biztosan törli ezt a típusgarázst?')) return;
  await api('/admin/garage-types/'+id, { method: 'DELETE' });
  loadGarageTypes();
}

// --- Email sablonok ---
let currentTemplateKey = null;
async function loadEmailTemplates(){
  const rows = await api('/admin/email-templates');
  const box = document.getElementById('emailTemplateList');
  box.innerHTML = `<table id="customerTable"><thead><tr><th>Sablon</th><th>Tárgy</th><th>Utolsó módosítás</th><th></th></tr></thead><tbody>
    ${rows.map(t=>`<tr>
      <td>${esc(t.label)}</td>
      <td>${esc(t.subject)}</td>
      <td>${new Date(t.updated_at).toLocaleString('hu-HU')}</td>
      <td><button class="link-btn" onclick="editEmailTemplate('${t.key}')">Szerkesztés</button></td>
    </tr>`).join('')}
  </tbody></table>`;
}
async function editEmailTemplate(key){
  const t = await api('/admin/email-templates/'+key);
  currentTemplateKey = key;
  document.getElementById('emailSubjectInput').value = t.subject;
  document.getElementById('emailBodyInput').value = t.html_body;
  document.getElementById('emailTemplateEditor').style.display = 'block';
}
async function saveEmailTemplate(){
  const subject = document.getElementById('emailSubjectInput').value;
  const html_body = document.getElementById('emailBodyInput').value;
  await api('/admin/email-templates/'+currentTemplateKey, { method:'PUT', body: JSON.stringify({ subject, html_body }) });
  alert('Sablon elmentve.');
  document.getElementById('emailTemplateEditor').style.display = 'none';
  loadEmailTemplates();
}

// --- Árazás ---
async function loadPricingConfig(){
  const data = await api('/admin/pricing/current');
  document.getElementById('discountPercentInput').value = data.discountPercent;
  const box = document.getElementById('pricingPreview');
  const hasOverride = data.basePriceTable || data.addon;
  box.innerHTML = hasOverride
    ? `<div class="preset-panel" style="background:#fff;padding:16px;border-radius:6px">
        <strong>Jelenleg érvényben lévő felülírás</strong> ${data.basePriceTable && data.basePriceTable._meta ? '(forrás: '+esc(data.basePriceTable._meta.source||'')+', '+new Date(data.basePriceTable._meta.updated_at).toLocaleString('hu-HU')+')' : ''}
        <pre style="font-size:0.75rem;background:#fafbfb;padding:10px;border-radius:4px;max-height:300px;overflow:auto">${esc(JSON.stringify(data, null, 2))}</pre>
      </div>`
    : `<p style="color:#7a828a">Jelenleg a beépített alapértékek vannak használatban, nincs feltöltött felülírás.</p>`;
}
async function saveDiscountPercent(){
  const val = document.getElementById('discountPercentInput').value;
  await api('/admin/pricing/discount', { method:'POST', body: JSON.stringify({ percent: val }) });
  document.getElementById('discountStatus').textContent = 'Mentve.';
  loadPricingConfig();
}
async function uploadPricingExcel(){
  const fileInput = document.getElementById('pricingExcelFile');
  if(!fileInput.files[0]) return alert('Válasszon fájlt.');
  const form = new FormData();
  form.append('file', fileInput.files[0]);
  const res = await fetch('/api/admin/pricing/upload-excel', { method:'POST', body: form });
  const data = await res.json();
  if(!res.ok) return alert('Hiba: '+data.error);
  renderPricingReview(data);
}
let lastParsedPricing = null;
let lastParsedFilename = null;
function renderPricingReview(data){
  lastParsedPricing = data.parsed;
  lastParsedFilename = data.filename;
  const p = data.parsed;
  const box = document.getElementById('pricingPreview');
  box.innerHTML = `
    <div class="preset-panel" style="background:#fff;padding:16px;border-radius:6px">
      <h3>Elemzés eredménye: ${esc(data.filename)}</h3>
      <p class="hint">Ellenőrizd az alábbi kiolvasott értékeket, mielőtt jóváhagyod! Amit a rendszer nem talált meg, azt a "Nem talált tételek" lista mutatja — ott a régi/alapérték marad érvényben.</p>
      <p><strong>Megtalált tételek:</strong> ${p.foundKeys.length} db</p>
      <p><strong>Nem talált tételek:</strong> ${p.missingKeys.length ? p.missingKeys.map(esc).join(', ') : 'nincs'}</p>
      <pre style="font-size:0.75rem;background:#fafbfb;padding:10px;border-radius:4px;max-height:300px;overflow:auto">${esc(JSON.stringify(p, null, 2))}</pre>
      <div class="btn-row">
        <button class="btn-main" onclick="applyPricingConfig()">Jóváhagyás és mentés</button>
      </div>
    </div>`;
}
async function applyPricingConfig(){
  const p = lastParsedPricing;
  await api('/admin/pricing/apply', { method:'POST', body: JSON.stringify({ basePriceTable: p.basePriceTable, addon: p.addon, filename: lastParsedFilename }) });
  alert('Árazás frissítve.');
  loadPricingConfig();
}
async function resetPricingConfig(){
  if(!confirm('Biztosan visszaállítod az alapértelmezett árakat?')) return;
  await api('/admin/pricing/reset', { method:'POST' });
  loadPricingConfig();
}

// --- Statisztika ---
function currentStatsRange(){
  const month = document.getElementById('statsMonth').value;
  if(month){
    const [y,m] = month.split('-').map(Number);
    const from = `${y}-${String(m).padStart(2,'0')}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const to = `${y}-${String(m).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
    return { from, to };
  }
  return { from: document.getElementById('statsFrom').value || '1970-01-01', to: document.getElementById('statsTo').value || '2999-12-31' };
}

async function loadStats(){
  const { from, to } = currentStatsRange();
  const data = await api(`/admin/stats/summary?from=${from}&to=${to}`);
  const box = document.getElementById('statsSummary');
  const statOptions = Object.entries(STATUS_LABELS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('');

  box.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:20px">
      ${statCard('Kiküldött ajánlatok', data.offersSent)}
      ${statCard('Megrendelt ajánlatok', data.ordered)}
      ${statCard('Elutasított ajánlatok', data.rejected)}
      ${statCard('Válasz nélküli ajánlatok', data.noResponse)}
      ${statCard('Átlag megrendelési érték (nettó)', data.avgOrderValueNet.toLocaleString('hu-HU')+' Ft')}
    </div>

    <div class="preset-panel" style="background:#fff;padding:20px;border-radius:6px;margin-bottom:20px">
      <h3>Típusgarázsok / egyedi összeállítások megoszlása</h3>
      <table id="customerTable"><thead><tr><th>Típus</th><th>Darabszám</th></tr></thead><tbody>
        ${data.typeBreakdown.map(t=>`<tr><td>${esc(t.type_name)}</td><td>${t.c}</td></tr>`).join('')}
      </tbody></table>
    </div>

    <div class="preset-panel" style="background:#fff;padding:20px;border-radius:6px">
      <h3>Ügyfelek lekérdezése státusz szerint</h3>
      <div style="display:flex;gap:10px;align-items:end">
        <select id="statsStatusSelect" class="status-select">${statOptions}</select>
        <button class="btn-secondary" onclick="loadStatsByStatus()">Lekérdezés</button>
      </div>
    </div>
  `;
}

function statCard(label, value){
  return `<div style="background:#fff;border-radius:6px;padding:16px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.05)">
    <div style="font-size:1.6rem;font-weight:700">${value}</div>
    <div style="font-size:0.75rem;color:#7a828a;text-transform:uppercase;letter-spacing:.02em;margin-top:4px">${label}</div>
  </div>`;
}

async function loadStatsByStatus(){
  const status = document.getElementById('statsStatusSelect').value;
  const { from, to } = currentStatsRange();
  const rows = await api(`/admin/stats/by-status?status=${status}&from=${from}&to=${to}`);
  const box = document.getElementById('statsByStatusResult');
  box.innerHTML = `
    <div class="preset-panel" style="background:#fff;padding:20px;border-radius:6px">
      <h3>${STATUS_LABELS[status]||status} (${rows.length} db)</h3>
      <table id="customerTable"><thead><tr><th>Név</th><th>E-mail</th><th>Telefon</th><th>Beküldve</th><th>Ár</th></tr></thead><tbody>
        ${rows.map(r=>`<tr><td>${esc(r.name)}</td><td>${esc(r.email)}</td><td>${esc(r.phone)}</td><td>${new Date(r.created_at).toLocaleString('hu-HU')}</td><td>${r.price_huf?r.price_huf.toLocaleString('hu-HU')+' Ft':'—'}</td></tr>`).join('') || '<tr><td colspan="5" style="color:#7a828a">Nincs találat.</td></tr>'}
      </tbody></table>
    </div>
  `;
}

checkSession();
