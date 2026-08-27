let _raceType    = null;
let _pitLayout   = 'fila1';
let _myDorsal    = null;
let _circuitMode = 'library';
let _simMode     = false; // desactivado permanentemente
let _connMode    = 'apex'; // 'apex', 'logger' o 'replay'
let _replayFile  = null;  // File cargado en modo replay
let _replaySpeed = 1;     // velocidad de reproducción
let _slugFetchTimer = null; // debounce del fetch de auto-detección de puerto
let _trackDirection = 'normal'; // 'normal' o 'inverso' — solo relevante en circuitos con CircuitDB.hasDirectionVariants
const _loggerUrl   = (()=>{const a=[104,116,116,112,115,58,47,47,115,116,105,110,116,112,114,111,46,100,117,99,107,100,110,115,46,111,114,103];return a.map(c=>String.fromCharCode(c)).join('');})();
// La API key ya NO se incrusta en el cliente: la app autentica el logger con el
// JWT de Supabase (ver logger-connector._authHeaders). Vacío a propósito.
const _loggerApiKey = '';
const _origApex  = window.ApexConnector; // guardar conector original

function renderSetup() {
  if(!window._enRaceResumeDismissed){
    const _savedRace=(typeof _enLoadRaceState==='function')?_enLoadRaceState():null;
    if(_savedRace&&!_savedRace.finished){
      _renderResumeBanner(_savedRace);
      return;
    }
  }
  document.getElementById('screen-setup').innerHTML = `
  <div style="height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px;position:relative;">
    <div class="titlebar-drag" style="position:absolute;top:0;left:0;right:0;height:28px"></div>

    <div style="margin-bottom:48px;text-align:center;">
      <div style="font-family:'JetBrains Mono',monospace;font-size:15px;font-weight:700;color:#F5A623;letter-spacing:0.12em;margin-bottom:6px;">STINTPRO</div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#2A3848;letter-spacing:0.1em;">KARTING STRATEGY INTELLIGENCE</div>
    </div>

    <div style="width:100%;max-width:480px;margin-bottom:20px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#F5A623;letter-spacing:0.1em;">01</span>
        <span style="font-size:12px;color:var(--text-2);font-weight:500;">Conexión</span>
      </div>
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;">
        <div onclick="_connMode='apex';window.ApexConnector=_origApex;renderSetup()" style="flex:1;padding:9px;border-radius:3px;border:1px solid ${_connMode==='apex'?'#F5A623':'var(--border)'};background:${_connMode==='apex'?'rgba(245,166,35,0.08)':'transparent'};cursor:pointer;text-align:center;transition:all .15s;">
          <div style="font-size:12px;font-weight:500;color:${_connMode==='apex'?'#F5A623':'var(--text-3)'};">⚡ Directo a Apex</div>
        </div>
        <div onclick="_connMode='logger';renderSetup()" style="flex:1;padding:9px;border-radius:3px;border:1px solid ${_connMode==='logger'?'#F5A623':'var(--border)'};background:${_connMode==='logger'?'rgba(245,166,35,0.08)':'transparent'};cursor:pointer;text-align:center;transition:all .15s;">
          <div style="font-size:12px;font-weight:500;color:${_connMode==='logger'?'#F5A623':'var(--text-3)'};">🖥 Logger</div>
        </div>
        <div onclick="_connMode='replay';renderSetup()" style="flex:1;padding:9px;border-radius:3px;border:1px solid ${_connMode==='replay'?'#F5A623':'var(--border)'};background:${_connMode==='replay'?'rgba(245,166,35,0.08)':'transparent'};cursor:pointer;text-align:center;transition:all .15s;">
          <div style="font-size:12px;font-weight:500;color:${_connMode==='replay'?'#F5A623':'var(--text-3)'};">📼 Replay</div>
        </div>
      </div>
      ${_connMode==='logger'?`
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn" onclick="testLogger()" style="flex:none">Verificar conexión</button>
        <span id="loggerStatus" style="font-size:12px;color:var(--text-3)"></span>
      </div>
      `:''}
      ${_connMode==='replay'?`
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:4px;padding:12px 14px;display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;gap:8px;align-items:center">
          <label style="flex:1;padding:8px 12px;border-radius:3px;border:1px dashed rgba(245,166,35,0.25);background:var(--bg);cursor:pointer;display:flex;align-items:center;gap:8px;font-size:12px;color:${_replayFile?'#F5A623':'var(--text-3)'};font-family:var(--font-sans)">
            <span style="font-size:15px">📂</span>
            <span>${_replayFile?_replayFile.name:'Seleccionar grabación (.ndjson)…'}</span>
            <input type="file" accept=".ndjson" style="display:none" onchange="_onReplayFileChange(this)">
          </label>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <span style="font-size:11.5px;color:var(--text-3);flex-shrink:0">Velocidad:</span>
          ${[1,2,5,10].map(s=>`<div onclick="_replaySpeed=${s};renderSetup()" style="padding:4px 10px;border-radius:3px;border:1px solid ${_replaySpeed===s?'#F5A623':'var(--border)'};background:${_replaySpeed===s?'rgba(245,166,35,0.08)':'transparent'};cursor:pointer;font-size:12px;color:${_replaySpeed===s?'#F5A623':'var(--text-3)'};font-family:monospace">${s}×</div>`).join('')}
          <div onclick="_replaySpeed=0;renderSetup()" style="padding:4px 10px;border-radius:3px;border:1px solid ${_replaySpeed===0?'#F5A623':'var(--border)'};background:${_replaySpeed===0?'rgba(245,166,35,0.08)':'transparent'};cursor:pointer;font-size:12px;color:${_replaySpeed===0?'#F5A623':'var(--text-3)'};font-family:monospace">∞</div>
        </div>
      </div>
      `:''}
    </div>

    <div style="width:100%;max-width:480px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#F5A623;letter-spacing:0.1em;">02</span>
        <span style="font-size:12px;color:var(--text-2);font-weight:500;">Tipo de sesión</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div onclick="selectRaceType('sprint')" style="border:1px solid var(--border);border-radius:4px;padding:24px 20px;cursor:pointer;text-align:center;transition:border-color .15s,background .15s;" onmouseover="this.style.borderColor='var(--blue)';this.style.background='var(--blue-dim)'" onmouseout="this.style.borderColor='var(--border)';this.style.background='transparent'">
          <div style="font-size:28px;margin-bottom:10px;">⚡</div>
          <div style="font-size:14px;font-weight:500;color:var(--text-1);margin-bottom:4px;">Sprint</div>
          <div style="font-size:11px;color:var(--text-3);line-height:1.5;">Solo circuito y dorsal<br>Dashboard con datos reales</div>
        </div>
        <div onclick="selectRaceType('endurance')" style="border:1px solid var(--border);border-radius:4px;padding:24px 20px;cursor:pointer;text-align:center;transition:border-color .15s,background .15s;" onmouseover="this.style.borderColor='#F5A623';this.style.background='rgba(245,166,35,0.08)'" onmouseout="this.style.borderColor='var(--border)';this.style.background='transparent'">
          <div style="font-size:28px;margin-bottom:10px;">🏁</div>
          <div style="font-size:14px;font-weight:500;color:var(--text-1);margin-bottom:4px;">Endurance</div>
          <div style="font-size:11px;color:var(--text-3);line-height:1.5;">Setup completo de carrera<br>Estrategia y gestión de equipo</div>
        </div>
      </div>
    </div>
  </div>`;
}

