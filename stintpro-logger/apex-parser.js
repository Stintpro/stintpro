// ── ApexParser — port de apex-connector.js sin DOM ────────────────────────
// Mismo protocolo, mismas reglas. Callbacks en lugar de window.ApexClock.
// Grid parsing con regex (sin DOMParser).

class ApexParser {
  constructor({ onLap, onPit, onState, onSessionEnd, onNewSession } = {}) {
    this._karts          = {};
    this._colMap         = {};
    this._colByNum       = {};
    this._sessionActive  = false;
    this._sessionFinished = false;
    this._leaderLap      = 0;
    this._countdown      = null;

    // callbacks
    this.onLap        = onLap;        // (dorsal, name, lapMs, lapNumber, ts)
    this.onPit        = onPit;        // (dorsal, eventType, standsCount, ts)
    this.onState      = onState;      // (stateObj)
    this.onSessionEnd = onSessionEnd;
    this.onNewSession = onNewSession;
  }

  reset() {
    this._karts = {}; this._colMap = {}; this._colByNum = {};
    this._sessionActive = false; this._sessionFinished = false;
    this._leaderLap = 0; this._countdown = null;
  }

  parse(raw) {
    const lines = raw.split('\n');
    let changed = false;

    for (let line of lines) {
      line = line.trim();
      if (!line) continue;

      // ── VUELTA COMPLETA ──────────────────────────────────────────
      const lapM = line.match(/^(r\d+)\|\*\|(\d+)\|(\d*)$/);
      if (lapM) {
        const k = this._kart(lapM[1]);
        const ms = parseInt(lapM[2]);
        if (ms >= 20000 && ms < 300000 && !k._lapInvalid) {
          k._lapFlash = Date.now();
          if (!this._colMap.llp) {
            const t = parseFloat((ms / 1000).toFixed(3));
            const lastH = k.lapHistory[k.lapHistory.length - 1];
            if (lastH === undefined || Math.abs(lastH - t) > 0.05) {
              k.lastLap = t;
              k.lapHistory.push(t);
              if (k.lapHistory.length > 1500) k.lapHistory.shift();
              if (!k.bestLap || t < k.bestLap) k.bestLap = t;
              k._lapFromFlash = t;
              if (this.onLap && k.dorsal)
                this.onLap(k.dorsal, k.name, ms, k.lapHistory.length, Date.now());
            }
          }
          k._lapInvalid = false;
        }
        changed = true; continue;
      }

      // ── VUELTA ANULADA ───────────────────────────────────────────
      if (line.match(/^r\d+\|\*in\|0$/) || line.match(/^r\d+\|\*out\|0$/)) {
        this._kart(line.split('|')[0])._lapInvalid = true;
        changed = true; continue;
      }

      // ── SECTOR PARCIAL ───────────────────────────────────────────
      if (line.match(/^r\d+\|\*i\d+\|/)) { changed = true; continue; }

      // ── POSICIÓN DIRECTA ─────────────────────────────────────────
      const posM = line.match(/^(r\d+)\|#\|(\d+)$/);
      if (posM) {
        const p = parseInt(posM[2]);
        if (p > 0) this._kart(posM[1]).pos = p;
        changed = true; continue;
      }

      // ── GRID INICIAL ─────────────────────────────────────────────
      if (line.startsWith('grid|')) {
        if (this._sessionActive && this._sessionFinished) {
          this._karts = {}; this._leaderLap = 0; this._sessionFinished = false;
          if (this.onNewSession) this.onNewSession();
        }
        this._sessionActive = true;
        this._parseGrid(line.substring(5));
        changed = true; continue;
      }

      // ── COUNTDOWN / COUNT ────────────────────────────────────────
      if (line.startsWith('dyn1|countdown|')) {
        this._countdown = parseInt(line.split('|')[2]) || null;
        changed = true; continue;
      }
      if (line.startsWith('dyn1|count|')) {
        this._countdown = parseInt(line.split('|')[2]) || null;
        changed = true; continue;
      }

      // ── TEXTO DYN1 (vuelta del líder) ────────────────────────────
      if (line.startsWith('dyn1|text|')) {
        const txt = line.substring(10).trim();
        const lm = txt.match(/Lap\s+(\d+)\/(\d+)/i);
        if (lm) this._leaderLap = parseInt(lm[1]);
        changed = true; continue;
      }

      // ── BANDERA A CUADROS ─────────────────────────────────────────
      if (line === 'light|lf|') {
        this._sessionFinished = true;
        if (this.onSessionEnd) this.onSessionEnd();
        changed = true; continue;
      }

      // ── CELDA CON VALOR ──────────────────────────────────────────
      const cellM = line.match(/^(r\d+)(c\d+)\|([^|]*)\|(.*)/);
      if (cellM) {
        this._applyCell(this._kart(cellM[1]), cellM[2], cellM[3], cellM[4]);
        changed = true; continue;
      }

      // ── CELDA SIN VALOR ──────────────────────────────────────────
      const cellM2 = line.match(/^(r\d+)(c\d+)\|([^|]*)$/);
      if (cellM2) {
        this._applyCell(this._kart(cellM2[1]), cellM2[2], cellM2[3], '');
        changed = true;
      }
    }

    if (changed) this._emit();
  }

  // ── Aplicar celda ─────────────────────────────────────────────────────

  _kart(rowId) {
    if (!this._karts[rowId]) this._karts[rowId] = {
      _rowId: rowId, lapHistory: [], state: 'sr', tours: 0,
      pit: false, pitS: 0, pitDuration: 0, standsCount: 0,
      _lapInvalid: false, checkered: false,
    };
    return this._karts[rowId];
  }

  _applyCell(k, col, type, val) {
    const dtype = this._colByNum[col] || '';
    const v = (val !== undefined && val !== '') ? val : type;

    const STATE_CODES = ['si','so','sr','su','sd','ss','sf','gs','gf','gl','gm'];
    const isStateCol  = dtype === 'grp' || dtype === 'sta' ||
                        (col === 'c1' && !this._colMap.grp) ||
                        (col === 'c2' && !this._colByNum['c2']);
    const isStateCode = STATE_CODES.includes(type) && !dtype;

    if (isStateCol || isStateCode) {
      if (type === 'in') return;
      k.state = type;
      if (type === 'ss') k._lapInvalid = true;
      else if (['sr','su','sd','gs','gf','gl','gm'].includes(type)) k._lapInvalid = false;
      if (type === 'si') {
        k.pit = true; k.pitState = 'in'; k._pitInTime = Date.now();
        if (this.onPit && k.dorsal) this.onPit(k.dorsal, 'in', k.standsCount, Date.now());
      } else if (type === 'so') {
        k.pit = true; k.pitState = 'out'; k.pitS = 0; k._pitTimerActive = false; k._pitInTime = null;
        if (this.onPit && k.dorsal) this.onPit(k.dorsal, 'out', k.standsCount, Date.now());
      } else if (type === 'sr' || type === 'su') {
        if (!k._pitTimerActive) k.pit = false;
        k.pitState = null; k._pitInTime = null;
      }
      if (type === 'sf') k.checkered = true;
      return;
    }

    if (dtype === 'rk') {
      const p = parseInt(v);
      if (!isNaN(p) && p > 0) k.pos = p;
      return;
    }
    if (dtype === 'no') {
      const d = (v || '').trim();
      if (d && !isNaN(parseInt(d))) k.dorsal = d;
      return;
    }
    if (dtype === 'dr') {
      const n = (v || '').trim();
      const skip = ['in','tn','ti','tb','ib','sr','sd','su','si','ss','sf','gf','gl','gm','gs','to','so'];
      if (n && n.length > 1 && isNaN(parseInt(n)) && !skip.includes(n)) k.name = n;
      return;
    }
    if (dtype === 's1') { const x = parseFloat(v); if (!isNaN(x) && x > 0 && x < 120) k.s1 = x; return; }
    if (dtype === 's2') { const x = parseFloat(v); if (!isNaN(x) && x > 0 && x < 120) k.s2 = x; return; }
    if (dtype === 's3') { const x = parseFloat(v); if (!isNaN(x) && x > 0 && x < 120) k.s3 = x; return; }

    if (dtype === 'llp') {
      const t = this._pt(v);
      if (t && t >= 20 && t < 300) {
        if (k._lapFromFlash !== undefined && Math.abs(k._lapFromFlash - t) <= 0.05 && k.lapHistory.length) {
          // Refinar la vuelta ya registrada por |*|
          k.lapHistory[k.lapHistory.length - 1] = t;
          k.lastLap = t;
          k._lapFromFlash = undefined;
        } else {
          k.lastLap = t;
          k.lapHistory.push(t);
          if (k.lapHistory.length > 1500) k.lapHistory.shift();
          k._lapFromFlash = undefined;
          if (!k.bestLap || t < k.bestLap) k.bestLap = t;
          if (this.onLap && k.dorsal)
            this.onLap(k.dorsal, k.name, Math.round(t * 1000), k.lapHistory.length, Date.now());
        }
      }
      return;
    }

    if (dtype === 'blp') {
      const t = this._pt(v);
      if (t && t >= 20 && t < 300 && (!k.bestLap || t < k.bestLap)) k.bestLap = t;
      return;
    }

    if (dtype === 'gap') {
      const vRaw = v || '';
      if (/tour|lap|tr\b/i.test(vRaw)) {
        const n = parseInt(vRaw.replace(/[^\d]/g, ''));
        k.gap = !isNaN(n) && n > 0 ? '+' + n + 'v' : '';
        return;
      }
      const raw = vRaw.replace(/[a-zA-Z]/g, '').trim();
      if (!raw) { k.gap = ''; return; }
      let t;
      if (raw.includes(':')) { const p = raw.split(':'); t = parseFloat(p[0]) * 60 + parseFloat(p[1]); }
      else t = parseFloat(raw);
      if (!isNaN(t) && t >= 0) k.gap = t > 0 ? '+' + t.toFixed(3) : '';
      return;
    }

    if (dtype === 'tlp' || dtype === 'lc') {
      const n = parseInt(v); if (!isNaN(n) && n > 0) k.tours = n; return;
    }

    if (dtype === 'pit') {
      if (type === 'to') {
        const s = this._parsePitTimer(v);
        if (s !== null) { k.pitS = s; k.pit = true; k._pitTimerActive = true; }
      } else if (type === 'in') {
        k._pitTimerActive = false;
        if (k.state === 'sr' || k.state === 'su') k.pit = false;
        const n = parseInt(v); if (!isNaN(n) && n > 0) k.standsCount = n;
      }
      return;
    }

    if (dtype === 'int') {
      const raw = (v || '').replace(/[a-zA-Z]/g, '').trim();
      if (!raw) { k.interval = ''; return; }
      let t;
      if (raw.includes(':')) { const p = raw.split(':'); t = parseFloat(p[0]) * 60 + parseFloat(p[1]); }
      else t = parseFloat(raw);
      if (!isNaN(t) && t >= 0) k.interval = t > 0 ? '+' + t.toFixed(3) : '';
      return;
    }

    if (dtype === 'otr') return;

    if (type === 'to') {
      const s = this._parsePitTimer((val !== undefined && val !== '') ? val : type);
      if (s !== null) { k.pitS = s; k.pit = true; k._pitTimerActive = true; }
      return;
    }
    if (type === 'sf') k.checkered = true;
  }

  _parsePitTimer(v) {
    if (!v) return null;
    v = v.replace(/\.$/, '').trim();
    if (v.includes(':')) {
      const p = v.split(':');
      const s = parseInt(p[0]) * 60 + parseFloat(p[1]);
      return isNaN(s) ? null : Math.round(s);
    }
    const s = parseFloat(v);
    return isNaN(s) ? null : Math.round(s);
  }

  _pt(str) {
    if (!str) return null;
    str = str.replace(/[a-zA-Z]/g, '').replace(/\.$/, '').trim();
    if (!str || str.length < 2) return null;
    if (str.includes(':')) {
      const p = str.split(':');
      const v = parseFloat(p[0]) * 60 + parseFloat(p[1]);
      return isNaN(v) ? null : parseFloat(v.toFixed(3));
    }
    const n = parseFloat(str);
    if (isNaN(n) || n < 1) return null;
    return n > 1000 ? parseFloat((n / 1000).toFixed(3)) : n;
  }

  // ── Grid parsing (regex, sin DOMParser) ───────────────────────────────

  _parseGrid(html) {
    if (!html || html.length < 10) return;
    try {
      // colMap desde r0
      const r0m = html.match(/<tr[^>]*data-id=["']r0["'][^>]*>([\s\S]*?)<\/tr>/i);
      if (r0m) {
        this._colMap = {}; this._colByNum = {};
        const r0h = r0m[1];
        // Probar ambos órdenes de atributos
        const re1 = /data-id=["'](c\d+)["'][^>]*data-type=["']([^"']+)["']/gi;
        const re2 = /data-type=["']([^"']+)["'][^>]*data-id=["'](c\d+)["']/gi;
        let m;
        while ((m = re1.exec(r0h)) !== null) {
          if (!this._colByNum[m[1]]) { this._colMap[m[2].trim()] = m[1]; this._colByNum[m[1]] = m[2].trim(); }
        }
        while ((m = re2.exec(r0h)) !== null) {
          const dtype = m[1].trim(), cid = m[2];
          if (!this._colByNum[cid]) { this._colMap[dtype] = cid; this._colByNum[cid] = dtype; }
        }
      }

      // Filas de karts
      const rowRe = /<tr[^>]*data-id=["'](r\d+)["'][^>]*>([\s\S]*?)<\/tr>/gi;
      let rowM; let gridPos = 0;
      while ((rowM = rowRe.exec(html)) !== null) {
        const rowId = rowM[1];
        if (rowId === 'r0') continue;
        gridPos++;
        const rowH = rowM[2];
        const k = this._kart(rowId);

        // Estado
        const stCol = this._colMap.grp || this._colMap.sta || 'c1';
        const stm = rowH.match(new RegExp(`data-id=["']${stCol}["'][^>]*class=["']([^"']+)["']`));
        if (stm) {
          const cls = stm[1].trim().split(/\s+/)[0];
          if (cls && cls !== 'in') { k.state = cls; if (cls === 'sf') k.checkered = true; }
        }

        // Posición
        k.pos = k.pos || gridPos;
        const rkm = rowH.match(/class=["'][^"']*\brk\b[^"']*["'][^>]*>.*?<p[^>]*>(\d+)<\/p>/i);
        if (rkm) k.pos = parseInt(rkm[1]);

        // Dorsal
        const noCol = this._colMap.no;
        if (noCol) {
          const nom = rowH.match(new RegExp(`data-id=["']${noCol}["'][^>]*>[^<]*<(?:div|p)[^>]*>\\s*(\\d+)\\s*<`));
          if (nom) k.dorsal = nom[1];
        }

        // Nombre
        const drCol = this._colMap.dr;
        if (drCol) {
          const drm = rowH.match(new RegExp(`data-id=["']${drCol}["'][^>]*>\\s*<[^>]+>([^<]{2,})<`));
          if (!drm) {
            const drm2 = rowH.match(new RegExp(`data-id=["']${drCol}["'][^>]*>([^<]{2,})<`));
            if (drm2) { const n = drm2[1].trim(); if (n && isNaN(parseInt(n))) k.name = n; }
          } else {
            const n = drm[1].trim(); if (n && isNaN(parseInt(n))) k.name = n;
          }
        }

        // Best lap
        const blpCol = this._colMap.blp;
        if (blpCol) {
          const bm = rowH.match(new RegExp(`data-id=["']${blpCol}["'][^>]*>([^<]+)<`));
          if (bm) { const t = this._pt(bm[1]); if (t && t >= 20 && t < 300) k.bestLap = t; }
        }

        // Last lap (solo si no hay valor en vivo)
        const llpCol = this._colMap.llp;
        if (llpCol && !k.lastLap) {
          const lm = rowH.match(new RegExp(`data-id=["']${llpCol}["'][^>]*>([^<]+)<`));
          if (lm) { const t = this._pt(lm[1]); if (t && t >= 20 && t < 300) k.lastLap = t; }
        }

        // Vueltas
        const tlpCol = this._colMap.tlp || this._colMap.lc;
        if (tlpCol) {
          const tm = rowH.match(new RegExp(`data-id=["']${tlpCol}["'][^>]*>(\\d+)<`));
          if (tm) k.tours = parseInt(tm[1]);
        }

        // Stands count
        const pitCol = this._colMap.pit;
        if (pitCol) {
          const pm = rowH.match(new RegExp(`data-id=["']${pitCol}["'][^>]*>(\\d+)<`));
          if (pm) k.standsCount = parseInt(pm[1]);
        }

        k.tours = k.tours || 0;
      }
    } catch (e) {
      console.error('[ApexParser] parseGrid:', e.message);
    }
  }

  // ── Estado para broadcast ─────────────────────────────────────────────

  getState() {
    const now = Date.now();
    const equipos = Object.values(this._karts)
      .filter(k => k.dorsal || k._rowId)
      .map(k => { if (!k.dorsal) k.dorsal = k._rowId.replace('r', ''); return k; })
      .map(k => ({
        dorsal: k.dorsal, name: k.name || `#${k.dorsal}`,
        pos: k.pos || 99, lastLap: k.lastLap || null, bestLap: k.bestLap || null,
        lapHistory: k.lapHistory || [], gap: k.gap || '', interval: k.interval || '',
        pit: !!k.pit, pitState: k.pitState || null,
        pitS: k._pitTimerActive ? k.pitS : (k.pit && k._pitInTime ? Math.round((now - k._pitInTime) / 1000) : k.pitS || 0),
        pitDuration: k.pitDuration || 0,
        state: k.state || 'sr', s1: k.s1, s2: k.s2, s3: k.s3,
        tours: k.tours || 0, standsCount: k.standsCount || 0, stops: k.stops || 0,
        checkered: !!k.checkered, gapMs: k.gapMs || 0,
        lapFlash: false, posChange: null,
        sessionFinished: this._sessionFinished,
      }))
      .sort((a, b) => a.pos === 99 && b.pos === 99
        ? parseInt(a.dorsal) - parseInt(b.dorsal)
        : a.pos - b.pos);

    return {
      equipos,
      leaderLap: this._leaderLap,
      timestamp: now,
      sessionFinished: this._sessionFinished,
      colMap: this._colMap,
      countdown: this._countdown,
    };
  }

  _emit() {
    if (this.onState) this.onState(this.getState());
  }
}

module.exports = ApexParser;
