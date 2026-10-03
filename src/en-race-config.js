// ── en-race-config.js — «Configuración de carrera» ──────────────────────────
// Un solo sitio para los datos de la carrera que antes vivían repartidos en la
// fila 1 de Estrategia (box, stint mín/máx, parada, dorsal), la de Mi equipo
// (mínimo por piloto, paradas obligatorias) y la de Avanzado (parada, otra vez).
// Botón en la barra superior → modal con tres bloques → pantalla de
// confirmación con lo que cambia → se aplica todo de una vez y se guarda.
//
// El núcleo (EnRaceConfig) es puro y va con tests (tests/race-config.test.js);
// el resto es el pegamento con el DOM y el estado del panel.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EnRaceConfig = api;
})(typeof window !== 'undefined' ? window : this, function () {

  const MAX_PILOTS = 10;
  const BOX_TYPES = { line: 'Línea', battery: 'Batería', columns: 'Columnas' };

  const int = (v, def, min, max) => {
    const n = parseInt(v, 10);
    if (isNaN(n)) return def;
    return Math.max(min, Math.min(max, n));
  };

  // Valores actuales, desde el estado del panel (cfg = AppState.config, box = EnBox).
  function read(cfg, box) {
    cfg = cfg || {}; box = box || {}; const bc = box.config || {};
    return {
      stintMin: cfg.stintMin || 0,
      stintMax: cfg.stintMax || 0,
      totalStops: box.totalStops || 0,
      pitDuration: box.pitDuration || 120,
      pilotMinTime: box.pilotMinTime || 0,
      duration: cfg.duration || 0,
      boxType: bc.type || 'line',
      boxPositions: bc.positions || 4,
      boxColumns: bc.columns || 2,
      myDorsal: String(cfg.myDorsal == null ? '' : cfg.myDorsal).trim(),
      pilotos: (cfg.pilotos || []).map(p => String((p && p.name) || '').trim()),
    };
  }

  // Lo tecleado en el formulario → valores válidos. `cur` da el valor de
  // respaldo de cada campo vacío o ilegible. Los pilotos conservan su posición
  // (los stints los referencian por índice): un nombre vacío mantiene el que
  // había; solo se descartan los vacíos NUEVOS del final.
  function normalize(form, cur) {
    form = form || {};
    const dur = parseFloat(String(form.duration == null ? '' : form.duration).replace(',', '.'));
    const names = (form.pilotos || []).slice(0, MAX_PILOTS).map((n, i) => {
      const s = String(n == null ? '' : n).replace(/\s+/g, ' ').trim();
      return s || (cur.pilotos[i] || '');
    });
    while (names.length > cur.pilotos.length && !names[names.length - 1]) names.pop();
    return {
      stintMin: int(form.stintMin, cur.stintMin, 0, 999),
      stintMax: int(form.stintMax, cur.stintMax, 0, 999),
      totalStops: int(form.totalStops, cur.totalStops, 0, 200),
      pitDuration: int(form.pitDuration, cur.pitDuration, 30, 600),
      pilotMinTime: int(form.pilotMinTime, cur.pilotMinTime, 0, 9999),
      duration: isNaN(dur) ? cur.duration : Math.max(0, Math.min(48, dur)),
      boxType: BOX_TYPES[form.boxType] ? form.boxType : cur.boxType,
      boxPositions: int(form.boxPositions, cur.boxPositions, 1, 20),
      boxColumns: int(form.boxColumns, cur.boxColumns, 1, 10),
      myDorsal: String(form.myDorsal == null ? cur.myDorsal : form.myDorsal).trim() || cur.myDorsal,
      pilotos: names.map((n, i) => n || 'Piloto ' + (i + 1)),
    };
  }

  // Avisos de coherencia (no bloquean): se enseñan en la confirmación.
  function warnings(v) {
    const w = [];
    if (v.stintMax > 0 && v.stintMax < 999 && v.stintMin > v.stintMax)
      w.push('El stint mínimo es mayor que el máximo.');
    if (v.duration > 0 && v.stintMax > 0 && v.stintMax < 999 && v.totalStops > 0) {
      const trackMin = v.duration * 60 - v.totalStops * v.pitDuration / 60;
      if ((v.totalStops + 1) * v.stintMax < trackMin)
        w.push(`Con ${v.totalStops} paradas y stint máximo de ${v.stintMax} min no se cubre la carrera de ${v.duration} h.`);
    }
    return w;
  }

  const fmt = {
    stintMin: v => v + ' min', stintMax: v => (v >= 999 || !v ? 'sin límite' : v + ' min'),
    totalStops: v => String(v), pitDuration: v => v + ' s',
    pilotMinTime: v => (v ? v + ' min' : 'sin mínimo'), duration: v => (v ? v + ' h' : 'sin indicar'),
    boxType: v => BOX_TYPES[v] || v, boxPositions: v => String(v), boxColumns: v => String(v),
    myDorsal: v => '#' + v, pilotos: v => (v.length ? v.join(', ') : '—'),
  };
  const LABELS = [
    ['stintMin', 'Stint mínimo'], ['stintMax', 'Stint máximo'], ['totalStops', 'Paradas obligatorias'],
    ['pitDuration', 'Duración de parada'], ['pilotMinTime', 'Mínimo por piloto'], ['duration', 'Duración de carrera'],
    ['boxType', 'Tipo de box'], ['boxPositions', 'Karts en el box'], ['boxColumns', 'Columnas del box'],
    ['myDorsal', 'Mi dorsal'], ['pilotos', 'Pilotos'],
  ];

  // Filas de la pantalla de confirmación: todos los datos, marcando los que
  // cambian (con su valor anterior). Las columnas solo cuentan con box en columnas.
  function review(cur, next) {
    return LABELS
      .filter(([k]) => k !== 'boxColumns' || next.boxType === 'columns')
      .map(([key, label]) => {
        const a = fmt[key](cur[key]), b = fmt[key](next[key]);
        return { key, label, from: a, to: b, changed: a !== b };
      });
  }

  return { read, normalize, warnings, review, MAX_PILOTS, BOX_TYPES };
});