function _renderResumeBanner(snap) {
  const mins = Math.round((Date.now() - snap.ts) / 60000);
  const pilotName = snap.cfg.pilotos?.[snap.en.currentPilot]?.name || '—';
  const circuitName = window.CircuitDB?.list?.find(c => c.slug === snap.cfg.slug)?.name || snap.cfg.slug || '—';
  const n = snap.en.stintHistory.length;
  document.getElementById('screen-setup').innerHTML = `
  <div style="height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px;position:relative;">
    <div class="titlebar-drag" style="position:absolute;top:0;left:0;right:0;height:28px"></div>
    <div style="width:100%;max-width:420px;background:#13141a;border:1px solid rgba(245,166,35,0.35);border-radius:12px;padding:28px 24px;text-align:center;">
      <div style="font-size:28px;margin-bottom:10px;">⚠</div>
      <div style="font-size:15px;font-weight:600;color:var(--text-1);margin-bottom:6px;font-family:sans-serif">Carrera en curso detectada</div>
      <div style="font-size:12.5px;color:var(--text-3);margin-bottom:18px;line-height:1.6;font-family:sans-serif">
        ${_esc(circuitName)} · piloto actual ${_esc(pilotName)}<br>
        ${n} stint${n===1?'':'s'} registrado${n===1?'':'s'} · hace ${mins} min
      </div>
      <div style="display:flex;gap:10px;">
        <button onclick="_enResumeRace()" style="flex:1;padding:11px;border-radius:6px;border:none;background:#F5A623;color:#08090a;font-weight:600;font-size:13px;cursor:pointer;font-family:sans-serif">Reanudar carrera</button>
        <button onclick="_enDiscardRaceState()" style="flex:1;padding:11px;border-radius:6px;border:0.5px solid var(--border);background:transparent;color:var(--text-3);font-size:13px;cursor:pointer;font-family:sans-serif">Descartar</button>
      </div>
    </div>
  </div>`;
}

function _enResumeRace() {
  const snap = _enLoadRaceState();
  if (!snap) { renderSetup(); return; }
  _enApplyRaceState(snap);
}

function _enDiscardRaceState() {
  _enClearRaceState();
  window._enRaceResumeDismissed = true;
  renderSetup();
}

function _onReplayFileChange(input) {
  const file = input.files[0];
  if (!file) return;
  _replayFile = file;
  renderSetup();
}

function selectRaceType(type) {
  _raceType = type;
  window.AppState.loggerUrl    = _loggerUrl;
  window.AppState.loggerApiKey = _loggerApiKey;
  if (_connMode === 'logger') {
    window.ApexConnector = Logger;
  } else if (_connMode === 'replay') {
    window.ReplayConnector.speed = _replaySpeed;
    if (_replayFile) window.ReplayConnector.loadFile(_replayFile);
    window.ApexConnector = window.ReplayConnector;
  } else {
    window.ApexConnector = _origApex;
  }
  if (type === 'sprint') renderSprintSetup();
  else renderEnduranceSetup();
}

