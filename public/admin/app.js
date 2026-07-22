const STATUS_LABELS = {
  ajanlatra_var: 'Ajánlatra vár',
  ajanlat_kikuldve: 'Ajánlat kiküldve',
  ajanlat_elfogadva: 'Ajánlat elfogadva',
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
    const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
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
    </div>
    <div id="quoteBox">
      ${quote ? renderQuoteTable(quote) : '<p style="color:#7a828a;font-size:0.85rem">Még nincs kiszámolva.</p>'}
    </div>

    <hr>
    <h3>Folyamat</h3>
    <div class="btn-row">
      <button class="btn-main" onclick="sendOffer()">Ajánlat kiküldése</button>
      <button class="btn-secondary" onclick="sendOrderFormColleague()">Megrendelőlap küldése a kolléganőnek (PL)</button>
      <button class="btn-secondary" onclick="sendOrderFormCustomer()">Végleges megrendelőlap küldése ügyfélnek (HU)</button>
    </div>

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
  `;
  document.getElementById('modalContent').innerHTML = html;
}

function renderQuoteTable(quote) {
  return `<table class="price-table">
    ${quote.lines.map(l => `<tr><td>${esc(l.label)}</td><td style="text-align:right">${l.huf.toLocaleString('hu-HU')} Ft</td></tr>`).join('')}
    <tr class="total-row"><td>Végösszeg</td><td style="text-align:right">${quote.totalHUF.toLocaleString('hu-HU')} Ft</td></tr>
  </table>`;
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

async function sendOffer() {
  if (!confirm('Biztosan kiküldi az ajánlatot az ügyfélnek?')) return;
  try {
    await api(`/admin/customers/${currentCustomer.id}/send-offer`, { method: 'POST' });
    alert('Ajánlat kiküldve.');
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
  document.getElementById('tabCustomers').classList.toggle('active', tab==='customers');
  document.getElementById('tabTypes').classList.toggle('active', tab==='types');
  document.getElementById('customersView').style.display = tab==='customers' ? 'block' : 'none';
  document.getElementById('typesView').style.display = tab==='types' ? 'block' : 'none';
  if(tab==='types') loadGarageTypes();
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

checkSession();
