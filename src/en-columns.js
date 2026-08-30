// ── en-columns.js — catálogo de columnas del dashboard de clasificación ──
// Funciona en browser (window.EnColumns) y Node.js (module.exports).
// Sin dependencias de DOM: las funciones `cell`/`head` solo construyen strings.
//
// POR QUÉ EXISTE:
//   Las columnas estaban cableadas en tres sitios (grid-template-columns de
//   en-state.js, _enTheadHtml y _enRenderRow de en-grid.js). Eso impedía
//   ocultarlas y, peor, hacía que el dashboard rellenara huecos que Apex no
//   manda (Vueltas mostraba el conteo local desde la conexión, no el oficial).
//   Ver docs/superpowers/specs/2026-08-30-columnas-dashboard-design.md
//
// CONTRATO DE UNA COLUMNA:
//   id           identificador estable — se persiste en localStorage
//   label        texto de cabecera
//   align        alineación de la cabecera ('left'|'center'|'right')
//   width        ancho CSS en pantalla ancha
//   widthNarrow  ancho CSS en ≤900px
//   source       'apex' (pinta un dato de Apex) | 'stintpro' (lo calculamos)
//   fixed        true → no se puede desmarcar
//   default      false → no entra en la selección por defecto
//   requires     null (siempre disponible) | (colMap) => boolean
//   head         opcional, (sortMode) => HTML interno de la cabecera
//   cell         (e, d) => HTML de la celda. `e` es el equipo del snapshot,
//                `d` los valores derivados de _enDeriveRow().