// ── SPRINT SETUP ──────────────────────────────────────────────────────────
function renderSprintSetup() {
  document.getElementById('screen-setup').innerHTML = `
  <div style="max-width:520px;margin:0 auto;padding:0 20px;height:100vh;display:flex;flex-direction:column;justify-content:center;gap:0">
    <div class="titlebar-drag" style="flex-shrink:0"></div>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:28px;">
      <button class="btn" onclick="renderSetup()">← Volver</button>
      <div style="display:flex;align-items:center;gap:10px;">
        <div class="app-icon">⚡</div>
        <div><div class="app-title">Sprint</div><div class="app-ver">Sesión rápida</div></div>
      </div>
      ${_simMode?'<span style="font-size:11.5px;padding:2px 8px;border-radius:20px;background:var(--green-dim);color:var(--green-txt);border:0.5px solid var(--green)">SIMULACIÓN</span>':''}
    </div>

    ${_connMode==='replay'?`
    <div class="sec-label">Grabación</div>
    <div class="card" style="margin-bottom:12px;padding:12px 14px">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:20px">📼</span>
        <div>
          <div style="font-size:13px;font-weight:500;color:var(--text-1)">${_replayFile?_replayFile.name:'Sin archivo'}</div>
          <div style="font-size:11px;color:#a78bfa">Modo replay · ${_replaySpeed===0?'instantáneo':_replaySpeed+'×'}</div>
        </div>
      </div>
    </div>
    `:`
    <div class="sec-label">Circuito</div>
    <div class="card" style="margin-bottom:12px">
      <div style="padding:8px 14px;border-bottom:0.5px solid var(--border);display:flex;gap:6px">
        <button class="btn" id="btn-library" onclick="setCircuitMode('library')" style="flex:1;background:var(--blue-dim)">📋 Guardado</button>
        <button class="btn" id="btn-manual"  onclick="setCircuitMode('manual')"  style="flex:1">✏️ URL manual</button>
      </div>
      <div id="circuitLibrarySection" style="padding:8px 14px">
        <div style="display:flex;gap:6px;align-items:center">
          <select class="circuit-select" id="circuitSelect" onchange="onCircuitSelect()" style="flex:1">
            <option value="">— Selecciona circuito —</option>
            ${window.CircuitDB.list.map(c=>`<option value="${c.id}"${c._custom?' data-custom="1"':''}>${c.name}${c._custom?' ✕':''}</option>`).join('')}
          </select>
          <button class="btn" id="btnDeleteCircuit" onclick="deleteCircuit()" style="display:none;color:var(--red,#f55);flex-shrink:0" title="Borrar circuito">🗑</button>
        </div>
      </div>
      <div id="circuitManualSection" style="padding:8px 14px;display:none">
        <div style="display:flex;flex-direction:column;gap:8px">
          <input class="url-in" id="apexSlug" type="text" placeholder="URL del livetiming (ej: https://live.apex-timing.com/rkc/)" oninput="onSlug()" style="width:100%">
          <div style="display:flex;align-items:center;gap:8px">
            <span id="apexPortBadge" style="display:none;font-size:11px;color:#22c55e;background:rgba(34,197,94,0.12);border:0.5px solid rgba(34,197,94,0.35);border-radius:4px;padding:1px 6px;font-family:monospace"></span>
            <span id="apexAdvToggle" onclick="toggleApexAdvanced()" style="font-size:11px;color:var(--text-3);cursor:pointer;user-select:none">▸ Opciones avanzadas</span>
          </div>
          <div id="apexAdvancedSection" style="display:none;flex-direction:column;gap:8px">
            <div style="display:flex;gap:8px;align-items:center">
              <input class="url-in" id="apexPort" type="number" placeholder="Puerto (ej: 7913)" oninput="onSlug()" style="width:120px">
              <input class="url-in" id="apexCircuitName" type="text" placeholder="Nombre del circuito" style="flex:1">
              <button class="btn" onclick="saveCircuit()" style="flex-shrink:0">💾 Guardar</button>
            </div>
          </div>
        </div>
      </div>
      <div class="conn-row">
        <div class="conn-st"><div class="cdot" id="cdot"></div><span id="cLabel">Sin verificar</span><span id="circuit-offset-badge" style="display:none;margin-left:8px;font-size:11px;color:#22c55e;background:rgba(34,197,94,0.12);border:0.5px solid rgba(34,197,94,0.35);border-radius:4px;padding:1px 6px;font-family:monospace"></span><span id="circuit-offset-reset" onclick="_resetOffsetBadge()" style="display:none;margin-left:6px;font-size:11px;color:var(--text-3);cursor:pointer;text-decoration:underline">↻ recalibrar</span></div>
        <button class="btn" onclick="testConn()">Verificar</button>
      </div>
    </div>
    `}

    <div class="sec-label">Mi dorsal</div>
    <div class="card" style="margin-bottom:28px">
      <div class="dorsal-wrap">
        <div class="dorsal-row">
          <input class="dorsal-input" id="dorsalInput" type="number" min="1" max="999" placeholder="20" oninput="onDorsalInput()">
          <div>
            <div class="dorsal-label">Número de dorsal</div>
            <div class="dorsal-hint">Tu dorsal en esta sesión</div>
          </div>
        </div>
      </div>
    </div>

    <button class="btn-cta" id="startBtn" onclick="startSprint()" disabled>Iniciar sesión →</button>
  </div>`;
  // Forzar estado inicial del botón
  setTimeout(sprintUpd, 50);
}