// ── Pegamento con el panel (solo navegador) ──────────────────────────────────
if (typeof window !== 'undefined' && typeof document !== 'undefined') {

  // Botón de la barra superior, junto a «← Setup». El punto ámbar avisa de que
  // la carrera sigue con los valores de fábrica (nadie los ha confirmado).
  window._enInjectRaceCfgBtn = function () {
    const nav = document.getElementById('sp-topnav');
    if (!nav || document.getElementById('en-racecfg-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'en-racecfg-btn';
    btn.className = 'sp-nav-btn';
    btn.title = 'Stint mínimo y máximo, paradas, duración de parada, box, dorsal y pilotos';
    btn.innerHTML = '⚙ Configuración de carrera<span id="en-racecfg-dot" style="display:none;margin-left:6px;color:#F5A623" title="Datos de carrera sin confirmar">●</span>';
    btn.onclick = () => window._enOpenRaceConfig();
    nav.appendChild(btn);
    window._enRaceCfgDot();
  };

  window._enRaceCfgDot = function () {
    const dot = document.getElementById('en-racecfg-dot');
    if (dot) dot.style.display = EnBox.stratConfigured ? 'none' : '';
  };

  const _rcInput = 'background:#0e0f11;border:0.5px solid #2a2b2e;color:var(--text-1);padding:6px 8px;border-radius:4px;font-size:13.5px;font-family:monospace;';
  const _rcBtn = (label, onclick, primary) =>
    `<button onclick="${onclick}" style="flex:1;padding:9px;border-radius:6px;border:0.5px solid ${primary ? '#F5A623' : '#2a2b2e'};background:${primary ? '#F5A62318' : 'transparent'};color:${primary ? '#F5A623' : 'var(--text-3)'};font-size:13.5px;cursor:pointer;font-family:sans-serif">${label}</button>`;

  function _rcShell(inner) {
    let overlay = document.getElementById('en-pilot-overlay');
    if (overlay) overlay.remove();
    overlay = document.createElement('div');
    overlay.id = 'en-pilot-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:10000;';
    overlay.innerHTML = `<div class="sp-modal" style="border-radius:12px;padding:22px 24px;max-width:520px;width:92%;max-height:88vh;overflow:auto">${inner}</div>`;
    document.body.appendChild(overlay);
  }

  const _rcField = (label, id, value, unit, extra) => `
    <label style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:5px 0">
      <span style="font-size:13.5px;color:var(--text-2);font-family:sans-serif">${label}${extra || ''}</span>
      <span style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        <input id="${id}" type="number" inputmode="decimal" value="${value}" style="${_rcInput}width:74px;text-align:right">
        <span style="font-size:11.5px;color:var(--text-3);font-family:sans-serif;width:26px">${unit}</span>
      </span>
    </label>`;
  const _rcGroup = t => `<div style="font-size:11.5px;color:#F5A623;font-family:'JetBrains Mono',monospace;letter-spacing:0.08em;margin:14px 0 4px;text-transform:uppercase">${t}</div>`;

  function _rcPilotRow(name, i) {
    return `<div style="display:flex;align-items:center;gap:8px;padding:3px 0">
      <span style="font-size:11.5px;color:var(--text-3);font-family:monospace;width:18px">${i + 1}</span>
      <input class="en-rc-pilot" type="text" value="${_esc(name)}" maxlength="40" placeholder="Nombre del piloto" style="${_rcInput}flex:1;font-family:sans-serif">
    </div>`;
  }

  // Formulario. `v` = valores a mostrar (los actuales, o los tecleados al volver
  // de la confirmación).
  function _rcForm(v) {
    const apexPit = EnSession._pitDurAuto && !EnBox._pitDurUserSet
      ? ' <span title="Detectada del cronómetro oficial de Apex" style="font-size:10.5px;color:var(--state-ok);font-weight:600">✓ Apex</span>' : '';
    const opt = (k) => `<option value="${k}" ${v.boxType === k ? 'selected' : ''}>${EnRaceConfig.BOX_TYPES[k]}</option>`;
    _rcShell(`
      <div style="font-size:14.5px;font-weight:500;color:var(--text-1);font-family:sans-serif">⚙ Configuración de carrera</div>
      ${_rcGroup('Reglamento')}
      ${_rcField('Stint mínimo', 'en-rc-stintMin', v.stintMin, 'min')}
      ${_rcField('Stint máximo', 'en-rc-stintMax', v.stintMax, 'min')}
      ${_rcField('Paradas obligatorias', 'en-rc-totalStops', v.totalStops, '')}
      ${_rcField('Duración de parada', 'en-rc-pitDuration', v.pitDuration, 's', apexPit)}
      ${_rcField('Mínimo por piloto', 'en-rc-pilotMinTime', v.pilotMinTime, 'min')}
      ${_rcField('Duración de carrera', 'en-rc-duration', v.duration, 'h')}
      ${_rcGroup('Box')}
      <label style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:5px 0">
        <span style="font-size:13.5px;color:var(--text-2);font-family:sans-serif">Tipo de box</span>
        <span style="display:flex;align-items:center;gap:6px">
          <select id="en-rc-boxType" onchange="document.getElementById('en-rc-cols-row').style.display=this.value==='columns'?'':'none'" style="${_rcInput}font-family:sans-serif;width:106px">${opt('line')}${opt('battery')}${opt('columns')}</select>
          <span style="width:26px"></span>
        </span>
      </label>
      ${_rcField('Karts en el box', 'en-rc-boxPositions', v.boxPositions, '')}
      <div id="en-rc-cols-row" style="${v.boxType === 'columns' ? '' : 'display:none'}">${_rcField('Columnas', 'en-rc-boxColumns', v.boxColumns, '')}</div>
      ${_rcGroup('Mi equipo')}
      <label style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:5px 0">
        <span style="font-size:13.5px;color:var(--text-2);font-family:sans-serif">Mi dorsal</span>
        <span style="display:flex;align-items:center;gap:6px">
          <input id="en-rc-myDorsal" type="text" value="${_esc(v.myDorsal)}" maxlength="6" style="${_rcInput}width:74px;text-align:right">
          <span style="width:26px"></span>
        </span>
      </label>
      <div style="font-size:13.5px;color:var(--text-2);font-family:sans-serif;padding:5px 0 2px">Pilotos</div>
      <div id="en-rc-pilots">${v.pilotos.map(_rcPilotRow).join('')}</div>
      <button id="en-rc-addpilot" onclick="_enRaceCfgAddPilot()" style="margin-top:4px;padding:5px 10px;border-radius:4px;border:0.5px solid #2a2b2e;background:transparent;color:var(--text-2);font-size:11.5px;cursor:pointer;font-family:sans-serif;${v.pilotos.length >= EnRaceConfig.MAX_PILOTS ? 'display:none' : ''}">➕ Añadir piloto</button>
      <div style="display:flex;gap:8px;margin-top:18px">
        ${_rcBtn('Cancelar', '_enDismissOverlay()')}
        ${_rcBtn('Revisar y guardar', '_enRaceCfgReview()', true)}
      </div>`);
  }

  function _rcCurrent() { return EnRaceConfig.read(window.AppState && window.AppState.config, EnBox); }

  window._enOpenRaceConfig = function () { _rcForm(_rcCurrent()); };

  window._enRaceCfgAddPilot = function () {
    const box = document.getElementById('en-rc-pilots');
    if (!box) return;
    const n = box.querySelectorAll('.en-rc-pilot').length;
    if (n >= EnRaceConfig.MAX_PILOTS) return;
    box.insertAdjacentHTML('beforeend', _rcPilotRow('', n));
    if (n + 1 >= EnRaceConfig.MAX_PILOTS) document.getElementById('en-rc-addpilot').style.display = 'none';
    const inputs = box.querySelectorAll('.en-rc-pilot');
    inputs[inputs.length - 1].focus();
  };

  // Paso 2: confirmación. Enseña TODOS los datos, con lo que cambia resaltado.
  window._enRaceCfgReview = function () {
    const val = id => { const e = document.getElementById('en-rc-' + id); return e ? e.value : undefined; };
    const form = {};
    ['stintMin', 'stintMax', 'totalStops', 'pitDuration', 'pilotMinTime', 'duration', 'boxType', 'boxPositions', 'boxColumns', 'myDorsal']
      .forEach(k => { form[k] = val(k); });
    form.pilotos = [...document.querySelectorAll('.en-rc-pilot')].map(i => i.value);
    const cur = _rcCurrent();
    const next = EnRaceConfig.normalize(form, cur);
    EnSession._raceCfgPending = next;
    const rows = EnRaceConfig.review(cur, next);
    const nChanged = rows.filter(r => r.changed).length;
    const warns = EnRaceConfig.warnings(next);
    _rcShell(`
      <div style="font-size:14.5px;font-weight:500;color:var(--text-1);font-family:sans-serif">Confirma los datos de la carrera</div>
      <div style="font-size:11.5px;color:var(--text-2);font-family:sans-serif;margin:4px 0 12px">${nChanged ? `${nChanged} ${nChanged === 1 ? 'dato cambia' : 'datos cambian'} (en ámbar, con el valor anterior tachado).` : 'No cambia nada: se confirman estos datos como válidos.'}</div>
      ${rows.map(r => `
        <div style="display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:0.5px solid #1e1f25">
          <span style="font-size:13.5px;color:var(--text-2);font-family:sans-serif;flex-shrink:0">${r.label}</span>
          <span style="font-size:13.5px;font-family:monospace;text-align:right;color:${r.changed ? '#F5A623' : 'var(--text-1)'}">${r.changed ? `<s style="color:var(--text-3)">${_esc(r.from)}</s> → ` : ''}${_esc(r.to)}</span>
        </div>`).join('')}
      ${warns.map(w => `<div style="font-size:11.5px;color:#fbbf24;font-family:sans-serif;margin-top:10px">⚠ ${_esc(w)}</div>`).join('')}
      <div style="display:flex;gap:8px;margin-top:18px">
        ${_rcBtn('← Volver', '_enRaceCfgBack()')}
        ${_rcBtn('Confirmar', '_enRaceCfgApply()', true)}
      </div>`);
  };

  window._enRaceCfgBack = function () {
    const next = EnSession._raceCfgPending;
    _rcForm(next || _rcCurrent());
  };

  // Paso 3: aplicar todo de una vez, guardar y repintar.
  window._enRaceCfgApply = function () {
    const next = EnSession._raceCfgPending; EnSession._raceCfgPending = null;
    _enDismissOverlay();
    if (!next) return;
    if (!window.AppState) window.AppState = {};
    if (!window.AppState.config) window.AppState.config = {};
    const cfg = window.AppState.config;
    const cur = _rcCurrent();

    cfg.stintMin = next.stintMin;
    cfg.stintMax = next.stintMax;
    cfg.duration = next.duration;
    EnBox.totalStops = next.totalStops;
    EnBox.pilotMinTime = next.pilotMinTime;
    // La duración de parada solo pasa a "puesta a mano" si se ha tocado: si no,
    // sigue pudiendo corregirla el cronómetro oficial de Apex.
    if (next.pitDuration !== cur.pitDuration) { EnBox.pitDuration = next.pitDuration; EnBox._pitDurUserSet = true; }
    EnBox.config.type = next.boxType;
    EnBox.config.columns = next.boxColumns;
    if (next.boxPositions !== cur.boxPositions) _enSetBoxPositions(next.boxPositions);
    if (next.myDorsal !== cur.myDorsal) _enUpdateCfg('myDorsal', next.myDorsal);
    const old = Array.isArray(cfg.pilotos) ? cfg.pilotos : [];
    cfg.pilotos = next.pilotos.map((name, i) => ({ ...(old[i] || { minutos: (old[0] && old[0].minutos) || 90 }), name }));
    // Los stints ya cerrados muestran el nombre guardado: seguir el renombrado.
    (EnSession.stintHistory || []).forEach(s => { if (cfg.pilotos[s.pilotIdx]) s.pilot = cfg.pilotos[s.pilotIdx].name; });

    EnBox.stratConfigured = true;
    window._enRaceCfgDot();
    try { _enSaveRaceState(); } catch (e) {}
    _enRender();
  };
}
