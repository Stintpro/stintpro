// ── AUTH ──────────────────────────────────────────────────────────────────

function renderLoginScreen() {
  const setup = document.getElementById('screen-setup');
  setup.classList.add('active');
  setup.innerHTML = `
  <div style="height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px;background:#08090a;">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:48px;">
      <div style="font-size:32px">🏁</div>
      <div>
        <div style="font-size:20px;font-weight:600;color:#fff;letter-spacing:-0.5px">StintPro</div>
        <div style="font-size:12px;color:#444;margin-top:2px">Karting Strategy</div>
      </div>
    </div>
    <div style="background:#13141a;border:0.5px solid #1e1f25;border-radius:16px;padding:32px 28px;width:100%;max-width:360px;">
      <div style="font-size:13.5px;font-weight:500;color:#9090a0;margin-bottom:20px;text-align:center">Acceso a la plataforma</div>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <input id="sp-email" type="email" placeholder="Email" autocomplete="email"
          style="background:#0e0f11;border:0.5px solid #2a2b30;border-radius:10px;padding:12px 14px;font-size:14.5px;color:#f0f0f4;outline:none;font-family:var(--font-sans,sans-serif)"
          onkeydown="if(event.key==='Enter')document.getElementById('sp-pw').focus()">
        <input id="sp-pw" type="password" placeholder="Contraseña" autocomplete="current-password"
          style="background:#0e0f11;border:0.5px solid #2a2b30;border-radius:10px;padding:12px 14px;font-size:14.5px;color:#f0f0f4;outline:none;font-family:var(--font-sans,sans-serif)"
          onkeydown="if(event.key==='Enter')_spLogin()">
        <button id="sp-btn" onclick="_spLogin()"
          style="background:#5b9cf6;border:none;border-radius:10px;padding:13px;font-size:14.5px;font-weight:500;color:#fff;cursor:pointer;margin-top:4px;font-family:var(--font-sans,sans-serif)">
          Acceder
        </button>
        <div id="sp-err" style="font-size:12.5px;color:#e85555;text-align:center;min-height:18px"></div>
      </div>
    </div>
  </div>`;
  setTimeout(() => document.getElementById('sp-email')?.focus(), 100);
}

async function _spLogin() {
  const email = document.getElementById('sp-email')?.value.trim();
  const pw    = document.getElementById('sp-pw')?.value;
  const errEl = document.getElementById('sp-err');
  const btn   = document.getElementById('sp-btn');
  if (!email || !pw) { if (errEl) errEl.textContent = 'Introduce email y contraseña'; return; }

  if (errEl) errEl.textContent = '';
  if (btn) { btn.disabled = true; btn.textContent = 'Accediendo…'; }

  const { data, error } = await window.supabaseClient.auth.signInWithPassword({ email, password: pw });

  if (error) {
    if (errEl) errEl.textContent = 'Email o contraseña incorrectos';
    if (btn)   { btn.disabled = false; btn.textContent = 'Acceder'; }
    return;
  }

  await _onAuthSuccess(data.user);
}

async function _onAuthSuccess(user) {
  window._currentUser = user;

  const { data: profile } = await window.supabaseClient
    .from('profiles').select('role, name').eq('id', user.id).single();

  window._currentUserRole = profile?.role || 'user';
  window._currentUserName = profile?.name || user.email;

  await window.CircuitDB.loadFromSupabase();

  _showTopBar();
  renderSetup();
}

function _showTopBar() {
  const bar = document.getElementById('sp-topbar');
  if (!bar) return;
  bar.style.display = 'flex';
  const nameEl = bar.querySelector('#sp-topbar-name');
  if (nameEl) nameEl.textContent = window._currentUserName;
  const adminBtn = bar.querySelector('#sp-admin-btn');
  if (adminBtn) adminBtn.style.display = window._currentUserRole === 'admin' ? 'inline-flex' : 'none';
}

async function spSignOut() {
  await window.supabaseClient.auth.signOut();
  window._currentUser = null;
  window._currentUserRole = null;
  window._currentUserName = null;
  const bar = document.getElementById('sp-topbar');
  if (bar) bar.style.display = 'none';
  renderLoginScreen();
}

// ── ADMIN PANEL ───────────────────────────────────────────────────────────