function sprintUpd() {
  const hasCircuit = _connMode==='replay'
    ? !!_replayFile
    : (_circuitMode==='library'
      ? !!document.getElementById('circuitSelect')?.value
      : !!document.getElementById('apexSlug')?.value?.trim());
  const ok = _simMode || (_myDorsal && hasCircuit);
  const btn = document.getElementById('startBtn');
  if (btn) {
    btn.disabled = !ok;
    btn.style.opacity = ok ? '1' : '0.3';
  }
}

function startSprint() {
  const cfg = {
    name: 'Sesión Sprint', raceType:'sprint', simMode: _simMode,
    myDorsal: _myDorsal || '20', nKarts: 4, pitLayout: 'libre',
    slug: _connMode==='replay'?'replay':getCircuitSlug(), port: getCircuitPort(),
    stintMin:0, stintMax:999, stops:0, pitMinTime:0,
    pilotos:[{name:'Yo',minutos:0}], duration:0
  };
  window.AppState.config = cfg;
  window.showSprintDashboard(cfg);
}

// ── ENDURANCE SETUP ───────────────────────────────────────────────────────
function renderEnduranceSetup() {
  document.getElementById('screen-setup').innerHTML = `
  <div style="max-width:520px;margin:0 auto;padding:0 20px;height:100vh;overflow-y:auto;box-sizing:border-box;display:flex;flex-direction:column;justify-content:flex-start;gap:0;padding-top:60px;padding-bottom:32px">
    <div class="titlebar-drag" style="flex-shrink:0;position:fixed;top:0;left:0;right:0;height:28px"></div>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:28px;">
      <button class="btn" onclick="renderSetup()">← Volver</button>
      <div style="display:flex;align-items:center;gap:10px;">
        <div><div class="app-title">STINTPRO</div><div class="app-ver">ENDURANCE</div></div>
      </div>
      ${_simMode?'<span style="font-size:11.5px;padding:2px 8px;border-radius:20px;background:var(--green-dim);color:var(--green-txt);border:0.5px solid var(--green)">SIMULACIÓN</span>':''}
    </div>

    <div class="sec-label">Pilotos</div>
    <div class="card" style="margin-bottom:12px">
      <div class="field">
        <div class="f-icon">👥</div>
        <div class="f-body">
          <div class="f-label">Número de pilotos</div>
        </div>
        <input class="f-input" id="nPilotos" type="number" min="1" max="10" value="3" oninput="renderPilotInputs()" style="width:44px;text-align:center;font-family:var(--font-mono)">
        <span class="f-unit">pilotos</span>
      </div>
      <div style="padding:6px 14px 4px;font-size:10.5px;color:#3E4E62;font-family:var(--font-mono);letter-spacing:0.06em">NOMBRE · TIEMPO MÍNIMO EN PISTA</div>
      <div id="pilotInputs"></div>
    </div>

    <div class="sec-label">Mi dorsal y duración</div>
    <div style="display:flex;gap:12px;margin-bottom:12px">
      <div class="card" style="flex:1;min-width:0">
        <div class="dorsal-wrap">
          <div class="dorsal-row">
            <input class="dorsal-input" id="dorsalInput" type="number" min="1" max="999" placeholder="20" oninput="onDorsalInput()" style="width:64px">
            <div style="min-width:0">
              <div class="dorsal-label">Dorsal</div>
              <div class="dorsal-hint">Del livetiming</div>
            </div>
          </div>
        </div>
      </div>
      <div class="card" style="flex:1;min-width:0">
        <div class="field">
          <div class="f-icon">⏱</div>
          <div class="f-body">
            <div class="f-label">Duración (opcional)</div>
            <div class="f-hint">Ajusta el 1er stint</div>
          </div>
          <input class="f-input" id="raceDurationInput" type="number" min="0" step="0.5" placeholder="2" style="width:36px;text-align:center;font-family:var(--font-mono)">
          <span class="f-unit">h</span>
        </div>
      </div>
    </div>

    ${_connMode==='replay'?`
    <div class="sec-label">Grabación</div>
    <div class="card" style="margin-bottom:12px;padding:12px 14px">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:20px">📼</span>
        <div>
          <div style="font-size:13px;font-weight:500;color:var(--text-1)">${_replayFile?_replayFile.name:'Sin archivo'}</div>
          <div style="font-size:11px;color:#a78bfa">Modo replay · ${_replaySpeed===0?'instantáneo':_replaySpeed+'×'}</div>
        </div>
      </div>
    </div>
    `:`
    <div class="sec-label">Livetiming</div>
    <div class="card" style="margin-bottom:28px">
      <div style="padding:8px 14px;border-bottom:0.5px solid var(--border);display:flex;gap:6px">
        <button class="btn" id="btn-library" onclick="setCircuitMode('library')" style="flex:1;background:var(--blue-dim)">📋 Guardado</button>
        <button class="btn" id="btn-manual"  onclick="setCircuitMode('manual')"  style="flex:1">✏️ URL manual</button>
      </div>
      <div id="circuitLibrarySection" style="padding:8px 14px">
        <div style="display:flex;gap:6px;align-items:center">
          <select class="circuit-select" id="circuitSelect" onchange="onCircuitSelect()" style="flex:1">
            <option value="">— Selecciona circuito —</option>
            ${window.CircuitDB.list.map(c=>`<option value="${c.id}"${c._custom?' data-custom="1"':''}>${c.name}${c._custom?' ✕':''}</option>`).join('')}
          </select>
          <button class="btn" id="btnDeleteCircuit" onclick="deleteCircuit()" style="display:none;color:var(--red,#f55);flex-shrink:0" title="Borrar circuito">🗑</button>
        </div>
        <div id="trackDirectionRow" style="display:none;margin-top:8px;gap:6px;align-items:center">
          <span style="font-size:11px;color:var(--text-3);flex-shrink:0">Sentido:</span>
          <div id="trackDir-normal" onclick="setTrackDirection('normal')" style="flex:1;padding:6px;border-radius:3px;border:1px solid ${_trackDirection==='normal'?'#F5A623':'var(--border)'};background:${_trackDirection==='normal'?'rgba(245,166,35,0.08)':'transparent'};cursor:pointer;text-align:center;font-size:11.5px;color:${_trackDirection==='normal'?'#F5A623':'var(--text-3)'}">Normal</div>
          <div id="trackDir-inverso" onclick="setTrackDirection('inverso')" style="flex:1;padding:6px;border-radius:3px;border:1px solid ${_trackDirection==='inverso'?'#F5A623':'var(--border)'};background:${_trackDirection==='inverso'?'rgba(245,166,35,0.08)':'transparent'};cursor:pointer;text-align:center;font-size:11.5px;color:${_trackDirection==='inverso'?'#F5A623':'var(--text-3)'}">Inverso</div>
        </div>
      </div>
      <div id="circuitManualSection" style="padding:8px 14px;display:none">
        <div style="display:flex;flex-direction:column;gap:8px">
          <input class="url-in" id="apexSlug" type="text" placeholder="URL del livetiming (ej: https://live.apex-timing.com/rkc/)" oninput="onSlug()" style="width:100%">
          <div style="display:flex;align-items:center;gap:8px">
            <span id="apexPortBadge" style="display:none;font-size:11px;color:#22c55e;background:rgba(34,197,94,0.12);border:0.5px solid rgba(34,197,94,0.35);border-radius:4px;padding:1px 6px;font-family:monospace"></span>
            <span id="apexAdvToggle" onclick="toggleApexAdvanced()" style="font-size:11px;color:var(--text-3);cursor:pointer;user-select:none">▸ Opciones avanzadas</span>
          </div>
          <div id="apexAdvancedSection" style="display:none;flex-direction:column;gap:8px">
            <div style="display:flex;gap:8px;align-items:center">
              <input class="url-in" id="apexPort" type="number" placeholder="Puerto (ej: 7913)" oninput="onSlug()" style="width:120px">
              <input class="url-in" id="apexCircuitName" type="text" placeholder="Nombre del circuito" style="flex:1">
              <button class="btn" onclick="saveCircuit()" style="flex-shrink:0">💾 Guardar</button>
            </div>
          </div>
        </div>
      </div>
      <div class="conn-row">
        <div class="conn-st"><div class="cdot" id="cdot"></div><span id="cLabel">Sin verificar</span><span id="circuit-offset-badge" style="display:none;margin-left:8px;font-size:11px;color:#22c55e;background:rgba(34,197,94,0.12);border:0.5px solid rgba(34,197,94,0.35);border-radius:4px;padding:1px 6px;font-family:monospace"></span><span id="circuit-offset-reset" onclick="_resetOffsetBadge()" style="display:none;margin-left:6px;font-size:11px;color:var(--text-3);cursor:pointer;text-decoration:underline">↻ recalibrar</span></div>
        <button class="btn" onclick="testConn()">Verificar</button>
      </div>
    </div>
    `}

    <button class="btn-cta" id="startBtn" onclick="startEndurance()" disabled>Iniciar carrera →</button>
  </div>`;

  renderPilotInputs(); setupUpd();
}

