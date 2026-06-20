// ── ApexParser — wrapper Node.js sobre ApexProtocol ───────────────────────
// Responsabilidades: grid HTML (node-html-parser), callbacks de BD, relay de estado.

const { parse: parseHTML }          = require('node-html-parser');
const { createParser, parseTime }   = require('../src/apex-protocol');

class ApexParser {
  constructor({ onLap, onPit, onState, onSessionEnd, onNewSession } = {}) {
    this._proto = createParser({
      onLap,
      onPit,
      onSessionEnd,
      onNewSession,
      onGrid:    (html)  => this._parseGrid(html),
      onChange:  (state) => { if (onState) onState(state); },
    });
  }

  reset()        { this._proto.reset(); }
  parse(raw)     { this._proto.parse(raw); }
  getState()     { return this._proto.getState(); }

  // Propiedades accedidas por circuit-monitor
  get sessionFinished() { return this._proto.sessionFinished; }
  get kartCount()       { return this._proto.kartCount; }

  _parseGrid(html) {
    if (!html || html.length < 10) return;
    try {
      const root = parseHTML(`<table><tbody>${html}</tbody></table>`);
      const colMap = {}, colByNum = {};

      const r0 = root.querySelector('tr[data-id="r0"]');
      if (r0) {
        r0.querySelectorAll('td[data-id]').forEach(td => {
          const cid   = td.getAttribute('data-id');
          const dtype = (td.getAttribute('data-type') || '').trim();
          if (cid && dtype) { colMap[dtype] = cid; colByNum[cid] = dtype; }
        });
      }

      const skip = ['in','tn','ti','tb','ib','sr','sd','su','si','ss','sf','gf','gl','gm','gs','to','so'];
      const gridKarts = [];
      let gridPos = 0;

      root.querySelectorAll('tr[data-id]').forEach(row => {
        const rowId = row.getAttribute('data-id');
        if (!rowId || rowId === 'r0') return;
        gridPos++;
        const kg   = { rowId };
        const cell = col => row.querySelector(`[data-id="${rowId}${col}"]`);

        const stCol  = colMap.grp || colMap.sta || 'c1';
        const stCell = cell(stCol);
        if (stCell) {
          const cls = (stCell.getAttribute('class') || '').trim().split(/\s+/)[0];
          if (cls && cls !== 'in') kg.state = cls;
        }

        kg.pos = gridPos;
        const rkEl = row.querySelector('td.rk p') || row.querySelector('td.rk div');
        if (rkEl) { const p = parseInt(rkEl.text.trim()); if (!isNaN(p) && p > 0) kg.pos = p; }

        if (colMap.no) {
          const c = cell(colMap.no);
          if (c) { const d = (c.querySelector('div') || c.querySelector('p') || c).text.trim(); if (d && !isNaN(parseInt(d))) kg.dorsal = d; }
        }

        if (colMap.dr) {
          const c = cell(colMap.dr);
          if (c) { const n = c.text.trim(); if (n && n.length > 1 && isNaN(parseInt(n)) && !skip.includes(n)) kg.name = n; }
        }

        if (colMap.blp) {
          const c = cell(colMap.blp);
          if (c) { const t = parseTime(c.text.trim()); if (t && t >= 20 && t < 300) kg.bestLap = t; }
        }

        if (colMap.llp) {
          const c = cell(colMap.llp);
          if (c) { const t = parseTime(c.text.trim()); if (t && t >= 20 && t < 300) kg.lastLap = t; }
        }

        const tlpCol = colMap.tlp || colMap.lc;
        if (tlpCol) {
          const c = cell(tlpCol);
          if (c) { const n = parseInt(c.text.trim()); if (!isNaN(n) && n > 0) kg.tours = n; }
        }

        if (colMap.pit) {
          const c = cell(colMap.pit);
          if (c) { const n = parseInt(c.text.trim()); if (!isNaN(n)) kg.standsCount = n; }
        }

        gridKarts.push(kg);
      });

      this._proto.setGrid({ colMap, colByNum, karts: gridKarts });
    } catch(e) {
      console.error('[ApexParser] parseGrid:', e.message);
    }
  }
}

module.exports = ApexParser;
