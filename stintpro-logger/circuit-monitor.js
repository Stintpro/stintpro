// ── CircuitMonitor — gestiona una conexión Apex + sesión + subscriptores ──
const WebSocket  = require('ws');
const fs         = require('fs');
const path       = require('path');
const ApexParser = require('./apex-parser');
const ApexProtocol = require('./apex-protocol');
const db         = require('./db');
const apexHttpSampler = require('./apex-http-sampler');

const BROADCAST_INTERVAL_MS   = 200; // throttle live updates a 5 fps
const APEX_SAMPLE_INTERVAL_MS = 5 * 60 * 1000; // frecuencia del muestreo .P (investigación)
const APEX_SAMPLE_FIRST_MS    = 30 * 1000;     // primera muestra a los 30s de arrancar

// ── Keepalive + watchdog de la conexión saliente a Apex ────────────────────
// Apex sirve todos los circuitos tras un único frente (proxy). Cuando ese frente
// deja de reenviar datos de un circuito pero mantiene el TCP vivo (half-open a
// nivel de aplicación), el socket queda ESTABLISHED sin datos: 'close' nunca
// dispara y el monitor se congela en la última sesión vista — para SIEMPRE
// (se han observado congelaciones de días). El cliente, que abre conexión fresca
// cada vez, sí ve la sesión real → discrepancia "vía logger sale otra sesión".
// Dos mecanismos independientes lo detectan:
//  1. Ping/pong WS: cachea sockets realmente muertos (sin pong → terminate).
//  2. Watchdog de datos: si no llegan mensajes de aplicación durante X, se fuerza
//     una reconexión (que re-sincroniza con la sesión actual). El umbral es corto
//     con sesión activa o espectadores (el feed emite constante) y suave si el
//     circuito está ocioso y nadie mira (evita reconectar en vano de madrugada).
const APEX_PING_INTERVAL_MS     = 30 * 1000;      // heartbeat cada 30s
const APEX_WATCHDOG_INTERVAL_MS = 20 * 1000;      // revisa frescura cada 20s
const APEX_STALE_ACTIVE_MS      = 90 * 1000;      // sesión activa sin datos → congelado
const APEX_STALE_WATCHED_MS     = 2 * 60 * 1000;  // alguien mirando y sin datos → refrescar
const APEX_STALE_IDLE_MS        = 30 * 60 * 1000; // ocioso sin espectadores → reconexión suave

class CircuitMonitor {
  constructor(cfg, computeRatings) {
    this._computeRatings = computeRatings || null;
    this.slug      = cfg.slug;
    this.port      = cfg.port || 7913;
    this.name      = cfg.name || cfg.slug;

    this.ws              = null;
    this.connected       = false;
    this._reconnectTimer = null;
    this._saveTimer      = null;
    this._lastBroadcast  = 0;

    // Keepalive/watchdog de la conexión a Apex (ver constantes arriba)
    this._pingTimer     = null;
    this._watchdogTimer = null;
    this._awaitingPong  = false;
    this._lastDataAt    = 0;  // último mensaje de aplicación recibido de Apex

    // Subscriptores WebSocket del dashboard
    this.subscribers = new Set();

    // Subscriptores piloto: Map dorsal → Set de ws
    this.pilotSubscribers = new Map();

    // Estado de sesión
    this.sessionId  = null;
    this.pitEvents  = [];   // eventos de pit de la sesión actual (para snapshot)
    this.raceEvents = [];   // eventos de bandera roja detenida/reanudada (para snapshot)
    this._lapCount  = 0;

    this.recording = cfg.recording !== false; // true por defecto

    // Raw log (replay mode)
    this._rawLog        = null;
    this._rawLogEnabled = cfg.rawLog || !!process.env.STINTPRO_RAW_LOG;

    // Muestreo del canal HTTP request.php (investigación .P — ver apex-http-sampler.js)
    this._apexSampleEnabled = cfg.apexHttpSample || !!process.env.STINTPRO_APEX_HTTP_SAMPLE;
    this._apexSampleTimer   = null;
    this._apexHttpPort      = null;

    this.parser = new ApexParser({
      onLap:        this._onLap.bind(this),
      onPit:        this._onPit.bind(this),
      onState:      this._onState.bind(this),
      onSessionEnd: this._onSessionEnd.bind(this),
      onNewSession: this._onNewSession.bind(this),
      onTitle:      this._onTitle.bind(this),
      onCountdown:  this._onCountdown.bind(this),
      onComment:    this._onComment.bind(this),
      onFlag:       this._onFlag.bind(this),
    });

    // Último countdown recibido de Apex ({ms, mode, at}) — para reenviar a subscriptores
    // y reconstruir el reloj en el snapshot al conectar a mitad de sesión.
    this._lastClock = null;

    // Ancla de salida oficial de carrera sacada del canal com| de dirección de
    // carrera — lógica compartida con el conector directo de la app (ver
    // createRaceStartTracker en apex-protocol.js). _onComment le pasa el html.
    this._raceTracker = ApexProtocol.createRaceStartTracker();

    // Estado de carrera detenida por bandera roja — ver createFlagTracker.
    this._flagTracker = ApexProtocol.createFlagTracker();
  }