// ── Funciones compartidas ─────────────────────────────────────────────────
function renderPilotInputs() {
  const n=parseInt(document.getElementById('nPilotos')?.value)||3;
  document.getElementById('pilotInputs').innerHTML = Array.from({length:n},(_,i)=>`
    <div class="field" style="border-top:0.5px solid var(--border)">
      <div class="f-icon" style="font-size:12.5px;font-weight:500;color:var(--text-3)">${i+1}</div>
      <input class="f-input" style="flex:1" id="pilotName${i}" type="text" placeholder="Piloto ${i+1}">
      <input class="f-input" style="width:44px;font-family:var(--font-mono);text-align:center" id="pilotMin${i}" type="number" min="1" placeholder="90">
      <span class="f-unit">min</span>
    </div>`).join('');
}

function onDorsalInput() {
  const v=document.getElementById('dorsalInput')?.value.trim();
  _myDorsal=v&&!isNaN(v)?v:null;
  if (_raceType==='sprint') sprintUpd(); else setupUpd();
}

function setPitLayout(l) {
  _pitLayout=l;
  ['fila1','fila2','libre'].forEach(x=>document.getElementById('lo-'+x)?.classList.toggle('active',x===l));
  setupUpd();
}

function applyPreset(mn,mx,st,pit) {
  ['sMin','sMax','nStops','pitMinTime'].forEach((id,i)=>{document.getElementById(id).value=[mn,mx,st,pit][i];});
  setupUpd();
}