function renderAdminPanel(tab) {
  tab = tab || 'circuits';
  const overlay = document.getElementById('sp-admin-overlay');
  if (!overlay) return;
  overlay.style.display = 'flex';

  overlay.innerHTML = `
  <div style="width:100%;max-width:700px;margin:auto;background:#13141a;border:0.5px solid #1e1f25;border-radius:16px;overflow:hidden;display:flex;flex-direction:column;max-height:90vh;">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 24px 0;">
      <div style="font-size:15px;font-weight:600;color:#f0f0f4">Panel de administración</div>
      <button onclick="document.getElementById('sp-admin-overlay').style.display='none'"
        style="background:none;border:none;color:#666;font-size:20px;cursor:pointer;padding:4px 8px">✕</button>
    </div>
    <div style="display:flex;gap:4px;padding:14px 24px 0;">
      <button onclick="renderAdminPanel('circuits')"
        style="padding:7px 16px;border-radius:8px;border:0.5px solid ${tab==='circuits'?'#5b9cf6':'#1e1f25'};background:${tab==='circuits'?'rgba(91,156,246,0.14)':'transparent'};color:${tab==='circuits'?'#5b9cf6':'#666'};font-size:13.5px;cursor:pointer;font-family:var(--font-sans,sans-serif)">
        Circuitos
      </button>
      <button onclick="renderAdminPanel('users')"
        style="padding:7px 16px;border-radius:8px;border:0.5px solid ${tab==='users'?'#5b9cf6':'#1e1f25'};background:${tab==='users'?'rgba(91,156,246,0.14)':'transparent'};color:${tab==='users'?'#5b9cf6':'#666'};font-size:13.5px;cursor:pointer;font-family:var(--font-sans,sans-serif)">
        Usuarios
      </button>
    </div>
    <div id="admin-tab-content" style="padding:20px 24px;overflow-y:auto;flex:1"></div>
  </div>`;

  if (tab === 'circuits') _adminRenderCircuits();
  else _adminRenderUsers();
}

// ── TAB: CIRCUITOS ────────────────────────────────────────────────────────

async function _adminRenderCircuits() {
  const el = document.getElementById('admin-tab-content');
  if (!el) return;
  el.innerHTML = '<div style="color:#666;font-size:13px">Cargando…</div>';

  const { data: circuits, error } = await window.supabaseClient
    .from('circuits').select('*').order('name');

  if (error) { el.innerHTML = `<div style="color:#e85555">Error: ${error.message}</div>`; return; }

  el.innerHTML = `
  <div style="margin-bottom:20px">
    <div style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">Añadir circuito</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <input id="adm-c-name" placeholder="Nombre" style="${_adminInputStyle()};flex:2;min-width:140px">
      <input id="adm-c-slug" placeholder="Slug (ej: rkc)" style="${_adminInputStyle()};flex:1;min-width:80px">
      <input id="adm-c-port" placeholder="Puerto" type="number" value="7913" style="${_adminInputStyle()};width:90px">
      <button onclick="_adminAddCircuit()" style="${_adminBtnStyle('blue')}">Añadir</button>
    </div>
    <div id="adm-c-err" style="font-size:12px;color:#e85555;margin-top:6px;min-height:16px"></div>
  </div>
  <div style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">
    Catálogo (${circuits.length})
  </div>
  ${circuits.length === 0
    ? '<div style="color:#444;font-size:13px;padding:12px 0">Sin circuitos. Añade el primero.</div>'
    : `<div style="display:flex;flex-direction:column;gap:4px">
        ${circuits.map(c => `
          <div style="display:flex;align-items:center;gap:10px;background:#0e0f11;border:0.5px solid #1e1f25;border-radius:8px;padding:10px 14px">
            <div style="flex:1;min-width:0">
              <div style="font-size:13.5px;color:#f0f0f4">${_esc(c.name)}</div>
              <div style="font-size:11.5px;color:#555;font-family:monospace;margin-top:1px">${_esc(c.slug)} · :${c.port}</div>
            </div>
            <button onclick="_adminDeleteCircuit('${c.id}','${_esc(c.name)}')"
              style="${_adminBtnStyle('red')}">Borrar</button>
          </div>`).join('')}
       </div>`}`;
}

async function _adminAddCircuit() {
  const name = document.getElementById('adm-c-name')?.value.trim();
  const slug = document.getElementById('adm-c-slug')?.value.trim();
  const port = parseInt(document.getElementById('adm-c-port')?.value) || 7913;
  const errEl = document.getElementById('adm-c-err');
  if (!name || !slug) { if (errEl) errEl.textContent = 'Nombre y slug son obligatorios'; return; }
  if (errEl) errEl.textContent = '';

  const { error } = await window.supabaseClient
    .from('circuits').insert({ name, slug, port });

  if (error) {
    if (errEl) errEl.textContent = error.message.includes('unique') ? 'Ya existe un circuito con ese slug' : error.message;
    return;
  }

  // Sync to local CircuitDB so the selector reflects it immediately
  window.CircuitDB.add({ id: 'sb_' + slug, name, slug, port, _supabase: true });
  if (typeof _refreshCircuitSelect === 'function') _refreshCircuitSelect();
  _adminRenderCircuits();
}

async function _adminDeleteCircuit(id, name) {
  if (!confirm(`¿Borrar circuito "${name}"?`)) return;

  const { error } = await window.supabaseClient
    .from('circuits').delete().eq('id', id);

  if (error) { alert('Error al borrar: ' + error.message); return; }

  // Remove from local CircuitDB
  const idx = window.CircuitDB.list.findIndex(c => c._supabase && c.slug === name);
  window.CircuitDB.list = window.CircuitDB.list.filter(c => !(c._supabase && c._sbId === id));
  if (typeof _refreshCircuitSelect === 'function') _refreshCircuitSelect();
  _adminRenderCircuits();
}