  start() {
    console.log(`[${this.slug}] Iniciando monitor (${this.name}, port ${this.port})`);
    if (this._rawLogEnabled) this._openRawLog();
    if (this._apexSampleEnabled) this._startApexSampler();
    this._connect();
  }

  stop() {
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this._saveTimer)      { clearInterval(this._saveTimer);     this._saveTimer = null;      }
    if (this._apexSampleTimer){ clearInterval(this._apexSampleTimer); this._apexSampleTimer = null; }
    this._stopHeartbeat();
    if (this.ws)              { try { this.ws.close(); } catch(e) {}  this.ws = null;             }
    if (this._rawLog)         { try { this._rawLog.end(); } catch(e) {} this._rawLog = null;      }
    this.connected = false;
  }

  // ── Keepalive + watchdog de la conexión a Apex ─────────────────────────
  _startHeartbeat() {
    this._stopHeartbeat();
    this._awaitingPong = false;

    // Ping/pong: si un ping se queda sin pong hasta el siguiente ciclo, el socket
    // está muerto → terminate() dispara 'close' y la reconexión estándar.
    this._pingTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (this._awaitingPong) {
        console.warn(`[${this.slug}] Apex sin pong → cerrando socket para reconectar`);
        try { this.ws.terminate(); } catch(e) { try { this.ws.close(); } catch(e2) {} }
        return;
      }
      this._awaitingPong = true;
      try { this.ws.ping(); } catch(e) {}
    }, APEX_PING_INTERVAL_MS);

    // Watchdog de datos: fuerza reconexión si el feed lleva demasiado sin mensajes.
    this._watchdogTimer = setInterval(() => this._checkStale(), APEX_WATCHDOG_INTERVAL_MS);
  }

  _stopHeartbeat() {
    if (this._pingTimer)     { clearInterval(this._pingTimer);     this._pingTimer = null;     }
    if (this._watchdogTimer) { clearInterval(this._watchdogTimer); this._watchdogTimer = null; }
    this._awaitingPong = false;
  }

  // Umbral de silencio tolerado según el estado: corto si hay carrera o alguien
  // mirando (el feed emite constante), suave si el circuito está ocioso.
  _staleLimitMs() {
    const active  = !!this.sessionId && !this.parser.sessionFinished;
    const watched = this.subscribers.size > 0 || this.pilotSubscribers.size > 0;
    return active ? APEX_STALE_ACTIVE_MS : watched ? APEX_STALE_WATCHED_MS : APEX_STALE_IDLE_MS;
  }

  _checkStale() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const silence = Date.now() - this._lastDataAt;
    if (silence > this._staleLimitMs()) {
      const active  = !!this.sessionId && !this.parser.sessionFinished;
      const watched = this.subscribers.size > 0 || this.pilotSubscribers.size > 0;
      console.warn(`[${this.slug}] Feed sin datos ${Math.round(silence / 1000)}s ` +
                   `(activa=${active}, mirando=${watched}) → reconectando`);
      try { this.ws.terminate(); } catch(e) { try { this.ws.close(); } catch(e2) {} }
    }
  }

  // ── Muestreo HTTP de request.php (investigación .P) ────────────────────
  _startApexSampler() {
    setTimeout(() => this._sampleApexHttp(), APEX_SAMPLE_FIRST_MS);
    this._apexSampleTimer = setInterval(() => this._sampleApexHttp(), APEX_SAMPLE_INTERVAL_MS);
  }

  async _sampleApexHttp() {
    if (!this.sessionId) return; // sin sesión activa, nada que muestrear
    try {
      if (!this._apexHttpPort) this._apexHttpPort = await apexHttpSampler.fetchConfigPort(this.slug);
      if (!this._apexHttpPort) return;
      const kartIds = this.parser.getKartIds();
      if (!kartIds.length) return;
      await apexHttpSampler.sampleCircuit(this.slug, this._apexHttpPort, kartIds);
    } catch(e) {}
  }

  // ── Conexión Apex ─────────────────────────────────────────────────────

  _connect() {
    try {
      this.ws = new WebSocket(`wss://live-data.apex-timing.com:${this.port}/`, {
        headers: {
          Origin:     'https://live.apex-timing.com',
          Referer:    'https://live.apex-timing.com/rkc/',
          'User-Agent': 'Mozilla/5.0 StintPro-Logger/1.0',
        },
      });

      this.ws.on('open', () => {
        this.connected = true;
        console.log(`[${this.slug}] Apex conectado`);
        this.ws.send(this.slug);
        this._lastDataAt = Date.now();
        this._startHeartbeat();
        this._broadcastStatus('connected');
      });

      // El pong solo confirma que el socket está vivo; NO cuenta como "datos"
      // para el watchdog (un proxy puede seguir respondiendo pong sin reenviar
      // el feed — justo el caso de congelación que hay que cazar).
      this.ws.on('pong', () => { this._awaitingPong = false; });

      this.ws.on('message', (data) => {
        this._lastDataAt = Date.now();
        const raw = data.toString();
        if (this._rawLog) {
          try { this._rawLog.write(JSON.stringify({ t: Date.now(), raw }) + '\n'); } catch(e) {}
        }
        try { this.parser.parse(raw); }
        catch(e) { console.error(`[${this.slug}] parse error:`, e.message); }
      });

      this.ws.on('error', (err) => {
        this.connected = false;
        this._stopHeartbeat();
        console.error(`[${this.slug}] WS error:`, err.message);
      });

      this.ws.on('close', () => {
        this.connected = false;
        this._stopHeartbeat();
        console.log(`[${this.slug}] Desconectado, reconectando en 5s...`);
        this._broadcastStatus('disconnected');
        this._reconnectTimer = setTimeout(() => this._connect(), 5000);
      });
    } catch(e) {
      console.error(`[${this.slug}] connect error:`, e.message);
      this._reconnectTimer = setTimeout(() => this._connect(), 5000);
    }
  }

  // ── Callbacks del parser ──────────────────────────────────────────────

  setRecording(enabled) {
    this.recording = enabled;
    console.log(`[${this.slug}] Grabación ${enabled ? 'activada' : 'pausada'}`);
  }

  setRawLog(enabled) {
    if (enabled && !this._rawLog) {
      this._rawLogEnabled = true;
      this._openRawLog();
    } else if (!enabled && this._rawLog) {
      this._rawLogEnabled = false;
      try { this._rawLog.end(); } catch(e) {}
      this._rawLog = null;
      console.log(`[${this.slug}] Raw log detenido`);
    }
  }

  _openRawLog() {
    try {
      const dir = path.join(__dirname, 'recordings');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const file  = path.join(dir, `${this.slug}_${stamp}.ndjson`);
      this._rawLog = fs.createWriteStream(file, { flags: 'a' });
      console.log(`[${this.slug}] Raw log: recordings/${this.slug}_${stamp}.ndjson`);
    } catch(e) {
      console.error(`[${this.slug}] No se pudo abrir raw log:`, e.message);
    }
  }

  _onLap(dorsal, name, teamName, lapMs, lapNumber, timestamp) {
    if (!this.recording) return;
    if (!this.sessionId) {
      // Primera vuelta real → crear sesión
      const { title1, title2 } = this.parser.getState();
      const title = [title1, title2].filter(Boolean).join(' · ') || null;
      this.sessionId = db.createSession(this.slug, this.name, title);
      this.pitEvents = [];
      this._lapCount = 0;
      // Auto-guardar snapshot cada 10s
      if (this._saveTimer) clearInterval(this._saveTimer);
      this._saveTimer = setInterval(() => this._saveSnapshot(), 10000);
    }
    this._lapCount++;
    const cleanName = (name || '').replace(/\s*\[\d+:\d+\]\s*$/, '').trim();
    db.insertLap(this.sessionId, dorsal, cleanName, teamName || null, lapMs, lapNumber, timestamp);
  }

  _onPit(dorsal, eventType, standsCount, timestamp, pitDurationSec) {
    if (!this.recording || !this.sessionId) return;
    db.insertPitEvent(this.sessionId, dorsal, eventType, standsCount, timestamp);
    // pitDur = duración oficial (crono otr) de la parada, en el evento 'out'.
    const ev = { dorsal, event: eventType, time: timestamp, standsCount };
    if (eventType === 'out' && pitDurationSec != null) ev.pitDur = pitDurationSec;
    this.pitEvents.push(ev);
  }

  _onState(state) {
    // Throttle broadcast
    const now = Date.now();
    if (now - this._lastBroadcast < BROADCAST_INTERVAL_MS) return;
    this._lastBroadcast = now;
    // Solo últimas 10 vueltas en live — el historial completo va en el snapshot
    // inicial. lapHistoryTotal (longitud real en memoria del parser) permite al
    // cliente fusionar por contador en vez de deduplicar por valor de vuelta.
    const liveData = {
      ...state,   // incluye flag (bandera cruda del panel)
      raceStopped: this._flagTracker.stopped,
      equipos: state.equipos.map(e => ({
        ...e,
        lapHistoryTotal: (e.lapHistory || []).length,
        lapHistory: (e.lapHistory || []).slice(-10),
      })),
    };
    this._broadcast({ type: 'live', data: liveData });

    // Emitir datos filtrados a subscriptores piloto
    this._broadcastPilots(state);
  }

  _broadcastPilots(state) {
    if (!this.pilotSubscribers.size) return;
    for (const [dorsal, clients] of this.pilotSubscribers) {
      if (!clients.size) continue;
      const kart = state.equipos.find(e => String(e.dorsal) === String(dorsal));
      if (!kart) continue;

      // Calcular gapBehind: interval del kart en pos+1
      const sorted = [...state.equipos].sort((a, b) => (a.pos || 999) - (b.pos || 999));
      const myIdx  = sorted.findIndex(e => String(e.dorsal) === String(dorsal));
      const behind = myIdx >= 0 && myIdx + 1 < sorted.length ? sorted[myIdx + 1] : null;

      const msg = JSON.stringify({
        type:       'pilot',
        pos:        kart.pos,
        gap:        kart.gap,
        interval:   kart.interval,
        gapBehind:  behind ? behind.interval : null,
        lastLap:    kart.lastLap,
        pit:        kart.pit,
      });

      for (const ws of clients) {
        if (ws.readyState === 1) try { ws.send(msg); } catch(e) {}
      }
    }
  }

  _onSessionEnd() {
    console.log(`[${this.slug}] Sesión #${this.sessionId} finalizada (bandera)`);
    if (this.sessionId) {
      this._saveSnapshot();
      db.endSession(this.sessionId);
    }
    // El ancla ya quedó en el snapshot final; que no la herede la sesión siguiente
    this._raceTracker.clear();
    this._flagTracker.reset();
  }

  _onNewSession() {
    console.log(`[${this.slug}] Nueva sesión detectada`);
    if (this.sessionId) {
      this._saveSnapshot();
      db.endSession(this.sessionId);
    }
    this.sessionId = null;
    this.pitEvents = [];
    this.raceEvents = [];
    this._lapCount = 0;
    this._lastClock = null;
    this._flagTracker.reset();
    // La verde de la sesión entrante suele llegar ANTES de que el parser detecte
    // la sesión nueva (primer grid/vueltas) → un ancla reciente se conserva;
    // una vieja (carrera anterior acabada sin bandera) se descarta.
    this._raceTracker.onNewSession();
    if (this._saveTimer) { clearInterval(this._saveTimer); this._saveTimer = null; }
  }

  _onTitle(title) {
    if (!this.sessionId) return;
    db.updateSessionTitle(this.sessionId, title);
    console.log(`[${this.slug}] Título de sesión actualizado: "${title}"`);
  }

  _onCountdown(ms, mode) {
    // mode: 'countdown' | 'count' (ascendente) | 'stop'
    if (mode === 'stop' || ms == null) {
      this._lastClock = { ms: null, mode: 'stop', at: Date.now() };
    } else {
      this._lastClock = { ms, mode, at: Date.now() };
    }
    this._broadcast({ type: 'clock', ms: this._lastClock.ms, mode: this._lastClock.mode });
  }

  // ── Cronograma oficial (canal com| de dirección de carrera) ─────────────
  // Toda la lógica de extracción y anclaje vive en el tracker compartido
  // (createRaceStartTracker en apex-protocol.js). Aquí solo se le pasa el html,
  // se le dice si hay carrera en marcha (para conservar el ancla en reanudación)
  // y, cuando devuelve un ancla nueva, se difunde a los subscriptores.
  _onComment(html) {
    const raceInProgress = !!this.sessionId && !this.parser.sessionFinished;
    const rs = this._raceTracker.ingest(html, { raceInProgress });
    if (rs) {
      console.log(`[${this.slug}] Salida oficial ${rs.clock} (${rs.source})`);
      this._broadcast({ type: 'raceStart', at: rs.at, clock: rs.clock, source: rs.source });
    }
  }

  // ── Bandera del panel de luces (verde/roja/amarilla) ────────────────────
  // Se difunde la bandera cruda para el cartel del cliente y, cuando el tracker
  // detecta detención/reanudación reales (roja con carrera activa → verde), se
  // registra el evento en la sesión (va en el snapshot persistido).
  _onFlag(flag, ctx) {
    const ev = this._flagTracker.ingest(flag, ctx || {});
    this._broadcast({ type: 'flag', flag, raceStopped: this._flagTracker.stopped });
    if (!ev) return;
    if (ev.type === 'stopped') {
      console.warn(`[${this.slug}] 🔴 Carrera DETENIDA (bandera roja con carrera activa)`);
      if (this.sessionId) this.raceEvents.push({ type: 'stopped', time: ev.at });
    } else if (ev.type === 'resumed') {
      const secs = ev.durationMs != null ? Math.round(ev.durationMs / 1000) : '?';
      console.log(`[${this.slug}] 🟢 Carrera REANUDADA tras ${secs}s detenida`);
      if (this.sessionId) this.raceEvents.push({ type: 'resumed', time: ev.at, durationMs: ev.durationMs });
    }
    if (this.sessionId) this._saveSnapshot();
  }

  // ── Subscriptores WebSocket ───────────────────────────────────────────

  subscribe(ws) {
    this.subscribers.add(ws);
    ws.on('close', () => this.subscribers.delete(ws));
    ws.on('error', () => this.subscribers.delete(ws));
    // Enviar snapshot histórico completo de inmediato
    this._sendHistoryTo(ws);
  }

  subscribePilot(ws, dorsal) {
    const key = String(dorsal);
    if (!this.pilotSubscribers.has(key)) this.pilotSubscribers.set(key, new Set());
    const clients = this.pilotSubscribers.get(key);
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
    ws.send(JSON.stringify({ type: 'pilot_ack', slug: this.slug, dorsal: key }));
  }

  _sendHistoryTo(ws) {
    if (ws.readyState !== WebSocket.OPEN) return;
    const state = this.parser.getState();

    // Contador de vueltas en memoria del parser — fijado ANTES del enriquecido
    // desde BD (que puede alargar lapHistory): los updates live diffean contra
    // este mismo contador, así el primer merge tras el snapshot cuadra.
    state.equipos.forEach(e => { e.lapHistoryTotal = (e.lapHistory || []).length; });

    // Enriquecer lapHistory desde BD — más completo que el estado en memoria
    // (cubre reinicios del servidor o reconexiones a Apex mid-sesión)
    if (this.sessionId) {
      try {
        const dbLaps = db.getLapsBySession(this.sessionId);
        const byDorsal = {};
        dbLaps.forEach(l => {
          if (!byDorsal[l.dorsal]) byDorsal[l.dorsal] = [];
          byDorsal[l.dorsal].push(parseFloat((l.lap_time_ms / 1000).toFixed(3)));
        });
        state.equipos.forEach(e => {
          const hist = byDorsal[e.dorsal];
          if (hist && hist.length > (e.lapHistory || []).length) {
            e.lapHistory = hist;
            e.lastLap    = hist[hist.length - 1];
            const valid  = hist.filter(t => t >= 20 && t < 300);
            if (valid.length) e.bestLap = Math.min(...valid);
          }
          // Recuperar nombre desde BD si el parser no lo tiene
          if (!e.name || e.name.startsWith('#')) {
            const lap = dbLaps.find(l => l.dorsal === e.dorsal && l.name);
            if (lap) e.name = lap.name;
          }
          // stintLapCount: vueltas desde el último pit out → permite al cliente reconstruir stintStartIdx
          const lastOut = this.pitEvents
            .filter(ev => String(ev.dorsal) === String(e.dorsal) && ev.event === 'out')
            .reduce((latest, ev) => !latest || ev.time > latest.time ? ev : latest, null);
          if (lastOut) {
            const dorsalLaps = dbLaps.filter(l => String(l.dorsal) === String(e.dorsal));
            e.stintLapCount = dorsalLaps.filter(l => l.timestamp > lastOut.time).length;
          }
        });
      } catch(err) { console.error(`[${this.slug}] enrichHistory:`, err.message); }
    }

    const snapshot = { ...state, pitEvents: [...this.pitEvents], raceEvents: [...this.raceEvents] };
    if (this._raceTracker.raceStart) snapshot.raceStart = this._raceTracker.raceStart;
    snapshot.raceStopped = this._flagTracker.stopped;
    if (this._computeRatings) {
      try { snapshot.pilotRatings = this._computeRatings(this.slug); } catch(e) {}
    }
    // Reloj: reconstruir el countdown ajustado por el tiempo transcurrido desde
    // el último valor recibido, para que al conectar tarde el reloj ya esté sincronizado.
    if (this._lastClock && this._lastClock.mode !== 'stop' && this._lastClock.ms != null) {
      const elapsed = Date.now() - this._lastClock.at;
      const adj = this._lastClock.mode === 'count'
        ? this._lastClock.ms + elapsed
        : this._lastClock.ms - elapsed;
      snapshot.clock = { ms: adj, mode: this._lastClock.mode };
    }
    try { ws.send(JSON.stringify({ type: 'history', snapshot })); } catch(e) {}
  }

  _broadcast(msg) {
    const json = JSON.stringify(msg);
    this.subscribers.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) try { ws.send(json); } catch(e) {}
    });
  }

  _broadcastStatus(status) {
    this._broadcast({ type: 'status', slug: this.slug, status });
  }

  _saveSnapshot() {
    if (!this.sessionId) return;
    const state = this.parser.getState();
    const snap  = { ...state, pitEvents: this.pitEvents, raceEvents: this.raceEvents };
    if (this._raceTracker.raceStart) snap.raceStart = this._raceTracker.raceStart;
    snap.raceStopped = this._flagTracker.stopped;
    db.saveSnapshot(this.sessionId, snap);
  }

  // ── Info pública ──────────────────────────────────────────────────────

  getInfo() {
    // Frescura del feed: un socket "connected" puede estar congelado (half-open)
    // sirviendo datos viejos. lastDataAgo/stale lo hacen visible en /api/status
    // para poder detectarlo/alertarlo aunque el watchdog aún no haya reconectado.
    const dataAgoMs = this._lastDataAt ? Date.now() - this._lastDataAt : null;
    return {
      slug:          this.slug,
      name:          this.name,
      port:          this.port,
      connected:     this.connected,
      sessionActive: !!this.sessionId && !this.parser.sessionFinished,
      sessionId:     this.sessionId,
      lapCount:      this._lapCount,
      kartCount:     this.parser.kartCount,
      subscribers:   this.subscribers.size,
      recording:     this.recording,
      rawLog:        this._rawLogEnabled,
      lastDataAgo:   dataAgoMs == null ? null : Math.round(dataAgoMs / 1000),
      stale:         this.connected && dataAgoMs != null && dataAgoMs > this._staleLimitMs(),
    };
  }
}

module.exports = CircuitMonitor;
