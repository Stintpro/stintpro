// ── CircuitMonitor — gestiona una conexión Apex + sesión + subscriptores ──
const WebSocket  = require('ws');
const fs         = require('fs');
const path       = require('path');
const ApexParser = require('./apex-parser');
const db         = require('./db');

const BROADCAST_INTERVAL_MS = 200; // throttle live updates a 5 fps

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

    // Subscriptores WebSocket del dashboard
    this.subscribers = new Set();

    // Subscriptores piloto: Map dorsal → Set de ws
    this.pilotSubscribers = new Map();

    // Estado de sesión
    this.sessionId  = null;
    this.pitEvents  = [];   // eventos de pit de la sesión actual (para snapshot)
    this._lapCount  = 0;

    this.recording = cfg.recording !== false; // true por defecto

    // Raw log (replay mode)
    this._rawLog        = null;
    this._rawLogEnabled = cfg.rawLog || !!process.env.STINTPRO_RAW_LOG;

    this.parser = new ApexParser({
      onLap:        this._onLap.bind(this),
      onPit:        this._onPit.bind(this),
      onState:      this._onState.bind(this),
      onSessionEnd: this._onSessionEnd.bind(this),
      onNewSession: this._onNewSession.bind(this),
      onTitle:      this._onTitle.bind(this),
    });
  }

  start() {
    console.log(`[${this.slug}] Iniciando monitor (${this.name}, port ${this.port})`);
    if (this._rawLogEnabled) this._openRawLog();
    this._connect();
  }

  stop() {
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this._saveTimer)      { clearInterval(this._saveTimer);     this._saveTimer = null;      }
    if (this.ws)              { try { this.ws.close(); } catch(e) {}  this.ws = null;             }
    if (this._rawLog)         { try { this._rawLog.end(); } catch(e) {} this._rawLog = null;      }
    this.connected = false;
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
        this._broadcastStatus('connected');
      });

      this.ws.on('message', (data) => {
        const raw = data.toString();
        if (this._rawLog) {
          try { this._rawLog.write(JSON.stringify({ t: Date.now(), raw }) + '\n'); } catch(e) {}
        }
        try { this.parser.parse(raw); }
        catch(e) { console.error(`[${this.slug}] parse error:`, e.message); }
      });

      this.ws.on('error', (err) => {
        this.connected = false;
        console.error(`[${this.slug}] WS error:`, err.message);
      });

      this.ws.on('close', () => {
        this.connected = false;
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

  _onPit(dorsal, eventType, standsCount, timestamp) {
    if (!this.recording || !this.sessionId) return;
    db.insertPitEvent(this.sessionId, dorsal, eventType, standsCount, timestamp);
    this.pitEvents.push({ dorsal, event: eventType, time: timestamp, standsCount });
  }

  _onState(state) {
    // Throttle broadcast
    const now = Date.now();
    if (now - this._lastBroadcast < BROADCAST_INTERVAL_MS) return;
    this._lastBroadcast = now;
    // Solo últimas 10 vueltas en live — el historial completo va en el snapshot inicial
    const liveData = {
      ...state,
      equipos: state.equipos.map(e => ({ ...e, lapHistory: (e.lapHistory || []).slice(-10) })),
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
  }

  _onNewSession() {
    console.log(`[${this.slug}] Nueva sesión detectada`);
    if (this.sessionId) {
      this._saveSnapshot();
      db.endSession(this.sessionId);
    }
    this.sessionId = null;
    this.pitEvents = [];
    this._lapCount = 0;
    if (this._saveTimer) { clearInterval(this._saveTimer); this._saveTimer = null; }
  }

  _onTitle(title) {
    if (!this.sessionId) return;
    db.updateSessionTitle(this.sessionId, title);
    console.log(`[${this.slug}] Título de sesión actualizado: "${title}"`);
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

    const snapshot = { ...state, pitEvents: [...this.pitEvents] };
    if (this._computeRatings) {
      try { snapshot.pilotRatings = this._computeRatings(this.slug); } catch(e) {}
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
    db.saveSnapshot(this.sessionId, { ...state, pitEvents: this.pitEvents });
  }

  // ── Info pública ──────────────────────────────────────────────────────

  getInfo() {
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
    };
  }
}

module.exports = CircuitMonitor;