function setCircuitMode(mode) {
  _circuitMode=mode;
  document.getElementById('circuitLibrarySection').style.display=mode==='library'?'block':'none';
  document.getElementById('circuitManualSection').style.display=mode==='manual'?'block':'none';
  document.getElementById('btn-library').style.background=mode==='library'?'var(--blue-dim)':'transparent';
  document.getElementById('btn-manual').style.background=mode==='manual'?'var(--blue-dim)':'transparent';
  document.getElementById('cdot').className='cdot';
  document.getElementById('cLabel').textContent='Sin verificar';
  if (_raceType==='sprint') sprintUpd();
}

function onCircuitSelect() {
  const id=document.getElementById('circuitSelect')?.value;
  const circ=window.CircuitDB.list.find(x=>x.id===id);
  const dot=document.getElementById('cdot'), lbl=document.getElementById('cLabel');
  if(circ){dot.className='cdot ok';lbl.textContent=circ.name+' — listo';}
  else {dot.className='cdot';lbl.textContent='Sin verificar';}
  _trackDirection='normal'; // circuito nuevo → resetea el sentido al por defecto
  const dirRow=document.getElementById('trackDirectionRow');
  if(dirRow)dirRow.style.display=(circ&&window.CircuitDB.hasDirectionVariants(circ.slug))?'flex':'none';
  _updateOffsetBadge(circ);
  _updateDeleteBtn();
  if (_raceType==='sprint') sprintUpd();
  else setupUpd();
}

// Prioridad: calibración propia de este dispositivo (más reciente/afinada) >
// offset conocido de fábrica para el circuito+sentido (listo en cualquier
// dispositivo nuevo, incluido uno que nunca ha calibrado nada).
function _updateOffsetBadge(circ) {
  const badge=document.getElementById('circuit-offset-badge');
  const reset=document.getElementById('circuit-offset-reset');
  if(!badge)return;
  if(!circ){badge.style.display='none';if(reset)reset.style.display='none';return;}
  const key=window.CircuitDB.pitOffsetKey(circ.slug,_trackDirection);
  const own=localStorage.getItem(key);
  // Misma resolución que usan la carrera y el toggle de sentido (analysis.js): si
  // el valor propio no pasa el rango de cordura, el badge debe enseñar el que se
  // va a usar de verdad —el de fábrica— y no mentir con la calibración corrupta.
  const saved=_enResolveDirectionOffset(own, window.CircuitDB.getKnownOffset(circ.slug,_trackDirection));
  if(saved!=null){badge.textContent='✓ offset '+saved.toFixed(0)+'s';badge.style.display='';}
  else{badge.style.display='none';}
  // Solo se ofrece recalibrar cuando hay una medición propia de ESTE dispositivo
  // guardada (no tiene sentido "recalibrar" el valor de fábrica de solo lectura).
  if(reset)reset.style.display=(own!=null)?'':'none';
}

// Borra la calibración propia del dispositivo para este circuito+sentido, para
// que vuelva a caer en el offset de fábrica (o sin calibrar) y se remida limpio
// en la próxima sesión. Pensado para dispositivos donde una calibración pasada
// quedó contaminada (tráfico en pit exit, prueba/demo) y no hay consola a mano
// para borrar el localStorage a mano (p.ej. iPad).
function _resetOffsetBadge() {
  const id=document.getElementById('circuitSelect')?.value;
  const circ=window.CircuitDB.list.find(x=>x.id===id);
  if(!circ)return;
  localStorage.removeItem(window.CircuitDB.pitOffsetKey(circ.slug,_trackDirection));
  _updateOffsetBadge(circ);
}

function setTrackDirection(dir) {
  _trackDirection=dir;
  // Actualiza solo el toggle + badge (sin re-render completo, para no perder
  // lo ya rellenado en el resto del formulario: pilotos, dorsal, etc.)
  ['normal','inverso'].forEach(d=>{
    const el=document.getElementById('trackDir-'+d);
    if(!el)return;
    const active=d===_trackDirection;
    el.style.borderColor=active?'#F5A623':'var(--border)';
    el.style.background=active?'rgba(245,166,35,0.08)':'transparent';
    el.style.color=active?'#F5A623':'var(--text-3)';
  });
  const id=document.getElementById('circuitSelect')?.value;
  const circ=window.CircuitDB.list.find(x=>x.id===id);
  _updateOffsetBadge(circ);
}

function onSlug() {
  document.getElementById('cdot').className='cdot';
  document.getElementById('cLabel').textContent='Sin verificar';
  if (_raceType==='sprint') sprintUpd();
  clearTimeout(_slugFetchTimer);
  const badge=document.getElementById('apexPortBadge');
  if (badge) badge.style.display='none';
  const slug=getCircuitSlug();
  if (!slug) return;
  _slugFetchTimer=setTimeout(()=>_autoDetectPort(slug), 500);
}