(function (root, factory) {
  // En Electron el renderer tiene 'module' pero también 'window' → usar el path
  // de browser cuando hay DOM, igual que apex-protocol.js.
  if (typeof module !== 'undefined' && module.exports && typeof window === 'undefined') {
    module.exports = factory();
  } else {
    root.EnColumns = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COLUMNS = [
    {
      id: 'dot', label: '', align: 'center',
      width: '20px', widthNarrow: '16px',
      source: 'stintpro', fixed: true,
      // Sin requires a propósito: el parser deduce el estado también sin
      // grp/sta, por los códigos sueltos y la secuencia si→so
      // (src/apex-protocol.js:208). Además es fija: hacerla desaparecer
      // descuadraría la rejilla por un dato secundario.
      requires: null,
      cell: (e, d) => `<div class="sp-dot" style="background:${d.dotColor}"></div>`,
    },
    {
      id: 'pos', label: 'Pos', align: 'center',
      width: '42px', widthNarrow: '30px',
      source: 'apex', fixed: true,
      requires: cm => !!cm.rk,
      head: sortMode => `<span style="cursor:pointer;color:${sortMode === 'pos' ? '#F5A623' : '#333'};text-decoration:underline dotted;text-underline-offset:3px" onclick="_enToggleSort()" title="Ordenar por posición real">Pos${sortMode === 'pos' ? ' ▼' : ''}</span>`,
      cell: (e, d) => `<div class="sp-pos">${e.pos === 99 ? '—' : e.pos}${d.arrow}</div>`,
    },
    {
      id: 'kart', label: 'Kart', align: 'center',
      width: '42px', widthNarrow: '34px',
      source: 'apex', fixed: true,
      requires: cm => !!cm.no,
      cell: (e, d) => `<div><div class="en-kart" style="background:${d.kc.bg};color:${d.kc.text};border:1.5px solid ${d.kartBorder}" onclick="_enToggleQuality('${e.dorsal}',event)" title="${d.tooltip}">${e.dorsal}${d.qualityBadge}</div></div>`,
    },
    {
      id: 'driver', label: 'Piloto', align: 'left',
      width: '1fr', widthNarrow: '1fr',
      source: 'apex', fixed: true,
      requires: cm => !!cm.dr,
      cell: (e, d) => `<div class="sp-name">${d.chkBadge}${_esc(e.name)}${d.pitBadge}${d.fixBadge}${_enPilotHistory?.[e.name] ? `<span class="en-info-btn" onclick="_enShowPilotHistory(${_esc(JSON.stringify(e.name || ''))},event)" title="Ver historial">ℹ</span>` : ''}</div>`,
    },
    {
      id: 'team', label: 'Equipo', align: 'left',
      width: 'minmax(0,120px)', widthNarrow: 'minmax(0,60px)',
      source: 'stintpro',
      requires: null,
      cell: (e, d) => `<div class="sp-name" style="font-size:12px;color:var(--text-3)">${(() => { const tn = (e.teamName && e.teamName !== e.name) ? e.teamName : null; return tn ? _esc(tn) : '—'; })()}</div>`,
    },
    {
      id: 'class', label: 'Clase', align: 'center',
      width: '64px', widthNarrow: '46px',
      source: 'apex', default: false,
      requires: cm => !!cm.class,
      cell: (e, d) => `<div class="sp-cls">${e.category ? _esc(e.category) : '—'}</div>`,
    },
    {
      id: 'tours', label: 'Vtas', align: 'right',
      width: '44px', widthNarrow: '30px',
      source: 'apex',
      // La columna oficial de Apex es la ÚNICA fuente válida: k.tours solo se
      // rellena desde los dtype lc/tlp (src/apex-protocol.js:398). Sin ella, el
      // snapshot cae a contar lapHistory, que son las vueltas vistas desde que
      // conectamos — un número más bajo que el real si se conecta tarde.
      requires: cm => !!(cm.lc || cm.tlp),
      cell: (e, d) => `<div class="sp-vtas">${e.tours}</div>`,
    },
    {
      id: 'last', label: 'Última', align: 'right',
      width: '86px', widthNarrow: '62px',
      source: 'apex',
      requires: cm => !!cm.llp,
      cell: (e, d) => `<div class="sp-t" style="color:${e.lastLap ? d.lastCol : '#2d2f38'}">${_enFmt(e.lastLap)}</div>`,
    },
    {
      id: 'best', label: 'Mejor', align: 'right',
      width: '86px', widthNarrow: '62px',
      source: 'apex',
      requires: cm => !!cm.blp,
      cell: (e, d) => `<div class="sp-t" style="color:${e.bestLap ? d.bestCol : '#2d2f38'}">${_enFmt(e.bestLap)}</div>`,
    },
    {
      id: 'm5v', label: 'M5v', align: 'right',
      width: '78px', widthNarrow: '56px',
      source: 'stintpro',
      requires: null,
      head: sortMode => `<span style="cursor:pointer;color:${sortMode === 'm5v' ? '#F5A623' : 'rgba(245,166,35,0.55)'};text-decoration:underline dotted;text-underline-offset:3px" onclick="_enToggleSort()" title="Ordenar por media de 5 vueltas (ritmo real)">M5v${sortMode === 'm5v' ? ' ▼' : ''}</span>`,
      cell: (e, d) => `<div class="en-m5" style="color:${d.m5Col}">${d.avg5 ? _enFmt(d.avg5) : '—'}<span style="color:${d.trend.color};font-size:10px;margin-left:2px">${d.trend.arrow}</span></div>`,
    },
    {
      id: 'delta', label: 'Δ Pista', align: 'right',
      width: '62px', widthNarrow: '44px',
      source: 'stintpro',
      requires: null,
      cell: (e, d) => `<div class="en-delta" style="color:${d.deltaCol}">${d.deltaStr}</div>`,
    },
    {
      id: 'gap', label: 'Gap', align: 'right',
      width: '64px', widthNarrow: '46px',
      source: 'apex',
      requires: cm => !!cm.gap,
      cell: (e, d) => `<div class="sp-gap">${d.gapHtml}</div>`,
    },
    {
      id: 'int', label: 'Int', align: 'right',
      width: '62px', widthNarrow: '44px',
      source: 'apex',
      requires: cm => !!cm.int,
      cell: (e, d) => `<div class="sp-gap">${e.interval || '—'}</div>`,
    },
    {
      id: 'score', label: 'Score', align: 'right',
      width: '68px', widthNarrow: '48px',
      source: 'stintpro',
      requires: null,
      cell: (e, d) => `<div class="sp-cons" style="cursor:pointer" onclick="_enShowLapHistory('${e.dorsal}',event)" title="Ver vueltas de la sesión">${(() => { const r = _enPilotRatings[e.name]; const s = typeof r === 'object' ? r?.score : r; return s != null ? `<span style="color:${_enScoreColor(s)};font-weight:600;font-size:12px">${s}</span>` : '<span style="color:#2d2f38">—</span>'; })()}</div>`,
    },
    {
      id: 'pit', label: 'Pit', align: 'right',
      width: '38px', widthNarrow: '30px',
      // El contador lo llevamos nosotros, pero se alimenta de la columna pit
      // de Apex: sin ella el número sería siempre 0.
      source: 'stintpro',
      requires: cm => !!cm.pit,
      cell: (e, d) => `<div class="sp-pitc">${e.standsCount || 0}</div>`,
    },
  ];

  function isAvailable(col, colMap) {
    if (!col.requires) return true;
    return !!col.requires(colMap || {});
  }

  // Una columna se ve si el usuario la marcó (o es fija) Y Apex da su dato.
  function visibleColumns(colMap, selectedIds) {
    const sel = new Set(selectedIds || []);
    return COLUMNS.filter(c => (c.fixed || sel.has(c.id)) && isAvailable(c, colMap));
  }

  function gridTemplate(cols, narrow) {
    return cols.map(c => (narrow ? c.widthNarrow : c.width)).join(' ');
  }

  function theadHtml(cols, sortMode) {
    return cols.map(c => {
      const inner = c.head ? c.head(sortMode) : c.label;
      return `<span style="text-align:${c.align}">${inner}</span>`;
    }).join('');
  }

  function rowCells(cols, e, d) {
    return cols.map(c => c.cell(e, d)).join('');
  }

  return { COLUMNS, isAvailable, visibleColumns, gridTemplate, theadHtml, rowCells };
});