// ── TAB: USUARIOS ─────────────────────────────────────────────────────────

async function _adminRenderUsers() {
  const el = document.getElementById('admin-tab-content');
  if (!el) return;
  el.innerHTML = '<div style="color:#666;font-size:13px">Cargando…</div>';

  const token = (await window.supabaseClient.auth.getSession()).data.session?.access_token;
  let users = [];
  try {
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ action: 'list-users' })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Error desconocido');
    users = json.users || [];
  } catch(e) {
    el.innerHTML = `<div style="color:#e85555">Error al cargar usuarios: ${e.message}</div>`;
    return;
  }

  el.innerHTML = `
  <div style="margin-bottom:20px">
    <div style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">Crear usuario</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
      <input id="adm-u-email" placeholder="Email" type="email" style="${_adminInputStyle()};flex:2;min-width:160px">
      <input id="adm-u-pw" placeholder="Contraseña" type="password" style="${_adminInputStyle()};flex:1;min-width:120px">
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <input id="adm-u-name" placeholder="Nombre (opcional)" style="${_adminInputStyle()};flex:2;min-width:140px">
      <select id="adm-u-role" style="${_adminInputStyle()};flex:1;min-width:100px">
        <option value="user">Usuario</option>
        <option value="admin">Admin</option>
      </select>
      <button onclick="_adminCreateUser()" style="${_adminBtnStyle('blue')}">Crear</button>
    </div>
    <div id="adm-u-err" style="font-size:12px;color:#e85555;margin-top:6px;min-height:16px"></div>
  </div>
  <div style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">
    Usuarios (${users.length})
  </div>
  <div style="display:flex;flex-direction:column;gap:4px">
    ${users.map(u => `
      <div style="display:flex;align-items:center;gap:10px;background:#0e0f11;border:0.5px solid #1e1f25;border-radius:8px;padding:10px 14px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px">
            <div style="font-size:13.5px;color:#f0f0f4">${_esc(u.name || u.email)}</div>
            <span style="font-size:11px;padding:1px 7px;border-radius:20px;background:${u.role==='admin'?'rgba(91,156,246,0.2)':'rgba(255,255,255,0.05)'};color:${u.role==='admin'?'#5b9cf6':'#666'};border:0.5px solid ${u.role==='admin'?'#5b9cf6':'#333'}">${u.role}</span>
            ${u.id === window._currentUser?.id ? '<span style="font-size:11px;color:#555">(tú)</span>' : ''}
          </div>
          <div style="font-size:11.5px;color:#555;margin-top:1px">${_esc(u.email)}</div>
        </div>
        ${u.id !== window._currentUser?.id
          ? `<button onclick="_adminDeleteUser('${u.id}','${_esc(u.email)}')" style="${_adminBtnStyle('red')}">Borrar</button>`
          : ''}
      </div>`).join('')}
  </div>`;
}

async function _adminCreateUser() {
  const email = document.getElementById('adm-u-email')?.value.trim();
  const pw    = document.getElementById('adm-u-pw')?.value;
  const name  = document.getElementById('adm-u-name')?.value.trim();
  const role  = document.getElementById('adm-u-role')?.value;
  const errEl = document.getElementById('adm-u-err');
  if (!email || !pw) { if (errEl) errEl.textContent = 'Email y contraseña son obligatorios'; return; }
  if (errEl) errEl.textContent = '';

  const token = (await window.supabaseClient.auth.getSession()).data.session?.access_token;
  try {
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ action: 'create-user', email, password: pw, name, role })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Error desconocido');
  } catch(e) {
    if (errEl) errEl.textContent = e.message;
    return;
  }

  _adminRenderUsers();
}

async function _adminDeleteUser(userId, email) {
  if (!confirm(`¿Borrar usuario "${email}"? Esta acción no se puede deshacer.`)) return;

  const token = (await window.supabaseClient.auth.getSession()).data.session?.access_token;
  try {
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ action: 'delete-user', userId })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Error desconocido');
  } catch(e) {
    alert('Error al borrar: ' + e.message);
    return;
  }

  _adminRenderUsers();
}

// ── HELPERS ───────────────────────────────────────────────────────────────

function _adminInputStyle() {
  return 'background:#0e0f11;border:0.5px solid #2a2b30;border-radius:8px;padding:9px 12px;font-size:13.5px;color:#f0f0f4;outline:none;font-family:var(--font-sans,sans-serif)';
}

function _adminBtnStyle(color) {
  const colors = {
    blue: { bg: 'rgba(91,156,246,0.15)', border: '#5b9cf6', text: '#5b9cf6' },
    red:  { bg: 'rgba(232,85,85,0.12)',  border: '#c04444', text: '#e85555' }
  };
  const c = colors[color] || colors.blue;
  return `background:${c.bg};border:0.5px solid ${c.border};border-radius:8px;padding:8px 14px;font-size:13px;color:${c.text};cursor:pointer;font-family:var(--font-sans,sans-serif);white-space:nowrap`;
}

function _esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
