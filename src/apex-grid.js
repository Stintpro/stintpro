// ── apex-grid.js — lectura del grid HTML de Apex en el navegador ──────────
// Una sola copia para los dos conectores de la app (ApexConnector directo y
// ReplayConnector). Antes cada uno tenía su bucle "copia fiel" y se separaron:
// el replay perdió la detección de otr=crono de pit y ninguno leía la celda de
// categoría (la columna Clase salía "—" en modo directo y replay).
// Refleja stintpro-logger/apex-parser.js (_parseGrid), que es la referencia.
// Necesita los globales DOMParser y ApexProtocol.

// var (no const): script clásico en el scope global compartido de index.html.
// Cabeceras que delatan una columna de categoría/cilindrada
var CAT_HEADER = /categor|clase|classe|cilindr|^\s*(cat|cls|cc)\.?\s*$/i;
// Quita acentos antes de testear la cabecera: el francés manda "Catégorie" con é
// y /categor/ no casa con la é (Le Mans).
var stripAccents = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
// dtypes que ya tienen significado propio: nunca son la columna de categoría
var RESERVED_DTYPES = new Set(['rk','no','dr','llp','blp','gap','int','tlp','lc','pit','otr','s1','s2','s3','grp','sta','nat','rku']);
// Códigos de estado/clase que Apex cuela a veces en la celda de nombre
var GRID_NAME_SKIP = new Set(['in','tn','ti','tb','ib','sr','sd','su','si','ss','sf','gf','gl','gm','gs','to','so']);

window.ApexGrid = {
  // html = lo que sigue a "grid|" → { colMap, colByNum, karts, otrIsPit, catCol }
  parseGridHtml(html) {
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
        if (!cid) return;
        if (dtype === 'class') catCol = cid;
        else if (!catCol && CAT_HEADER.test(stripAccents(td.textContent)) && !RESERVED_DTYPES.has(dtype)) catCol = cid;
      });
    }
    // Solo colMap.class, NUNCA colByNum[cid]: colByNum fija cómo _applyCell parsea
    // la celda. colMap.class habilita la columna Clase (en-columns.js) también
    // cuando la categoría se detectó por el texto de cabecera.
    if (catCol) colMap.class = catCol;

    const karts = [];
    let gridPos = 0;
    doc.querySelectorAll('tr[data-id]').forEach(row => {
      const rowId = row.getAttribute('data-id');
      if (!rowId || rowId === 'r0') return;
      gridPos++;
      const kg = { rowId };
      // id exacto (r12c1), no sufijo: [data-id$="c1"] casaría también c11/c21
      const cell = col => row.querySelector(`[data-id="${rowId}${col}"]`);

      // Estado: con grp y sta a la vez (Sevilla) el código va en sta y grp trae
      // la marca de grupo 'in'. Se toma la primera celda cuya clase es un código.
      for (const col of [colMap.sta, colMap.grp, 'c1']) {
        const c = col && cell(col);
        const cls = c ? (c.className || '').trim().split(/\s+/)[0] : '';
        if (cls && ApexProtocol.isStateCode(cls)) { kg.state = cls; break; }
      }

      const rkP = row.querySelector('td.rk p');
      kg.pos = rkP ? (parseInt(rkP.textContent.trim()) || gridPos) : gridPos;

      if (colMap.no) {
        const c = cell(colMap.no);
        const noDiv = (c && (c.querySelector('div') || c.querySelector('p') || c)) || row.querySelector('td.no div');
        if (noDiv) {
          const d = noDiv.textContent.trim(); if (d && !isNaN(parseInt(d))) kg.dorsal = d;
          // Categoría por color del dorsal: la clase notcNNN codifica el color (BGR).
          const cm = (noDiv.className || '').match(/notc(\d+)/);
          if (cm) { const hex = ApexProtocol.notcToHex(cm[1]); if (hex) kg.catColor = hex; }
        }
      }

      const drCell = colMap.dr ? cell(colMap.dr) : row.querySelector('.dr');
      if (drCell) {
        const n = drCell.textContent.trim();
        if (n && n.length > 1 && !/^\d+(\.\d+)?$/.test(n) && !GRID_NAME_SKIP.has(n)) kg.name = n;
      }

      if (colMap.blp) {
        const c = cell(colMap.blp);
        if (c) { const t = ApexProtocol.parseTime(c.textContent); if (t && t >= 20 && t < 300) kg.bestLap = t; }
      }
      if (colMap.llp) {
        const c = cell(colMap.llp);
        if (c) { const t = ApexProtocol.parseTime(c.textContent); if (t && t >= 20 && t < 300) kg.lastLap = t; }
      }
      const tlpCol = colMap.tlp || colMap.lc;
      if (tlpCol) {
        const c = cell(tlpCol);
        if (c) { const n = parseInt(c.textContent.trim()); if (!isNaN(n) && n > 0) kg.tours = n; }
      }
      if (colMap.pit) {
        const c = cell(colMap.pit);
        if (c) { const n = parseInt(c.textContent.trim()); if (!isNaN(n) && n >= 0) kg.standsCount = n; }
      }
      if (catCol) {
        const c = cell(catCol);
        if (c) { const t = c.textContent.trim(); if (ApexProtocol.isValidCategory(t)) kg.category = t; }
      }
      karts.push(kg);
    });
    return { colMap, colByNum, karts, otrIsPit, catCol };
  },
};
