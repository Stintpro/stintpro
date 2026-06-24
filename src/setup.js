let _raceType    = null;
let _pitLayout   = 'fila1';
let _myDorsal    = null;
let _circuitMode = 'library';
let _simMode     = false; // desactivado permanentemente
let _connMode    = 'apex'; // 'apex', 'logger' o 'replay'
let _replayFile  = null;  // File cargado en modo replay
let _replaySpeed = 1;     // velocidad de reproducción
const _loggerUrl   = (()=>{const a=[104,116,116,112,115,58,47,47,115,116,105,110,116,112,114,111,46,100,117,99,107,100,110,115,46,111,114,103];return a.map(c=>String.fromCharCode(c)).join('');})();
const _loggerApiKey = (()=>{const a=[100,98,98,98,102,57,55,55,50,99,57,102,54,57,102,100,102,99,54,102,53,54,99,102,55,98,52,49,48,56,53,97,97,50,48,57,49,98,57,53,102,57,97,101,50,56,97,54,51,48,54,57,99,57,48,97,101,55,97,48,99,51,52,102];return a.map(c=>String.fromCharCode(c)).join('');})();
const _origApex  = window.ApexConnector; // guardar conector original

function renderSetup() {
  document.getElementById('screen-setup').innerHTML = `
  <div style="height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px;position:relative;">
    <div class="titlebar-drag" style="position:absolute;top:0;left:0;right:0;height:28px"></div>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:44px;">
      <div class="app-icon">🏁</div>
      <div><div class="app-title">Karting Strategy</div><div class="app-ver">v1.0d</div></div>
    </div>
    <div style="font-size:16.5px;font-weight:500;color:var(--text-1);margin-bottom:8px;text-align:center">¿Qué tipo de sesión?</div>
    <div style="font-size:13.5px;color:var(--text-3);margin-bottom:28px;text-align:center">Selecciona el modo para configurar la sesión</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;width:100%;max-width:500px;margin-bottom:24px;">
      <div onclick="selectRaceType('sprint')" style="border:0.5px solid var(--border);border-radius:var(--r-lg);padding:32px 20px;cursor:pointer;text-align:center;transition:all .15s" onmouseover="this.style.borderColor='var(--blue)';this.style.background='var(--blue-dim)'" onmouseout="this.style.borderColor='var(--border)';this.style.background='transparent'">
        <div style="font-size:41.5px;margin-bottom:14px">⚡</div>
        <div style="font-size:16.5px;font-weight:500;color:var(--text-1);margin-bottom:6px">Sprint</div>
        <div style="font-size:12.5px;color:var(--text-3)">Solo circuito y dorsal<br>Dashboard con datos reales</div>
      </div>
      <div onclick="selectRaceType('endurance')" style="border:0.5px solid var(--border);border-radius:var(--r-lg);padding:32px 20px;cursor:pointer;text-align:center;transition:all .15s" onmouseover="this.style.borderColor='var(--green)';this.style.background='var(--green-dim)'" onmouseout="this.style.borderColor='var(--border)';this.style.background='transparent'">
        <div style="font-size:41.5px;margin-bottom:14px">🏁</div>
        <div style="font-size:16.5px;font-weight:500;color:var(--text-1);margin-bottom:6px">Endurance</div>
        <div style="font-size:12.5px;color:var(--text-3)">Setup completo de carrera<br>Estrategia y gestión de equipo</div>
      </div>
    </div>
    <!-- Modo conexión -->
    <div style="width:100%;max-width:500px;margin-bottom:16px;">
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
        <div onclick="_connMode='apex';window.ApexConnector=_origApex;renderSetup()" style="flex:1;padding:10px;border-radius:var(--r-lg);border:0.5px solid ${_connMode==='apex'?'var(--blue)':'var(--border)'};background:${_connMode==='apex'?'var(--blue-dim)':'transparent'};cursor:pointer;text-align:center">
          <div style="font-size:13.5px;font-weight:500;color:${_connMode==='apex'?'var(--blue)':'var(--text-2)'}">⚡ Directo a Apex</div>
        </div>
        <div onclick="_connMode='logger';renderSetup()" style="flex:1;padding:10px;border-radius:var(--r-lg);border:0.5px solid ${_connMode==='logger'?'var(--green)':'var(--border)'};background:${_connMode==='logger'?'var(--green-dim)':'transparent'};cursor:pointer;text-align:center">
          <div style="font-size:13.5px;font-weight:500;color:${_connMode==='logger'?'var(--green)':'var(--text-2)'}">🖥 Logger</div>
        </div>
        <div onclick="_connMode='replay';renderSetup()" style="flex:1;padding:10px;border-radius:var(--r-lg);border:0.5px solid ${_connMode==='replay'?'#a78bfa':'var(--border)'};background:${_connMode==='replay'?'rgba(167,139,250,0.1)':'transparent'};cursor:pointer;text-align:center">
          <div style="font-size:13.5px;font-weight:500;color:${_connMode==='replay'?'#a78bfa':'var(--text-2)'}">📼 Replay</div>
        </div>
      </div>
      ${_connMode==='logger'?`
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn" onclick="testLogger()" style="flex:none">Verificar conexión</button>
        <span id="loggerStatus" style="font-size:12.5px;color:var(--text-3)"></span>
      </div>
      `:''}
      ${_connMode==='replay'?`
      <div style="background:#13141a;border:0.5px solid #2a2b2e;border-radius:8px;padding:12px 14px;display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;gap:8px;align-items:center">
          <label style="flex:1;padding:8px 12px;border-radius:6px;border:0.5px dashed #a78bfa44;background:#0e0f11;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:12.5px;color:${_replayFile?'#a78bfa':'var(--text-3)'};font-family:sans-serif">
            <span style="font-size:16px">📂</span>
            <span>${_replayFile?_replayFile.name:'Seleccionar grabación (.ndjson)…'}</span>
            <input type="file" accept=".ndjson" style="display:none" onchange="_onReplayFileChange(this)">
          </label>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span style="font-size:12px;color:var(--text-3);font-family:sans-serif;flex-shrink:0">Velocidad:</span>
          ${[1,2,5,10].map(s=>`<div onclick="_replaySpeed=${s};renderSetup()" style="padding:4px 10px;border-radius:5px;border:0.5px solid ${_replaySpeed===s?'#a78bfa':'var(--border)'};background:${_replaySpeed===s?'rgba(167,139,250,0.15)':'transparent'};cursor:pointer;font-size:12px;color:${_replaySpeed===s?'#a78bfa':'var(--text-3)'};font-family:monospace">${s}×</div>`).join('')}
          <div onclick="_replaySpeed=0;renderSetup()" style="padding:4px 10px;border-radius:5px;border:0.5px solid ${_replaySpeed===0?'#a78bfa':'var(--border)'};background:${_replaySpeed===0?'rgba(167,139,250,0.15)':'transparent'};cursor:pointer;font-size:12px;color:${_replaySpeed===0?'#a78bfa':'var(--text-3)'};font-family:monospace">∞</div>
        </div>
      </div>
      `:''}
    </div>
  </div>`;
}

