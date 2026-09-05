// ── Apex Timing WebSocket Connector v3.0 ─────────────────────────────────
// Wrapper browser sobre ApexProtocol (src/apex-protocol.js).
// Responsabilidades: WebSocket, grid HTML (DOMParser), ApexClock, comentarios.

// URL absoluta a propósito: la usan tanto la web (stintpro.vercel.app) como
// la app Electron (origen file://), que no puede resolver rutas relativas.
const APEX_PROXY_URL = 'https://stintpro.vercel.app/api/apex-proxy';

// Cabeceras que delatan una columna de categoría/cilindrada
// var (no const): apex-connector.js y replay-connector.js son <script> clásicos
// cargados en el mismo scope global de index.html — un `const` duplicado entre
// ambos lanza "Identifier ha sido declarado" y aborta el segundo script entero.
var CAT_HEADER = /categor|clase|classe|cilindr|^\s*(cat|cls|cc)\.?\s*$/i;
// Quita acentos antes de testear la cabecera: el francés manda "Catégorie" con é
// y /categor/ no casa con la é → la columna Clase no se ofrecía (Le Mans). var por
// el mismo motivo que CAT_HEADER (scope global compartido con replay-connector).
var stripAccents = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
// dtypes que ya tienen significado propio: nunca son la columna de categoría
var RESERVED_DTYPES = new Set(['rk','no','dr','llp','blp','gap','int','tlp','lc','pit','otr','s1','s2','s3','grp','sta','nat','rku']);

