// ── Apex Timing WebSocket Connector v3.0 ─────────────────────────────────
// Wrapper browser sobre ApexProtocol (src/apex-protocol.js).
// Responsabilidades: WebSocket, grid HTML (DOMParser), ApexClock, comentarios.

window.ApexConnector = {
  ws: null, slug: null, port: 7913, connected: false,
  onData: null, onStatus: null, onComment: null,
  _reconnectTimer: null,
  _parser: null,
  _comments: [],

  connect(slug, onData, onStatus, onComment, port) {
    this.slug = slug; this.port = port || 7913;
    this.onData = onData; this.onStatus = onStatus; this.onComment = onComment;
    this._comments = [];
    if (this.ws) { try { this.ws.close(); } catch(e) {} this.ws = null; }
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }

    this._parser = ApexProtocol.createParser({
      onGrid:       (html)     => this._parseGrid(html),
      onCountdown:  (ms, mode) => {
        if (!window.ApexClock) return;
        if (mode === 'stop') ApexClock.stop();
        else ApexClock.sync(ms, mode);
      },
      onNewSession: ()         => {
        if (window.ApexClock?.reset) ApexClock.reset();
        if (this.onStatus) this.onStatus('connected', '● Nueva sesión');
      },
      onSessionEnd: ()         => { if (window.ApexClock) ApexClock.stop(); },
      onComment:    (html)     => this._parseComment(html),
      onChange:     (state)    => this._emit(state),
    });

    this._doConnect();
  },

  _doConnect() {
    try {
      this.ws = new WebSocket(`wss://live-data.apex-timing.com:${this.port}/`);
      this.ws.onopen = () => {
        this.connected = true;
        if (this.onStatus) this.onStatus('connected', '● Apex conectado');
        this.ws.send(this.slug);
      };
      this.ws.onmessage = (e) => {
        try { this._parser.parse(e.data); } catch(err) { console.error('[ApexConnector]', err); }
      };
      this.ws.onerror  = () => { if (this.onStatus) this.onStatus('error', '● Error de conexión'); };
      this.ws.onclose  = () => {
        this.connected = false;
        if (this.onStatus) this.onStatus('disconnected', '● Reconectando...');
        if (this.slug) this._reconnectTimer = setTimeout(() => this._doConnect(), 5000);
      };
    } catch(e) { if (this.onStatus) this.onStatus('error', '● No se pudo conectar'); }
  },

  disconnect() {
    this.slug = null;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this.ws) { try { this.ws.close(); } catch(e) {} this.ws = null; }
    this.connected = false;
    this._parser = null;
  },

  _parseGrid(html) {
    if (!html || html.length < 10) return;
    try {
      const doc = new DOMParser().parseFromString(`<table><tbody>${html}</tbody></table>`, 'text/html');
      const colMap = {}, colByNum = {};

      const r0 = doc.querySelector('tr[data-id="r0"]');
      if (r0) {
        r0.querySelectorAll('td[data-id]').forEach(td => {
          const cid   = td.getAttribute('data-id');
          const dtype = (td.getAttribute('data-type') || '').trim();
          if (cid && dtype) { colMap[dtype] = cid; colByNum[cid] = dtype; }
        });
      }

      const gridKarts = [];
      let gridPos = 0;
      doc.querySelectorAll('tr[data-id]').forEach(row => {
        const rowId = row.getAttribute('data-id');
        if (!rowId || rowId === 'r0') return;
        gridPos++;
        const kg = { rowId };

        const stCol  = colMap.grp || colMap.sta || 'c1';
        const stCell = row.querySelector(`[data-id$="${stCol}"]`);
        if (stCell) { const cls = stCell.className.trim(); if (cls && cls !== 'in') kg.state = cls; }

        const rkP = row.querySelector('td.rk p');
        kg.pos = rkP ? (parseInt(rkP.textContent.trim()) || gridPos) : gridPos;

        if (colMap.no) {
          const noDiv = row.querySelector(`[data-id$="${colMap.no}"] div`) || row.querySelector('td.no div');
          if (noDiv) { const d = noDiv.textContent.trim(); if (d && !isNaN(parseInt(d))) kg.dorsal = d; }
        }

        const drCell = colMap.dr ? row.querySelector(`[data-id$="${colMap.dr}"]`) : row.querySelector('.dr');
        if (drCell) { const n = drCell.textContent.trim(); if (n && isNaN(parseInt(n))) kg.name = n; }

        if (colMap.blp) {
          const c = row.querySelector(`[data-id$="${colMap.blp}"]`);
          if (c) { const t = ApexProtocol.parseTime(c.textContent); if (t && t >= 20 && t < 300) kg.bestLap = t; }
        }

        if (colMap.llp) {
          const c = row.querySelector(`[data-id$="${colMap.llp}"]`);
          if (c) { const t = ApexProtocol.parseTime(c.textContent); if (t && t >= 20 && t < 300) kg.lastLap = t; }
        }

        if (colMap.tlp) {
          const c = row.querySelector(`[data-id$="${colMap.tlp}"]`);
          if (c) { const n = parseInt(c.textContent.trim()); if (!isNaN(n) && n > 0) kg.tours = n; }
        }

        if (colMap.pit) {
          const c = row.querySelector(`[data-id$="${colMap.pit}"]`);
          if (c) { const n = parseInt(c.textContent.trim()); if (!isNaN(n) && n >= 0) kg.standsCount = n; }
        }

        gridKarts.push(kg);
      });

      this._parser.setGrid({ colMap, colByNum, karts: gridKarts });
    } catch(e) { console.error('[ApexConnector] parseGrid:', e); }
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
      if (!entries.length) {
        const txt = doc.body.textContent.trim();
        if (txt && txt.length > 2)
          entries.push({ text: txt, time: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) });
      }
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
