// ── radio.js — radio web móvil: mensajes al piloto sin el panel ─────────────
// Login (SPAuth) → circuito + dorsal → WS al logger: auth + team_watch.
// Lista de pilotos: la del panel si hay uno conectado; si no, la plantilla de
// Apex (.INF) publicada como source:'radio' y refrescada cada minuto (así la
// app del piloto sabe quién va en pista). Sin cola offline: sin conexión no se
// envía nada. Todo texto del servidor o de Apex se pinta con textContent.
(function () {
  'use strict';
  const LOGGER_WS = 'wss://stintpro.duckdns.org';
  const APEX_EVERY_MS = 60000;
  const ACK_TIMEOUT_MS = 5000;
  const LS_KEY = 'stintpro_radio_last';
  const $ = id => document.getElementById(id);

  const st = {
    slug: null, dorsal: null, port: null, name: '',
    ws: null, authed: false, attempt: 0, reconnectTimer: null, authFailed: 0,
    server: null, apex: null, rowId: null, apexNote: '',
    roster: RadioCore.chooseRoster(null, null), picked: null, presence: [],
    pending: new Map(), apexTimer: null, wakeLock: null, seq: 0, lastSent: null, gen: 0, refreshing: false,
  };
  const cooldown = RadioCore.createCooldown();

  // ?logger=ws://localhost:3001 solo en local (pruebas con replay-vps.js).
  function loggerUrl() {
    const q = new URLSearchParams(location.search).get('logger');
    return q && /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? q : LOGGER_WS;
  }
  function show(view) { ['v-login', 'v-setup', 'v-radio'].forEach(v => { $(v).hidden = v !== view; }); }
  const NO_ACCESS = 'Esta cuenta no tiene acceso a StintPro. Pide una invitación.';

  // ── Login ──
  async function start() {
    try {
      const u = await SPAuth.ready();
      if (!u) return showLogin();
      if (!(await SPAuth.isMember())) return showLogin(NO_ACCESS);
      showSetup();
    } catch (e) { showLogin(SPAuth.errorMessage(e)); }
  }
  function showLogin(msg) { $('login-error').textContent = msg || ''; show('v-login'); }
  $('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    $('login-error').textContent = '';
    try {
      await SPAuth.signIn($('login-email').value.trim(), $('login-pass').value);
      $('login-pass').value = '';
      if (!(await SPAuth.isMember())) { await SPAuth.signOut(); return showLogin(NO_ACCESS); }
      showSetup();
    } catch (err) { $('login-error').textContent = SPAuth.errorMessage(err); }
  });

  // ── Circuito y dorsal ──
  const circuits = () => (window.CircuitDB && CircuitDB.list) || [];
  function showSetup() {
    $('setup-circuit').replaceChildren(...circuits().map(c => {
      const o = document.createElement('option'); o.value = c.slug; o.textContent = c.name; return o;
    }));
    let last = null;
    try { last = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) {}
    if (last) { $('setup-circuit').value = last.slug; $('setup-dorsal').value = last.dorsal; }
    show('v-setup');
  }
  $('setup-form').addEventListener('submit', e => {
    e.preventDefault();
    const c = circuits().find(x => x.slug === $('setup-circuit').value);
    const dorsal = $('setup-dorsal').value.trim();
    if (!c || !dorsal) return;
    try { localStorage.setItem(LS_KEY, JSON.stringify({ slug: c.slug, dorsal })); } catch (e2) {}
    openRadio(c, dorsal);
  });
  $('logout').addEventListener('click', async () => { await SPAuth.signOut(); showLogin(); });
  $('bar-change').addEventListener('click', () => { closeRadio(); showSetup(); });

  // ── Radio ──
  function openRadio(c, dorsal) {
    Object.assign(st, { slug: c.slug, port: parseInt(c.port, 10), name: c.name, dorsal,
      server: null, apex: null, rowId: null, apexNote: '', picked: null, presence: [], attempt: 0, authFailed: 0, lastSent: null, refreshing: false });
    st.gen++;
    st.roster = RadioCore.chooseRoster(null, null);
    $('bar-where').textContent = `${c.name} · #${dorsal}`;
    showResult(null, '');
    renderQuick(); render(); show('v-radio');
    connect(); refreshApex();
    st.apexTimer = setInterval(refreshApex, APEX_EVERY_MS);
    keepAwake();
  }
  function closeRadio() {
    clearInterval(st.apexTimer); clearTimeout(st.reconnectTimer);
    if (st.ws) { st.ws.onclose = null; try { st.ws.close(); } catch (e) {} }
    st.ws = null; st.authed = false; st.slug = null;
    st.gen++; st.refreshing = false;
    failPending('Envío cancelado');
    if (st.wakeLock) { st.wakeLock.release().catch(() => {}); st.wakeLock = null; }
  }

  // ── Conexión al logger ──
  function setConn(state) {
    const el = $('bar-conn');
    el.dataset.state = state;
    el.textContent = state === 'ok' ? 'Conectado' : state === 'connecting' ? 'Reconectando' : 'Sin conexión';
  }
  function send(obj) {
    if (st.ws && st.ws.readyState === 1) { st.ws.send(JSON.stringify(obj)); return true; }
    return false;
  }
  const rosterKey = r => JSON.stringify([r.pilotos, r.current]);

  function connect() {
    setConn('connecting');
    let ws;
    try { ws = new WebSocket(loggerUrl()); } catch (e) { return scheduleReconnect(); }
    st.ws = ws; st.authed = false; st.lastSent = null;
    ws.onopen = async () => {
      let token = '';
      try { token = await SPAuth.idToken(st.authFailed > 0); } catch (e) {}
      if (st.ws === ws) ws.send(JSON.stringify({ type: 'auth', token }));
    };
    ws.onmessage = ev => {
      if (st.ws !== ws) return;
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.type === 'auth_ok') {
        st.authed = true; st.attempt = 0; st.authFailed = 0; setConn('ok');
        send({ type: 'team_watch', slug: st.slug, dorsal: st.dorsal });
        render();
      } else if (m.type === 'team_roster') {
        // Si no es el eco de lo que publicamos nosotros, hay que poder republicar.
        if (!(m.source === 'radio' && st.lastSent === rosterKey(m))) st.lastSent = null;
        st.server = m; updateRoster();
      } else if (m.type === 'pilot_presence') {
        st.presence = m.connected || []; render();
      } else if (m.type === 'team_msg_sent') {
        settle(m.id, m);
      } else if (m.type === 'error') {
        if (m.msg === 'auth_failed') { st.authFailed++; return; }
        if (m.id) return settle(m.id, null, m.msg);
        // «lista del panel activa»: llegará el team_roster del panel; nada que mostrar.
        if (m.about === 'team_roster' && m.msg === 'lista del panel activa') { st.lastSent = null; return; }
        if (m.about) showResult(false, m.msg);
      }
    };
    ws.onclose = () => {
      if (st.ws !== ws) return;
      st.authed = false; st.ws = null; st.presence = [];
      failPending('Conexión perdida: no se sabe si llegó');
      if (st.authFailed >= 2) { closeRadio(); return showLogin('Sesión caducada. Vuelve a entrar.'); }
      setConn('off'); render(); scheduleReconnect();
    };
  }
  function scheduleReconnect() {
    clearTimeout(st.reconnectTimer);
    st.reconnectTimer = setTimeout(() => { if (st.slug) connect(); }, RadioCore.reconnectDelay(st.attempt++));
  }

  // ── Lista de pilotos ──
  function updateRoster() {
    const prev = st.roster;
    st.roster = RadioCore.chooseRoster(st.server, st.apex);
    st.picked = RadioCore.keepPick(st.picked, prev, st.roster);
    if (st.roster.publish && st.authed) {
      const msg = RadioCore.rosterMessage(st.slug, st.dorsal, st.roster);
      const key = rosterKey(msg);
      // No reenviar lo mismo que ya publicamos (evita bucles de republicación);
      // lastSent solo se fija si el envío salió de verdad por el WS.
      if (key !== st.lastSent && send(msg)) st.lastSent = key;
    }
    render();
  }
  async function refreshApex() {
    const slug = st.slug, dorsal = st.dorsal, port = st.port, gen = st.gen;
    if (!slug || st.refreshing) return;
    st.refreshing = true;
    try {
      let rowId = st.rowId;
      if (!rowId) {
        rowId = await EnApexTeam.rowIdFor(slug, port, dorsal, {
          WebSocket, parseGrid: html => ApexGrid.parseGridHtml(html).karts,
        });
        if (gen !== st.gen) return;           // cambió de kart mientras buscaba
        if (!rowId) { st.apexNote = `Dorsal ${dorsal} no aparece en Apex`; return render(); }
        st.rowId = rowId;
      }
      const inf = await EnApexTeam.fetchInf(port - 3, rowId, (u, o) => fetch(u, o));
      if (gen !== st.gen) return;
      if (inf) { st.apex = RadioCore.rosterFromInf(inf); st.apexNote = ''; }  // fallo → se queda la anterior
      updateRoster();
    } catch (e) {
      // se conserva la lista anterior
    } finally {
      if (gen === st.gen) st.refreshing = false;
    }
  }

  // ── Pintado ──
  function render() {
    const r = st.roster, target = RadioCore.pickTarget(st.picked, r);
    const stalePanel = st.server && st.server.source === 'panel' && !st.server.panel;
    const base = r.mode === 'panel'
      ? (stalePanel ? 'Lista del panel StintPro (panel desconectado)' : 'Lista del panel StintPro')
      : r.mode === 'radio' ? 'Pilotos de Apex'
      : `Sin plantilla: el mensaje va a todos los móviles del #${st.dorsal || ''}`;
    $('roster-note').textContent = st.apexNote ? `${base} · ${st.apexNote}` : base;
    $('pilots').replaceChildren(...r.pilotos.map((name, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pilot' + (i === target ? ' sel' : '');
      b.setAttribute('aria-pressed', String(i === target));
      const row = document.createElement('span'); row.className = 'name';
      const dot = document.createElement('span'); dot.className = 'dot' + (st.presence.includes(i) ? ' on' : '');
      const nm = document.createElement('span'); nm.textContent = name;
      row.append(dot, nm); b.append(row);
      if (i === r.current) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = 'EN PISTA'; b.append(t); }
      b.addEventListener('click', () => { st.picked = i; render(); });
      return b;
    }));
    const can = st.authed && (r.mode === 'dorsal' || Number.isInteger(target));
    document.querySelectorAll('#quick button, #free-send').forEach(b => { if (!b.classList.contains('cooling')) b.disabled = !can; });
    const OFFLINE = 'Sin conexión — no se puede enviar', cur = $('result').textContent;
    // No pisar un aviso útil (p. ej. «no se sabe si llegó») con el texto genérico.
    if (!st.authed && st.slug) { if (!cur || $('result').dataset.offline === '1') showResult(false, OFFLINE); }
    else if (st.authed && $('result').dataset.offline === '1') showResult(null, '');
  }
  function showResult(okFlag, text) {
    const el = $('result');
    el.textContent = text;
    el.className = 'result' + (okFlag === true ? ' ok' : okFlag === false ? ' bad' : '');
    el.dataset.offline = text === 'Sin conexión — no se puede enviar' ? '1' : '';
  }
  function renderQuick() {
    $('quick').replaceChildren(...EnPilotLinkCore.QUICK_MESSAGES.map(q => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'q tone-' + q.tone; b.textContent = q.text;
      b.addEventListener('click', () => sendMsg(q.text, q.tone, b));
      return b;
    }));
  }
  $('free-text').addEventListener('input', () => { $('free-count').textContent = `${$('free-text').value.length}/40`; });
  $('free').addEventListener('submit', e => {
    e.preventDefault();
    if (sendMsg($('free-text').value.toUpperCase(), 'orange', $('free-send'))) {
      $('free-text').value = ''; $('free-count').textContent = '0/40';
    }
  });

  // ── Envío ──
  function sendMsg(text, tone, btn) {
    const r = st.roster, target = RadioCore.pickTarget(st.picked, r);
    if (!st.authed) { showResult(false, 'Sin conexión — no se puede enviar'); return false; }
    const id = `radio-${Date.now()}-${++st.seq}`;
    const msg = RadioCore.teamMessage({ slug: st.slug, dorsal: st.dorsal, roster: r, target, text, tone, id });
    if (msg.error) { showResult(false, msg.error); return false; }
    if (!cooldown.tryFire(msg.text, Date.now())) return false;
    send(msg);
    const name = r.mode === 'dorsal' ? null : r.pilotos[target];
    st.pending.set(id, { name, timer: setTimeout(() => settle(id, null, 'Sin confirmación del servidor'), ACK_TIMEOUT_MS) });
    cool(btn);
    if (navigator.vibrate) navigator.vibrate(30);
    return true;
  }
  function cool(btn) {
    const label = btn.textContent;
    btn.classList.add('cooling'); btn.disabled = true; btn.textContent = 'Enviado ✓';
    setTimeout(() => { btn.classList.remove('cooling'); btn.textContent = label; render(); }, RadioCore.COOLDOWN_MS);
  }
  function settle(id, ack, err) {
    const p = st.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer); st.pending.delete(id);
    const res = err ? { ok: false, text: err } : RadioCore.resultLabel(ack, p.name, st.dorsal);
    showResult(res.ok, res.text);
  }
  function failPending(text) { for (const id of [...st.pending.keys()]) settle(id, null, text); }

  // ── Pantalla encendida ──
  async function keepAwake() {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible' && !st.wakeLock && st.slug) {
        st.wakeLock = await navigator.wakeLock.request('screen');
        st.wakeLock.addEventListener('release', () => { st.wakeLock = null; });
      }
    } catch (e) {}
  }
  document.addEventListener('visibilitychange', () => { if (!$('v-radio').hidden) keepAwake(); });

  start();
})();