window.ApexConnector = {
  ws: null, slug: null, port: 7913, connected: false,
  onData: null, onStatus: null, onComment: null, onTitle: null, onMessage: null,
  _reconnectTimer: null,
  _parser: null,
  _comments: [],
  _httpPort: null,
  _historyFetched: false,
  _raceTracker: null,   // ancla de salida oficial (com|) — ver apex-protocol
  _raceStart: null,     // {at, clock, source} cacheado para adjuntar al estado
  _flagTracker: null,   // bandera del panel + estado carrera detenida — ver apex-protocol
  _raceStopped: false,  // ¿carrera detenida por roja con carrera activa?

  connect(slug, onData, onStatus, onComment, port, onTitle, onMessage) {
    this.slug = slug; this.port = port || 7913;
    this.onData = onData; this.onStatus = onStatus; this.onComment = onComment; this.onTitle = onTitle || null;
    this.onMessage = onMessage || null;
    this._comments = [];
    this._httpPort = null; this._historyFetched = false;
    this._raceTracker = ApexProtocol.createRaceStartTracker();
    this._raceStart = null;
    this._flagTracker = ApexProtocol.createFlagTracker();
    this._raceStopped = false;
    // Desarmar el socket anterior ANTES de cerrarlo: su onclose se dispara en
    // async (después de que connect() retorne) con this.slug ya apuntando a la
    // sesión nueva, y programaría una reconexión paralela a los 5s → dos
    // sockets alimentando el mismo parser (vueltas duplicadas vía llp).
    this._disarm(this.ws); this.ws = null;
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
        if (this._raceTracker) this._raceTracker.onNewSession();
        this._raceStart = this._raceTracker ? this._raceTracker.raceStart : null;
        if (this._flagTracker) this._flagTracker.reset();
        this._raceStopped = false;
        if (this.onStatus) this.onStatus('connected', '● Nueva sesión');
      },
      onSessionEnd: ()         => {
        if (window.ApexClock) ApexClock.stop();
        if (this._raceTracker) this._raceTracker.clear();
        this._raceStart = null;
        if (this._flagTracker) this._flagTracker.reset();
        this._raceStopped = false;
      },
      onTitle:      (title)    => { if (this.onTitle) this.onTitle(title); },
      onComment:    (html)     => this._parseComment(html),
      // Sanciones y avisos (canal msg|). Las mejores vueltas del evento se
      // descartan aquí igual que en el logger: son 684 de 887 y no son señal.
      onMessage:    (info)     => {
        if (!info || (info.kind !== 'penalty' && info.kind !== 'warning')) return;
        if (this.onMessage) this.onMessage({ ...info, ts: Date.now() });
      },
      onFlag:       (flag, ctx)=> {
        this._flagTracker.ingest(flag, ctx || {});
        this._raceStopped = this._flagTracker.stopped;
        // Re-emitir ya para que el cartel reaccione sin esperar al siguiente tick
        if (this._parser) this._emit(this._parser.getState());
      },
      onChange:     (state)    => this._emit(state),
    });

    this._doConnect();
    this._fetchHttpPort();
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

  // Quita los handlers y cierra el socket — un ws reemplazado no debe volver a
  // hablar (onmessage tardío contra un parser nulo, onclose que reconecta).
  _disarm(ws) {
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
    try { ws.close(); } catch(e) {}
  },

  disconnect() {
    this.slug = null;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    this._disarm(this.ws); this.ws = null;
    this.connected = false;
    this._parser = null;
  },

  _parseGrid(html) {
    if (!html || html.length < 10) return;
    try {
      const doc = new DOMParser().parseFromString(`<table><tbody>${html}</tbody></table>`, 'text/html');
      const colMap = {}, colByNum = {};
      let otrIsPit = false;
      let catCol = null;

      const r0 = doc.querySelector('tr[data-id="r0"]');
      if (r0) {
        r0.querySelectorAll('td[data-id]').forEach(td => {
          const cid   = td.getAttribute('data-id');
          const dtype = (td.getAttribute('data-type') || '').trim();
          if (cid && dtype) { colMap[dtype] = cid; colByNum[cid] = dtype; }
          // otr = "Tiempo en PIT" en unos circuitos, "tiempo en pista" en otros:
          // se discrimina por el texto de la cabecera.
          if (dtype === 'otr' && /\b(pit|box)\b/i.test(td.textContent || '')) otrIsPit = true;

          if (dtype === 'class') catCol = cid;
          else if (!catCol && CAT_HEADER.test(stripAccents(td.textContent)) && !RESERVED_DTYPES.has(dtype)) {
            catCol = cid;
            // Solo colMap.class, NUNCA colByNum[cid]: colByNum fija el dtype que usa
            // _applyCell para decidir el parseo de la celda (estado, tiempos...), y no
            // debe cambiar solo porque el texto de cabecera delate una categoría. Aquí
            // únicamente se alimenta `requires: cm => !!cm.class` del catálogo de
            // columnas (en-columns.js), para que la columna Clase se pueda marcar como
            // disponible también cuando la categoría se detectó por texto y no por
            // data-type="class" — si no, el dato llegaría pero la columna seguiría oculta.
            colMap.class = cid;
          }
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
        if (drCell) { const n = drCell.textContent.trim(); if (n && !/^\d+(\.\d+)?$/.test(n)) kg.name = n; }

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

      this._parser.setGrid({ colMap, colByNum, karts: gridKarts, otrIsPit, catCol });
      if (!this._historyFetched) this._fetchLapHistories();
    } catch(e) { console.error('[ApexConnector] parseGrid:', e); }
  },

  _parseComment(html) {
    // Ancla de salida oficial: el com| crudo trae el cronograma con data-flag.
    // Se alimenta el tracker ANTES de aplanar el HTML a texto para el feed de
    // comentarios. Una verde nueva → se cachea y se re-emite el estado ya, para
    // que el dashboard reancle el stint 1 sin esperar al siguiente tick.
    if (this._raceTracker) {
      const raceInProgress = !!(window.ApexClock && window.ApexClock._synced);
      const rs = this._raceTracker.ingest(html, { raceInProgress });
      if (rs) { this._raceStart = rs; if (this._parser) this._emit(this._parser.getState()); }
    }
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

  async _fetchHttpPort() {
    if (!this.slug) return;
    try {
      // apex-timing.com no manda Access-Control-Allow-Origin → el navegador bloquea
      // la lectura de la respuesta si se pide directamente. Se pasa por nuestro
      // proxy (api/apex-proxy.js), que hace el fetch servidor-a-servidor.
      const res  = await fetch(APEX_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'config', slug: this.slug }),
        signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined,
      });
      const { text } = await res.json();
      const m = (text || '').match(/var configPort\s*=\s*(\d+)/);
      if (m) this._httpPort = parseInt(m[1]);
    } catch(e) {}
  },

  async _fetchLapHistories() {
    if (this._historyFetched || !this._httpPort || !this._parser) return;
    const kartIds = this._parser.getKartIds();
    if (!kartIds.length) return;
    this._historyFetched = true;
    if (this.onStatus) this.onStatus('connected', '● Cargando historial...');

    const port = this._httpPort;

    // TEMPORAL — investigar qué traen .P/.B/.INF (hoy solo se parsea .L, el resto se
    // descarta). Loguear solo el primer kart para no inundar la consola. Quitar este
    // bloque en cuanto se haya inspeccionado una respuesta real.
    let _debugLogged = false;

    await Promise.allSettled(kartIds.slice(0, 30).map(async ({ rowId }) => {
      const id = rowId.replace('r', '');
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const req = `D%23-100%23D${id}.L%23-999%23D${id}.P%232%23D${id}.B%231%23D${id}.INF`;
        // Mismo motivo que _fetchHttpPort: apex-timing.com no manda CORS, se pasa
        // por nuestro proxy en vez de pedirlo directamente.
        const res = await fetch(APEX_PROXY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'history', port, request: req }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        const { text: rawText } = await res.json();
        const text = (rawText || '').trim();
        if (!text || text === 'error') return;

        // Solo interesa como muestra un kart con vueltas reales (no un hueco vacío
        // del grid, dorsal "0" sin historial) — si no tiene .L, seguir buscando.
        const lines = text.split('\n');
        const hasLapLine = lines.some(l => l.includes(`D${id}.L`));
        if (!_debugLogged && hasLapLine) {
          _debugLogged = true;
          console.log(`[StintPro DEBUG request.php] kart r${id} — respuesta completa (${lines.length} líneas):`);
          console.log(text);
          console.log('[StintPro DEBUG request.php] líneas .L (vueltas):',
            lines.filter(l => l.includes(`D${id}.L`)));
          console.log('[StintPro DEBUG request.php] líneas .P (posible historial de pits):',
            lines.filter(l => l.includes(`D${id}.P#`)));
          console.log('[StintPro DEBUG request.php] líneas .BL (mejor vuelta oficial — confirmado, no .B):',
            lines.filter(l => l.includes(`D${id}.BL#`)));
          console.log('[StintPro DEBUG request.php] líneas .INF (posible info kart/piloto):',
            lines.filter(l => l.includes(`D${id}.INF`)));
        }

        const laps = [];
        text.split('\n').forEach(line => {
          const m = line.match(new RegExp(`^D${id}\\.L(\\d+)#[^|]*\\|[^|]*\\|[^|]*\\|([\\da-zA-Z]+)`));
          if (!m) return;
          const ms = parseInt(m[2].replace(/[a-zA-Z]/g, ''));
          if (isNaN(ms) || ms < 20000 || ms >= 300000) return;
          laps.push({ n: parseInt(m[1]), t: parseFloat((ms / 1000).toFixed(3)) });
        });

        laps.sort((a, b) => a.n - b.n);
        if (laps.length && this._parser)
          this._parser.mergeHttpHistory(rowId, laps.map(l => l.t), laps.length);
      } catch(e) {}
    }));

    if (this.onStatus) this.onStatus('connected', '● Apex conectado');
    if (this._parser) this._emit(this._parser.getState());
  },

  _emit(state) {
    if (this._raceStart) state.raceStart = this._raceStart;
    state.raceStopped = this._raceStopped;   // state.flag ya viene de getState()
    if (this.onData) this.onData(state);
  },
};
