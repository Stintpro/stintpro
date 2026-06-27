// PIN de acceso — cambia este valor para proteger la app
const _ACCESS_PIN = '2712';
const _PIN_KEY    = 'stintpro_unlocked';

document.addEventListener('DOMContentLoaded', async () => {
  await window.CircuitDB.loadFromSupabase();
  if (localStorage.getItem(_PIN_KEY) === _ACCESS_PIN) {
    renderSetup();
  } else {
    _renderPinScreen();
  }
});

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
      <div style="font-size:14px;color:#666;margin-bottom:24px;font-family:sans-serif">Introduce el PIN de acceso</div>
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
    .pin-dot.filled{background:#5b8dee;border-color:#5b8dee;}
    .pin-btn{background:#1a1b22;border:0.5px solid #252630;border-radius:10px;color:#d0d2db;font-size:20px;font-weight:500;padding:16px 0;cursor:pointer;font-family:monospace;transition:all .1s;}
    .pin-btn:hover{background:#23242e;border-color:#3a3b45;}
    .pin-btn:active{transform:scale(0.94);background:#2a2b38;}
    .pin-btn-ghost{color:#666;font-size:16px;}
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
