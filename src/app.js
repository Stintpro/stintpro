// PIN de acceso — cambia este valor para proteger la app
const _ACCESS_PIN = '2712';
const _PIN_KEY    = 'stintpro_unlocked';

document.addEventListener('DOMContentLoaded', async () => {
  await window.CircuitDB.loadFromSupabase();
  const role = await window._spRolePromise;
  window._spUserRole = role;
  if (role !== 'admin') {
    const { data } = await window.supabaseClient
      .from('settings').select('value').eq('key', 'demo_mode').single();
    if (data?.value === 'true') {
      _launchDemoMode();
      return;
    }
  }
  renderSetup();
});

// ── DEMO MODE ─────────────────────────────────────────────────────────────

async function _launchDemoMode() {
  _showDemoModal();
}

function _showDemoModal() {
  const overlay = document.createElement('div');
  overlay.id = 'demo-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(8,9,10,0.92);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(12px);';
  overlay.innerHTML = `
    <div style="background:#13141a;border:0.5px solid #252630;border-radius:16px;padding:40px 36px;max-width:360px;width:90%;text-align:center;">
      <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#F5A623;letter-spacing:0.15em;margin-bottom:20px;">STINTPRO DEMO</div>
      <div style="font-size:22px;font-weight:600;color:#f2f2f6;margin-bottom:8px;line-height:1.3;">Simulación de carrera real</div>
      <div style="font-size:13px;color:var(--text-3);margin-bottom:32px;line-height:1.6;">Reproducción en bucle de una carrera endurance grabada en vivo.</div>
      <div style="font-size:13px;color:var(--text-2);margin-bottom:10px;">La demo comienza en</div>
      <div id="demo-countdown" style="font-family:'JetBrains Mono',monospace;font-size:48px;font-weight:700;color:#F5A623;margin-bottom:28px;line-height:1;">20</div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <button onclick="_startDemoNow()" style="background:#F5A623;border:none;border-radius:8px;color:#08090a;font-size:14px;font-weight:600;padding:13px 24px;cursor:pointer;font-family:sans-serif;transition:opacity .15s;" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">Comenzar ahora</button>
        <button onclick="signOutSP()" style="background:transparent;border:1px solid #252630;border-radius:8px;color:var(--text-3);font-size:13px;padding:11px 24px;cursor:pointer;font-family:sans-serif;transition:color .15s,border-color .15s;" onmouseover="this.style.color='#999';this.style.borderColor='#3a3b45'" onmouseout="this.style.color='#555';this.style.borderColor='#252630'">Salir</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  let t = 20;
  window._demoCountdownIv = setInterval(() => {
    t--;
    const el = document.getElementById('demo-countdown');
    if (el) el.textContent = t;
    if (t <= 0) { clearInterval(window._demoCountdownIv); _startDemoNow(); }
  }, 1000);
}

async function _startDemoNow() {
  clearInterval(window._demoCountdownIv);
  const overlay = document.getElementById('demo-overlay');
  if (overlay) {
    overlay.style.transition = 'opacity .4s';
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 400);
  }

  try {
    await window.ReplayConnector.loadUrl('/demo/demo-race.ndjson');
  } catch(e) {
    console.error('[Demo] No se pudo cargar demo-race.ndjson:', e);
    const msg = document.createElement('div');
    msg.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#08090a;color:#ef4444;font-family:monospace;font-size:14px;z-index:10000;';
    msg.textContent = 'Error al cargar el archivo de demo. Contacta con el administrador.';
    document.body.appendChild(msg);
    return;
  }

  window.ReplayConnector.loopMode = true;
  window.ReplayConnector.speed = 1;
  window.ApexConnector = window.ReplayConnector;

  const cfg = {
    name: 'Demo · Endurance en vivo', raceType: 'endurance', simMode: false,
    stintMin: 0, stintMax: 999, stops: 0, pitMinTime: 3,
    myDorsal: '1', nKarts: 4, pitLayout: 'libre',
    slug: 'karting-lossantos', port: 8093,
    pilotos: [{ name: 'Demo', minutos: 90 }]
  };
  window.AppState.config = cfg;
  window.AppState.loggerUrl    = _loggerUrl;
  window.AppState.loggerApiKey = _loggerApiKey;
  window.showEnduranceDashboard(cfg);

  setTimeout(_injectDemoBanner, 400);
}

function _injectDemoBanner() {
  if (document.getElementById('demo-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'demo-banner';
  banner.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:9998;background:rgba(245,166,35,0.12);border:1px solid rgba(245,166,35,0.35);border-radius:6px;padding:5px 14px;display:flex;align-items:center;gap:14px;font-family:monospace;font-size:11.5px;backdrop-filter:blur(8px);white-space:nowrap;';
  banner.innerHTML = `
    <span style="color:#F5A623;font-weight:700;letter-spacing:0.1em;">● DEMO</span>
    <span style="color:#444;font-size:10px;">Reproducción en bucle · modo simulación</span>
    <button onclick="_exitDemo()" style="background:transparent;border:1px solid #252630;border-radius:4px;color:var(--text-3);font-size:10px;padding:2px 8px;cursor:pointer;font-family:monospace;transition:color .15s,border-color .15s;" onmouseover="this.style.color='#ccc';this.style.borderColor='#555'" onmouseout="this.style.color='#555';this.style.borderColor='#252630'">Salir</button>`;
  document.body.appendChild(banner);
}

function _exitDemo() {
  window.ReplayConnector.loopMode = false;
  window.ReplayConnector.disconnect();
  document.getElementById('demo-banner')?.remove();
  signOutSP();
}

function _renderPinScreen() {
  const setup = document.getElementById('screen-setup');
  setup.classList.add('active');
  setup.innerHTML = `
  <div id="pin-screen" style="height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px;background:#08090a;">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:48px;">
      <div style="font-size:32px">🏁</div>
      <div>
        <div style="font-size:20px;font-weight:600;color:#fff;letter-spacing:-0.5px">StintPro</div>
        <div style="font-size:12px;color:#444;margin-top:2px">Karting Strategy</div>
      </div>
    </div>
    <div style="background:#13141a;border:0.5px solid #1e1f25;border-radius:16px;padding:32px 28px;width:100%;max-width:320px;text-align:center;">
      <div style="font-size:14px;color:var(--text-2);margin-bottom:24px;font-family:sans-serif">Introduce el PIN de acceso</div>
      <div id="pin-dots" style="display:flex;justify-content:center;gap:14px;margin-bottom:28px;">
        <div class="pin-dot"></div><div class="pin-dot"></div><div class="pin-dot"></div><div class="pin-dot"></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px;">
        ${[1,2,3,4,5,6,7,8,9].map(n=>`<button class="pin-btn" onclick="_pinKey('${n}')">${n}</button>`).join('')}
        <button class="pin-btn pin-btn-ghost" onclick="_pinKey('←')">←</button>
        <button class="pin-btn" onclick="_pinKey('0')">0</button>
        <button class="pin-btn pin-btn-ghost" onclick="_pinKey('✓')">✓</button>
      </div>
      <div id="pin-error" style="font-size:12px;color:#ef4444;min-height:18px;font-family:sans-serif;margin-top:4px;"></div>
    </div>
  </div>
  <style>
    .pin-dot{width:12px;height:12px;border-radius:50%;background:#1e1f25;border:1.5px solid #2a2b30;transition:all .15s;}
    .pin-dot.filled{background:#F5A623;border-color:#F5A623;}
    .pin-btn{background:#1a1b22;border:0.5px solid #252630;border-radius:10px;color:#d0d2db;font-size:20px;font-weight:500;padding:16px 0;cursor:pointer;font-family:monospace;transition:all .1s;}
    .pin-btn:hover{background:#23242e;border-color:#3a3b45;}
    .pin-btn:active{transform:scale(0.94);background:#2a2b38;}
    .pin-btn-ghost{color:var(--text-2);font-size:16px;}
  </style>`;

  window._pinValue = '';
}

function _pinKey(k) {
  const err = document.getElementById('pin-error');
  if (err) err.textContent = '';

  if (k === '←') {
    window._pinValue = window._pinValue.slice(0, -1);
  } else if (k === '✓') {
    _pinSubmit();
    return;
  } else {
    if (window._pinValue.length >= 4) return;
    window._pinValue += k;
    if (window._pinValue.length === 4) {
      setTimeout(_pinSubmit, 120);
    }
  }
  _pinUpdateDots();
}

function _pinUpdateDots() {
  const dots = document.querySelectorAll('.pin-dot');
  dots.forEach((d, i) => {
    d.classList.toggle('filled', i < window._pinValue.length);
  });
}

function _pinSubmit() {
  if (window._pinValue === _ACCESS_PIN) {
    localStorage.setItem(_PIN_KEY, _ACCESS_PIN);
    document.getElementById('screen-setup').innerHTML = '';
    renderSetup();
  } else {
    const err = document.getElementById('pin-error');
    if (err) err.textContent = 'PIN incorrecto';
    const dots = document.querySelectorAll('.pin-dot');
    dots.forEach(d => { d.style.background = '#ef4444'; d.style.borderColor = '#ef4444'; });
    setTimeout(() => {
      window._pinValue = '';
      _pinUpdateDots();
      dots.forEach(d => { d.style.background = ''; d.style.borderColor = ''; });
    }, 600);
  }
}
