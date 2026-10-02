// ── ReplayConnector — reproduce un .ndjson grabado por el logger ──────────
// Misma interfaz que ApexConnector: connect(slug, onData, onStatus, onComment, port, onTitle, onMessage)
// Controles: pause() / resume() / setSpeed(n)

// La lectura del grid (categoría, otr, columnas) vive en apex-grid.js.

window.ReplayConnector = {
  _lines:      [],
  _playing:    false,
  _paused:     false,
  speed:       1,
  loopMode:    false,
  _currentIdx: 0,
  _t0:         0,       // timestamp del primer mensaje
  _tEnd:       0,       // timestamp del último mensaje
  _wallStart:  0,       // Date.now() cuando arrancó (o reanudó) el replay
  _mediaStart: 0,       // _lines[_currentIdx].t cuando arrancó/reanudó
  _tid:        null,    // setTimeout activo
  onData:      null,
  onStatus:    null,
  onComment:   null,
  onMessage:   null,
  _parser:     null,
  _comments:   [],

  // ── API pública ───────────────────────────────────────────────────────────

  loadFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        this._lines = this._parseNdjson(e.target.result);
        resolve(this._lines.length);
      };
      reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
      reader.readAsText(file);
    });
  },

  async loadUrl(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} cargando ${url}`);
    const text = await res.text();
    this._lines = this._parseNdjson(text);
    return this._lines.length;
  },

  _parseNdjson(text) {
    return text.split('\n')
      .filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(l => l && l.t && l.raw);
  },

  connect(slug, onData, onStatus, onComment, port, onTitle, onMessage) {
    this.onData    = onData;
    this.onStatus  = onStatus;
    this.onComment = onComment;
    this.onMessage = onMessage || null;
    this._comments = [];
    this._paused   = false;
    this._parser   = this._createParser();
    this._startFrom(0);
  },

  pause() {
    if (!this._playing || this._paused) return;
    this._paused = true;
    if (this._tid) { clearTimeout(this._tid); this._tid = null; }
    this._emitStatus();
    this._updateBar();
  },

  resume() {
    if (!this._playing || !this._paused) return;
    this._paused = false;
    this._startFrom(this._currentIdx);
  },

  setSpeed(n) {
    const wasPaused = this._paused;
    if (this._playing && !this._paused) {
      if (this._tid) { clearTimeout(this._tid); this._tid = null; }
    }
    this.speed = n;
    if (this._playing && !wasPaused) this._startFrom(this._currentIdx);
    this._emitStatus();
    this._updateBar();
  },

  // Salta a una fracción (0.0 – 1.0) de la grabación
  seekTo(fraction) {
    if (!this._lines.length) return;
    const targetT = this._t0 + fraction * this._total();
    // Buscar el índice más cercano por bisección
    let lo = 0, hi = this._lines.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this._lines[mid].t < targetT) lo = mid + 1; else hi = mid;
    }
    const wasPaused = this._paused;
    if (this._tid) { clearTimeout(this._tid); this._tid = null; }
    // Reiniciar el parser para evitar estado inconsistente
    if (this._parser) this._parser = this._createParser();
    this._currentIdx = lo;
    if (wasPaused) {
      this._mediaStart = this._lines[lo].t;
      this._wallStart  = Date.now();
      this._emitStatus();
      this._updateBar();
    } else {
      this._startFrom(lo);
    }
  },

  disconnect() {
    this._playing = false;
    this._paused  = false;
    if (this._tid) { clearTimeout(this._tid); this._tid = null; }
    this._parser  = null;
  },

  // ── Lógica interna ────────────────────────────────────────────────────────

  _createParser() {
    // Parser nuevo (carga, seek, bucle) → el rebufo empieza de cero.
    window.EnTraffic?.reset();
    return ApexProtocol.createParser({
      // Reloj del LOG, no de pared: a velocidad ×N los huecos entre karts
      // (rebufo, en-traffic.js) se encogerían N veces.
      now:          ()         => this._lines[this._currentIdx]?.t ?? Date.now(),
      onGrid:       (html)     => this._parseGrid(html),
      onCountdown:  (ms, mode) => {
        if (!window.ApexClock) return;
        if (mode === 'stop') ApexClock.stop();
        else ApexClock.sync(ms, mode);
      },
      onNewSession: ()         => { if (window.ApexClock?.reset) ApexClock.reset(); window.EnTraffic?.reset(); },
      onSessionEnd: ()         => { if (window.ApexClock) ApexClock.stop(); },
      onComment:    (html)     => this._parseComment(html),
      // Sanciones y avisos (canal msg|), igual que el conector directo.
      onMessage:    (info)     => {
        if (!info || (info.kind !== 'penalty' && info.kind !== 'warning')) return;
        if (this.onMessage) this.onMessage({ ...info, ts: Date.now() });
      },
      onChange:     (state)    => this._emit(state),
    });
  },

  _startFrom(idx) {
    if (!this._lines.length) {
      if (this.onStatus) this.onStatus('error', '● Archivo vacío o sin datos válidos');
      return;
    }
    this._playing    = true;
    this._paused     = false;
    this._currentIdx = idx;
    this._t0         = this._lines[0].t;
    this._tEnd       = this._lines[this._lines.length - 1].t;
    this._mediaStart = this._lines[idx].t;
    this._wallStart  = Date.now();
    this._emitStatus();
    this._updateBar();
    this._scheduleNext(idx);
  },

  _scheduleNext(idx) {
    if (!this._playing || this._paused || idx >= this._lines.length) {
      if (idx >= this._lines.length) {
        if (this.loopMode) {
          this._parser = this._createParser();
          this._comments = [];
          this._startFrom(0);
          return;
        }
        this._playing    = false;
        this._currentIdx = this._lines.length - 1;
        if (this.onStatus) this.onStatus('disconnected', '■ Replay finalizado');
        this._updateBar();
      }
      return;
    }

    const entry     = this._lines[idx];
    const targetMs  = (entry.t - this._mediaStart) / this.speed;
    const elapsed   = Date.now() - this._wallStart;
    const wait      = Math.max(0, targetMs - elapsed);

    this._tid = setTimeout(() => {
      if (!this._playing || this._paused) return;
      this._currentIdx = idx;
      try { this._parser.parse(entry.raw); } catch(e) {}

      if (idx % 150 === 0) {
        this._emitStatus();
        this._updateBar();
      }

      this._scheduleNext(idx + 1);
    }, wait);
  },

  _fmtMs(ms) {
    const h = Math.floor(ms / 3600000);
    const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
    const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
    return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
  },

  _elapsed() {
    if (!this._lines.length) return 0;
    return this._lines[this._currentIdx].t - this._t0;
  },

  _total() {
    return this._tEnd - this._t0;
  },

  _emitStatus() {
    if (!this.onStatus) return;
    const icon  = this._paused ? '⏸' : '▶';
    const spd   = this.speed === 0 ? '∞' : `${this.speed}×`;
    const label = `${icon} ${this._fmtMs(this._elapsed())} / ${this._fmtMs(this._total())}  ·  ${spd}`;
    this.onStatus('connected', label);
  },

  // Actualiza la barra de controles en el dashboard si existe
  _updateBar() {
    const bar = document.getElementById('en-replay-bar');
    if (!bar) return;
    const pct   = this._total() > 0 ? (this._elapsed() / this._total() * 100) : 0;
    const progEl = bar.querySelector('[data-replay-prog]');
    const timeEl = bar.querySelector('[data-replay-time]');
    const btnEl  = bar.querySelector('[data-replay-btn]');
    if (progEl) progEl.style.width = `${pct.toFixed(1)}%`;
    if (timeEl) timeEl.textContent = `${this._fmtMs(this._elapsed())} / ${this._fmtMs(this._total())}`;
    if (btnEl)  btnEl.textContent  = this._paused ? '▶' : '⏸';
    // Resaltar velocidad activa
    bar.querySelectorAll('[data-spd]').forEach(el => {
      const v = el.dataset.spd === '0' ? 0 : Number(el.dataset.spd);
      el.style.background = v === this.speed ? 'rgba(167,139,250,0.3)' : 'transparent';
      el.style.color      = v === this.speed ? '#a78bfa' : '#6b7280';
    });
  },

  // Misma lectura del grid que ApexConnector (src/apex-grid.js), sin fetch HTTP
  _parseGrid(html) {
    if (!html || html.length < 10) return;
    try {
      this._parser.setGrid(ApexGrid.parseGridHtml(html));
    } catch(e) { console.error('[ReplayConnector] parseGrid:', e); }
  },

  _parseComment(html) {
    try {
      const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
      const entries = [];
      doc.querySelectorAll('p').forEach(p => {
        const txt = p.textContent.trim();
        if (txt && txt.length > 2) {
          const m    = txt.match(/^(\d{1,2}:\d{2})/);
          const time = m ? m[1] : new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
          const text = m ? txt.substring(m[0].length).trim() : txt;
          if (text) entries.push({ text, time });
        }
      });
      entries.forEach(e => {
        this._comments.unshift(e);
        if (this._comments.length > 100) this._comments.pop();
        if (this.onComment) this.onComment(e, this._comments);
      });
    } catch(e) {}
  },

  _emit(state) {
    if (this.onData) this.onData(state);
  },
};