async function _autoDetectPort(slug) {
  const portInput=document.getElementById('apexPort');
  const badge=document.getElementById('apexPortBadge');
  if (!portInput) return;
  try {
    // apex-timing.com no manda CORS → se pasa por nuestro proxy (api/apex-proxy.js)
    const res=await fetch('https://stintpro.vercel.app/api/apex-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'config', slug }),
      signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined,
    });
    const { text }=await res.json();
    const m=(text||'').match(/var configPort\s*=\s*(\d+)/);
    if (m && getCircuitSlug()===slug) {
      portInput.value=m[1];
      if (badge) { badge.textContent='✓ puerto detectado: '+m[1]; badge.style.display=''; }
      return;
    }
  } catch(e) {}
  // No se pudo autodetectar el puerto: despliega opciones avanzadas para introducirlo a mano
  if (getCircuitSlug()===slug) toggleApexAdvanced(true);
}

function toggleApexAdvanced(forceOpen) {
  const sec=document.getElementById('apexAdvancedSection');
  const toggle=document.getElementById('apexAdvToggle');
  if (!sec) return;
  const open = typeof forceOpen==='boolean' ? forceOpen : sec.style.display==='none';
  sec.style.display = open ? 'flex' : 'none';
  if (toggle) toggle.textContent = open ? '▾ Opciones avanzadas' : '▸ Opciones avanzadas';
}

async function testLogger() {
  const el = document.getElementById('loggerStatus');
  el.textContent = '⏳ Verificando...';
  el.style.color = 'var(--text-3)';
  const result = await Logger.test(_loggerUrl, _loggerApiKey);
  if (result && Array.isArray(result)) {
    const active = result.filter(c => c.sessionActive).length;
    const connected = result.filter(c => c.connected).length;
    el.innerHTML = `✅ Conectado — ${connected} circuitos, ${active} sesiones activas`;
    el.style.color = 'var(--green)';
  } else if (result) {
    el.textContent = '✅ Logger accesible';
    el.style.color = 'var(--green)';
  } else {
    el.textContent = '❌ No se pudo conectar al logger';
    el.style.color = 'var(--red)';
  }
}

function testConn() {
  const slug=getCircuitSlug();
  const dot=document.getElementById('cdot'), lbl=document.getElementById('cLabel');
  if(!slug){lbl.textContent='Selecciona o introduce un circuito';return;}
  dot.className='cdot chk';lbl.textContent='Verificando...';
  setTimeout(()=>{dot.className='cdot ok';lbl.textContent='Endpoint encontrado · listo';},1400);
}

function getCircuitPort() {
  if(_circuitMode==='library'){
    const id=document.getElementById('circuitSelect')?.value;
    return window.CircuitDB.list.find(x=>x.id===id)?.port||7913;
  }
  return parseInt(document.getElementById('apexPort')?.value)||7913;
}

function saveCircuit() {
  const slug=getCircuitSlug();
  const port=getCircuitPort();
  const name=document.getElementById('apexCircuitName')?.value.trim()||slug;
  if(!slug||!port){alert('Introduce URL y puerto antes de guardar');return;}
  window.CircuitDB.save(name, slug, port);
  // Recargar selector completo
  _refreshCircuitSelect();
  // Seleccionar el recién guardado
  const sel=document.getElementById('circuitSelect');
  if(sel){sel.value='custom_'+slug; onCircuitSelect();}
}

function deleteCircuit() {
  const sel=document.getElementById('circuitSelect');
  if(!sel||!sel.value)return;
  const circ=window.CircuitDB.list.find(x=>x.id===sel.value);
  if(!circ||!circ._custom){alert('Solo se pueden borrar circuitos añadidos manualmente.');return;}
  if(!confirm(`¿Borrar "${circ.name}"?`))return;
  window.CircuitDB.remove(circ.slug);
  _refreshCircuitSelect();
}

function _refreshCircuitSelect() {
  const sel=document.getElementById('circuitSelect');
  if(!sel)return;
  sel.innerHTML='<option value="">— Selecciona circuito —</option>'+
    window.CircuitDB.list.map(c=>`<option value="${c.id}"${c._custom?' data-custom="1"':''}>${c.name}${c._custom?' ✕':''}</option>`).join('');
  _updateDeleteBtn();
}

function _updateDeleteBtn() {
  const sel=document.getElementById('circuitSelect');
  const btn=document.getElementById('btnDeleteCircuit');
  if(!btn||!sel)return;
  const circ=window.CircuitDB.list.find(x=>x.id===sel.value);
  btn.style.display=circ&&circ._custom?'inline-flex':'none';
}