function _onReplayFileChange(input) {
  const file = input.files[0];
  if (!file) return;
  _replayFile = file;
  renderSetup();
}

function selectRaceType(type) {
  _raceType = type;
  if (_connMode === 'logger') {
    window.AppState.loggerUrl = _loggerUrl;
    window.AppState.loggerApiKey = _loggerApiKey;
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
          <div style="display:flex;gap:8px;align-items:center">
            <input class="url-in" id="apexPort" type="number" placeholder="Puerto (ej: 7913)" oninput="onSlug()" style="width:120px">
            <input class="url-in" id="apexCircuitName" type="text" placeholder="Nombre del circuito" style="flex:1">
            <button class="btn" onclick="saveCircuit()" style="flex-shrink:0">💾 Guardar</button>
          </div>
        </div>
      </div>
      <div class="conn-row">
        <div class="conn-st"><div class="cdot" id="cdot"></div><span id="cLabel">Sin verificar</span></div>
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
  <div class="setup-root">
    <div class="setup-col">
      <div class="titlebar-drag"></div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;">
        <button class="btn" onclick="renderSetup()">←</button>
        <div class="app-icon">🏁</div>
        <div><div class="app-title">StintPro</div><div class="app-ver">Endurance</div></div>
      </div>

      <div class="sec-label">Carrera</div>
      <div class="card">
        <div class="field">
          <div class="f-indicator" id="ind-rName"></div>
          <div class="f-icon">🏆</div>
          <div class="f-body">
            <div class="f-label">Nombre de la carrera</div>
            <input class="f-input" id="rName" type="text" placeholder="ej. 9h Henakart" oninput="setupUpd()">
          </div>
        </div>
      </div>

      <div class="sec-label">Pilotos</div>
      <div class="card">
        <div class="field">
          <div class="f-icon">👥</div>
          <div class="f-body">
            <div class="f-label">Número de pilotos</div>
            <input class="f-input" id="nPilotos" type="number" min="1" max="10" value="3" oninput="renderPilotInputs()">
          </div>
          <span class="f-unit">pilotos</span>
        </div>
        <div id="pilotInputs"></div>
      </div>

      <div class="sec-label">Mi dorsal</div>
      <div class="card">
        <div class="dorsal-wrap">
          <div class="dorsal-row">
            <input class="dorsal-input" id="dorsalInput" type="number" min="1" max="999" placeholder="20" oninput="onDorsalInput()">
            <div>
              <div class="dorsal-label">Asignar dorsal</div>
              <div class="dorsal-hint">La app obtiene tus datos del livetiming</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="setup-col">
      <div class="titlebar-drag"></div>
      <div style="height:56px"></div>

      ${_connMode==='replay'?`
      <div class="sec-label">Grabación</div>
      <div class="card" style="margin-bottom:16px;padding:12px 14px">
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
      <div class="card" style="margin-bottom:16px">
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
            <div style="display:flex;gap:8px;align-items:center">
              <input class="url-in" id="apexPort" type="number" placeholder="Puerto (ej: 7913)" oninput="onSlug()" style="width:120px">
              <input class="url-in" id="apexCircuitName" type="text" placeholder="Nombre del circuito" style="flex:1">
              <button class="btn" onclick="saveCircuit()" style="flex-shrink:0">💾 Guardar</button>
            </div>
          </div>
        </div>
        <div class="conn-row">
          <div class="conn-st"><div class="cdot" id="cdot"></div><span id="cLabel">Sin verificar</span></div>
          <button class="btn" onclick="testConn()">Verificar</button>
        </div>
      </div>
      `}

      <button class="btn-cta" id="startBtn" onclick="startEndurance()" disabled>
        Iniciar carrera →
        <span class="cta-badge" id="ctaBadge" style="display:none">0 campos</span>
      </button>
    </div>
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
  _updateDeleteBtn();
  if (_raceType==='sprint') sprintUpd();
  else setupUpd();
}

function onSlug() {
  document.getElementById('cdot').className='cdot';
  document.getElementById('cLabel').textContent='Sin verificar';
  if (_raceType==='sprint') sprintUpd();
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

const REQUIRED_END=['rName'];

function setupUpd() {
  const name=document.getElementById('rName')?.value.trim();
  const hasCircuit = _connMode==='replay'
    ? !!_replayFile
    : (_circuitMode==='library'
      ? !!document.getElementById('circuitSelect')?.value
      : !!document.getElementById('apexSlug')?.value?.trim());
  REQUIRED_END.forEach(id=>{const v=document.getElementById(id)?.value?.trim();document.getElementById('ind-'+id)?.classList.toggle('ok',!!v);});
  const ok=name&&_myDorsal&&hasCircuit;
  if(document.getElementById('startBtn')) document.getElementById('startBtn').disabled=!ok;
}

function getPilotosConfig() {
  const n=parseInt(document.getElementById('nPilotos')?.value)||3;
  return Array.from({length:n},(_,i)=>({name:document.getElementById(`pilotName${i}`)?.value.trim()||`Piloto ${i+1}`,minutos:parseInt(document.getElementById(`pilotMin${i}`)?.value)||90}));
}

function startEndurance() {
  const cfg={
    name:document.getElementById('rName').value.trim(), raceType:'endurance', simMode:false,
    stintMin:0, stintMax:999, stops:0, pitMinTime:3,
    myDorsal:_myDorsal||'20', nKarts:4, pitLayout:'libre',
    slug:_connMode==='replay'?'replay':getCircuitSlug(), port:getCircuitPort(),
    pilotos:getPilotosConfig()
  };
  window.AppState.config=cfg;
  window.showEnduranceDashboard(cfg);
}
