// ── CircuitMonitor — gestiona una conexión Apex + sesión + subscriptores ──
const WebSocket  = require('ws');
const ApexParser = require('./apex-parser');
const db         = require('./db');

const BROADCAST_INTERVAL_MS = 200; // throttle live updates a 5 fps

class CircuitMonitor {
  constructor(cfg) {
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

    // Estado de sesión
    this.sessionId  = null;
    this.pitEvents  = [];   // eventos de pit de la sesión actual (para snapshot)
    this._lapCount  = 0;

    this.parser = new ApexParser({
      onLap:        this._onLap.bind(this),
      onPit:        this._onPit.bind(this),
      onState:      this._onState.bind(this),
      onSessionEnd: this._onSessionEnd.bind(this),
      onNewSession: this._onNewSession.bind(this),
    });
  }

  start() {
    console.log(`[${this.slug}] Iniciando monitor (${this.name}, port ${this.port})`);
    this._connect();
  }

  stop() {
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this._saveTimer)      { clearInterval(this._saveTimer);     this._saveTimer = null;      }
    if (this.ws)              { try { this.ws.close(); } catch(e) {}  this.ws = null;             }
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
        try { this.parser.parse(data.toString()); }
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

  _onLap(dorsal, name, lapMs, lapNumber, timestamp) {
    if (!this.sessionId) {
      // Primera vuelta real → crear sesión
      this.sessionId = db.createSession(this.slug, this.name);
      this.pitEvents = [];
      this._lapCount = 0;
      // Auto-guardar snapshot cada 10s
      if (this._saveTimer) clearInterval(this._saveTimer);
      this._saveTimer = setInterval(() => this._saveSnapshot(), 10000);
    }
    this._lapCount++;
    const cleanName = (name || '').replace(/\s*\[\d+:\d+\]\s*$/, '').trim();
    db.insertLap(this.sessionId, dorsal, cleanName, lapMs, lapNumber, timestamp);
  }

  _onPit(dorsal, eventType, standsCount, timestamp) {
    if (!this.sessionId) return;
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

  // ── Subscriptores WebSocket ───────────────────────────────────────────

  subscribe(ws) {
    this.subscribers.add(ws);
    ws.on('close', () => this.subscribers.delete(ws));
    ws.on('error', () => this.subscribers.delete(ws));
    // Enviar snapshot histórico completo de inmediato
    this._sendHistoryTo(ws);
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
        });
      } catch(err) { console.error(`[${this.slug}] enrichHistory:`, err.message); }
    }

    const snapshot = { ...state, pitEvents: [...this.pitEvents] };
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
      sessionActive: !!this.sessionId && !this.parser._sessionFinished,
      sessionId:     this.sessionId,
      lapCount:      this._lapCount,
      kartCount:     Object.values(this.parser._karts).filter(k => k.dorsal).length,
      subscribers:   this.subscribers.size,
    };
  }
}

module.exports = CircuitMonitor;