function getCircuitSlug() {
  if(_circuitMode==='library'){
    const id=document.getElementById('circuitSelect')?.value;
    return window.CircuitDB.list.find(x=>x.id===id)?.slug||'';
  }
  const raw=document.getElementById('apexSlug')?.value.trim()||'';
  // Extraer slug de URL completa o usar directamente si ya es un slug
  // Soporta: https://live.apex-timing.com/rkc/
  //          https://www.apex-timing.com/live-timing/rkc/
  //          rkc
  const m=raw.match(/apex-timing\.com\/(?:live-timing\/|)([^/?#]+)/i);
  return m?m[1]:raw;
}

function renderLoIcons() {
  const mk=(c,r)=>{let h=`<div style="display:flex;flex-direction:column;gap:2px;align-items:center">`;for(let i=0;i<Math.min(r,3);i++){h+=`<div style="display:flex;gap:2px">`;for(let j=0;j<c;j++)h+=`<div style="width:${c===1?10:6}px;height:4px;border-radius:1px;background:${i===0?'var(--blue)':'var(--border-md)'};opacity:${i===0?1:0.5}"></div>`;h+=`</div>`;}return h+`</div>`;};
  if(document.getElementById('ic-fila1')){document.getElementById('ic-fila1').innerHTML=mk(1,4);document.getElementById('ic-fila2').innerHTML=mk(2,3);document.getElementById('ic-libre').innerHTML=mk(4,2);}
}

function renderPitPreview() {
  const n=parseInt(document.getElementById('nKarts')?.value)||0;
  const el=document.getElementById('pitPreview');
  if(!el||!n){if(el)el.innerHTML='';return;}
  const cols=_pitLayout==='fila1'?1:_pitLayout==='fila2'?2:Math.min(n,4);
  const rows=Math.ceil(n/cols), front=Math.min(cols,n);
  let scene=`<div class="pit-mini-scene">`;
  for(let r=0;r<Math.min(rows,3);r++){scene+=`<div class="pit-mini-row">`;for(let c=0;c<cols;c++){const i=r*cols+c;if(i>=n)break;scene+=`<div class="ps-slot ${r===0?'front':''}">${r===0?'→':''}</div>`;}scene+=`</div>`;}
  scene+=`</div>`;
  el.innerHTML=scene+`<div class="pit-stats"><div class="pit-stat-row">1ª línea: <span class="pit-stat-val">${front} kart${front>1?'s':''}</span></div><div class="pit-stat-row">Acceso directo: <span class="pit-stat-val">${Math.round(front/n*100)}%</span></div></div>`;
}

const REQUIRED_END=[];

function setupUpd() {
  const name=document.getElementById('rName')?.value.trim();
  const hasCircuit = _connMode==='replay'
    ? !!_replayFile
    : (_circuitMode==='library'
      ? !!document.getElementById('circuitSelect')?.value
      : !!document.getElementById('apexSlug')?.value?.trim());
  REQUIRED_END.forEach(id=>{const v=document.getElementById(id)?.value?.trim();document.getElementById('ind-'+id)?.classList.toggle('ok',!!v);});
  const ok=_myDorsal&&hasCircuit;
  if(document.getElementById('startBtn')) document.getElementById('startBtn').disabled=!ok;
}

function getPilotosConfig() {
  const n=parseInt(document.getElementById('nPilotos')?.value)||3;
  return Array.from({length:n},(_,i)=>({name:document.getElementById(`pilotName${i}`)?.value.trim()||`Piloto ${i+1}`,minutos:parseInt(document.getElementById(`pilotMin${i}`)?.value)||90}));
}

function startEndurance() {
  const slug=_connMode==='replay'?'replay':getCircuitSlug();
  const trackDirection=window.CircuitDB.hasDirectionVariants(slug)?_trackDirection:null;
  const cfg={
    name:'Endurance', raceType:'endurance', simMode:false,
    stintMin:10, stintMax:45, stops:0, pitMinTime:3,
    myDorsal:_myDorsal||'20', nKarts:4, pitLayout:'libre',
    slug, port:getCircuitPort(), trackDirection,
    pilotos:getPilotosConfig(),
    // Duración total anunciada de la carrera (horas) — opcional. Permite
    // reconstruir el tiempo real transcurrido del primer stint si el reloj
    // de Apex sincroniza tarde (conexión tardía o inestable al arrancar).
    // Ver _enStintStartFromClock en en-strategy.js.
    duration:parseFloat(document.getElementById('raceDurationInput')?.value)||0
  };
  window.AppState.config=cfg;
  // Pre-poblar calibración: prioriza el offset propio de este dispositivo
  // (localStorage, más reciente/afinado, guardado por sentido si el circuito
  // corre en ambos); si no hay, usa el conocido de fábrica para ese circuito
  // y sentido — así queda listo desde la vuelta 1 aunque sea la primera vez
  // en este dispositivo/navegador.
  const offsetKey=slug&&slug!=='replay'?window.CircuitDB.pitOffsetKey(slug,trackDirection):null;
  const known=slug&&slug!=='replay'?window.CircuitDB.getKnownOffset(slug,trackDirection):undefined;
  // Misma regla que el toggle de sentido de la pestaña Avanzado (analysis.js):
  // lo calibrado en este dispositivo manda sobre el valor de fábrica, y ambos
  // pasan el mismo rango de cordura.
  const savedOffset=_enResolveDirectionOffset(offsetKey?localStorage.getItem(offsetKey):null, known);
  if(savedOffset!=null){
    EnSession.pitOutCalibration=[savedOffset, savedOffset];
  }
  window.showEnduranceDashboard(cfg);
}
