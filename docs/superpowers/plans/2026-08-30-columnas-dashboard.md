# Columnas dinámicas del dashboard — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el dashboard pinte solo las columnas que Apex realmente manda, con un selector manual del usuario, y que nunca vuelva a mostrar un contador de vueltas inventado.

**Architecture:** Se extrae un registro de columnas (`src/en-columns.js`, módulo puro con el patrón UMD que ya usa `en-stint-machine.js`) que contiene, por columna, sus metadatos, su ancho en cada breakpoint, de qué `dtype` de Apex depende y cómo se pinta la celda. La cabecera, la fila y el `grid-template-columns` se generan recorriendo ese registro en vez de estar cableados. Una columna se ve si el usuario la ha marcado **y** está disponible (`colMap` de Apex la contiene). Todo el cambio vive en el cliente: no se toca ni el logger ni el VPS.

**Tech Stack:** JavaScript de navegador sin build ni framework, cargado con `<script>` desde `src/index.html`. Tests: scripts de Node planos con `assert/strict` y un mini-runner propio (`node tests/<archivo>.test.js`), sin dependencias externas ni DOM.

**Spec:** `docs/superpowers/specs/2026-08-30-columnas-dashboard-design.md`

## Global Constraints

- **Rama:** todo el trabajo va en `feat/columnas-dashboard`. No fusionar a `main` hasta validar en carrera real.
- **Sin despliegue.** Ni push a Vercel ni `scp` al VPS. Ningún paso de este plan despliega nada; si algo pareciera necesitarlo, es que el paso está mal.
- **No se toca `stintpro-logger/`.** El logger ya reenvía `colMap` intacto.
- **No se toca `_enDeriveRow()`** (`src/en-grid.js:301-400`). Los cálculos derivados se quedan exactamente como están.
- **No se toca el fallback de `tours`** en `src/apex-protocol.js:645`. De él viven las vueltas del stint (`src/en-state.js:257`) y la estrategia.
- **Paridad por defecto:** con la selección por defecto, la tabla debe quedar idéntica a la actual (mismas 14 columnas, mismo orden, mismos anchos). `Clase` entra en el catálogo con `default: false`.
- **Idioma:** comentarios y textos de UI en español, como el resto del repo.
- **Columnas fijas:** `dot`, `pos`, `kart` y `driver` no se pueden desmarcar.
- **Clave de localStorage:** `stintpro_columns`. Formato `{ v: 1, cols: [...], known: [...] }`.

---

### Task 1: Registro de columnas y disponibilidad

**Files:**
- Create: `src/en-columns.js`
- Create: `tests/columns.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: global `EnColumns` (navegador) / `module.exports` (Node) con `COLUMNS` (array de definiciones) y `isAvailable(col, colMap) -> boolean`. Cada definición tiene: `id` (string), `label` (string), `align` (`'left'|'center'|'right'`), `width` (string CSS), `widthNarrow` (string CSS), `source` (`'apex'|'stintpro'`), `fixed` (boolean, opcional), `default` (boolean, opcional — solo se pone `false`), `requires` (`null` o `(colMap) => boolean`), `head` (opcional, `(sortMode) => string`), `cell` (`(e, d) => string`).

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/columns.test.js`:

```js
// StintPro — tests del registro de columnas (src/en-columns.js)
// Ejecutar: node tests/columns.test.js
'use strict';

const { strictEqual, deepStrictEqual, ok } = require('assert/strict');
const { COLUMNS, isAvailable } = require('../src/en-columns');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}
function group(name, fn) { console.log('\n' + name); fn(); }

function col(id) {
  const c = COLUMNS.find(x => x.id === id);
  if (!c) throw new Error(`columna '${id}' no existe en el catálogo`);
  return c;
}

group('catálogo', () => {
  test('tiene 15 columnas (las 14 de hoy + Clase)', () => {
    strictEqual(COLUMNS.length, 15);
  });

  test('los ids son únicos', () => {
    strictEqual(new Set(COLUMNS.map(c => c.id)).size, COLUMNS.length);
  });

  test('el orden reproduce el de la tabla actual, con Clase tras Equipo', () => {
    deepStrictEqual(COLUMNS.map(c => c.id), [
      'dot', 'pos', 'kart', 'driver', 'team', 'class', 'tours',
      'last', 'best', 'm5v', 'delta', 'gap', 'int', 'score', 'pit',
    ]);
  });

  test('toda columna tiene ancho en los dos breakpoints', () => {
    COLUMNS.forEach(c => {
      ok(c.width, `${c.id} sin width`);
      ok(c.widthNarrow, `${c.id} sin widthNarrow`);
    });
  });

  test('toda columna sabe pintarse', () => {
    COLUMNS.forEach(c => strictEqual(typeof c.cell, 'function', `${c.id} sin cell`));
  });

  test('dot, pos, kart y driver son fijas', () => {
    deepStrictEqual(COLUMNS.filter(c => c.fixed).map(c => c.id),
      ['dot', 'pos', 'kart', 'driver']);
  });

  test('Clase es la única que no entra por defecto', () => {
    deepStrictEqual(COLUMNS.filter(c => c.default === false).map(c => c.id), ['class']);
  });
});

group('isAvailable', () => {
  test('sin requires, siempre disponible (aunque colMap esté vacío)', () => {
    strictEqual(isAvailable(col('m5v'), {}), true);
    strictEqual(isAvailable(col('team'), {}), true);
    strictEqual(isAvailable(col('score'), {}), true);
  });

  test('Vueltas necesita la columna oficial de Apex: lc', () => {
    strictEqual(isAvailable(col('tours'), { lc: 'c6' }), true);
  });

  test('Vueltas también vale con tlp', () => {
    strictEqual(isAvailable(col('tours'), { tlp: 'c6' }), true);
  });

  test('Vueltas NO está disponible sin lc ni tlp — el bug del dato inventado', () => {
    strictEqual(isAvailable(col('tours'), { rk: 'c1', no: 'c2', dr: 'c3' }), false);
  });

  test('Gap, Int, Mejor, Última y Pit dependen de su dtype', () => {
    strictEqual(isAvailable(col('gap'),  { gap: 'c9' }), true);
    strictEqual(isAvailable(col('gap'),  {}), false);
    strictEqual(isAvailable(col('int'),  { int: 'c10' }), true);
    strictEqual(isAvailable(col('int'),  {}), false);
    strictEqual(isAvailable(col('best'), { blp: 'c8' }), true);
    strictEqual(isAvailable(col('best'), {}), false);
    strictEqual(isAvailable(col('last'), { llp: 'c7' }), true);
    strictEqual(isAvailable(col('last'), {}), false);
    strictEqual(isAvailable(col('pit'),  { pit: 'c11' }), true);
    strictEqual(isAvailable(col('pit'),  {}), false);
  });

  test('Clase depende del dtype class', () => {
    strictEqual(isAvailable(col('class'), { class: 'c4' }), true);
    strictEqual(isAvailable(col('class'), {}), false);
  });

  test('el punto de estado no depende de grp/sta (el parser deduce el estado sin ellas)', () => {
    strictEqual(isAvailable(col('dot'), {}), true);
  });

  test('colMap undefined no revienta', () => {
    strictEqual(isAvailable(col('tours'), undefined), false);
    strictEqual(isAvailable(col('m5v'), undefined), true);
  });
});

console.log(`\n${passed} pasados, ${failed} fallados`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `node tests/columns.test.js`
Expected: FAIL — `Cannot find module '../src/en-columns'`

- [ ] **Step 3: Crear `src/en-columns.js`**

El HTML de cada `cell` está copiado **literalmente** de `_enRenderRow()` (`src/en-grid.js:406-424`); no reescribas nada, cópialo tal cual o romperás la paridad visual. Los anchos salen de `src/en-state.js:154` (escritorio) y `:167` (≤900px), en el mismo orden.

```js
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

  return { COLUMNS, isAvailable };
});
```

- [ ] **Step 4: Ejecutar el test para verificar que pasa**

Run: `node tests/columns.test.js`
Expected: PASS, `15 pasados, 0 fallados`

- [ ] **Step 5: Commit**

```bash
git add src/en-columns.js tests/columns.test.js
git commit -m "feat(columns): catálogo de columnas con disponibilidad por colMap"
```

---

### Task 2: Visibilidad, cabecera, celdas y grid-template

**Files:**
- Modify: `src/en-columns.js`
- Modify: `tests/columns.test.js`

**Interfaces:**
- Consumes: `COLUMNS`, `isAvailable` de la Task 1.
- Produces: `visibleColumns(colMap, selectedIds) -> Column[]`, `gridTemplate(cols, narrow) -> string`, `theadHtml(cols, sortMode) -> string`, `rowCells(cols, e, d) -> string`.

- [ ] **Step 1: Escribir el test que falla**

Añadir a `tests/columns.test.js`, **antes** de la línea del recuento final. Ojo con el `require` de arriba: pasa a ser

```js
const { COLUMNS, isAvailable, visibleColumns, gridTemplate, theadHtml, rowCells } = require('../src/en-columns');
```

y los stubs de globales van justo después de los `require` (las `cell` usan helpers que en el navegador son globales):

```js
// Stubs de los globales que usan las funciones `cell` (en el navegador los
// aportan analysis.js / en-grid.js). Se definen en `global` para que las
// referencias sueltas dentro de en-columns.js resuelvan.
global._esc            = s => String(s == null ? '' : s);
global._enFmt          = t => (t == null ? '—' : String(t));
global._enPilotHistory = {};
global._enPilotRatings = {};
global._enScoreColor   = () => '#fff';

// Equipo y derivados mínimos para pintar una fila
function fakeEquipo(over) {
  return Object.assign({
    dorsal: '7', name: 'PILOTO A', teamName: 'EQUIPO A', pos: 1,
    tours: 42, lastLap: 47.2, bestLap: 46.9, interval: '+1.203',
    standsCount: 2, category: 'PRO',
  }, over);
}
function fakeDerived() {
  return {
    kc: { bg: '#000', text: '#fff' }, kartBorder: '#22c55e', tooltip: '', qualityBadge: '',
    dotColor: '#22c55e', arrow: '', chkBadge: '', pitBadge: '', fixBadge: '',
    lastCol: '#fff', bestCol: '#fff', m5Col: '#fff', avg5: 47.0,
    trend: { color: '#fff', arrow: '→' }, deltaCol: '#fff', deltaStr: '+0.100',
    gapHtml: '—', barPct: 0, barClass: '', flash: '', pinned: false, isMe: false,
  };
}

const FULL_COLMAP = { rk: 'c1', no: 'c2', dr: 'c3', lc: 'c6', llp: 'c7', blp: 'c8', gap: 'c9', int: 'c10', pit: 'c11' };
const DEFAULT_SEL = COLUMNS.filter(c => c.default !== false).map(c => c.id);

group('visibleColumns', () => {
  test('selección por defecto + colMap completo = las 14 de hoy, en orden', () => {
    deepStrictEqual(visibleColumns(FULL_COLMAP, DEFAULT_SEL).map(c => c.id), [
      'dot', 'pos', 'kart', 'driver', 'team', 'tours',
      'last', 'best', 'm5v', 'delta', 'gap', 'int', 'score', 'pit',
    ]);
  });

  test('sin lc ni tlp, Vueltas desaparece — el bug original', () => {
    const cm = Object.assign({}, FULL_COLMAP); delete cm.lc;
    ok(!visibleColumns(cm, DEFAULT_SEL).some(c => c.id === 'tours'));
  });

  test('desmarcada pero disponible → no se ve', () => {
    const sel = DEFAULT_SEL.filter(id => id !== 'gap');
    ok(!visibleColumns(FULL_COLMAP, sel).some(c => c.id === 'gap'));
  });

  test('marcada pero no disponible → no se ve', () => {
    const cm = Object.assign({}, FULL_COLMAP); delete cm.gap;
    ok(!visibleColumns(cm, DEFAULT_SEL).some(c => c.id === 'gap'));
  });

  test('marcada y disponible → se ve', () => {
    ok(visibleColumns(FULL_COLMAP, DEFAULT_SEL).some(c => c.id === 'gap'));
  });

  test('las fijas se ven aunque no estén en la selección', () => {
    const ids = visibleColumns(FULL_COLMAP, []).map(c => c.id);
    ok(ids.includes('dot') && ids.includes('pos') && ids.includes('kart') && ids.includes('driver'));
  });

  test('Clase solo si se marca Y Apex la manda', () => {
    const conClase = DEFAULT_SEL.concat('class');
    ok(!visibleColumns(FULL_COLMAP, conClase).some(c => c.id === 'class'));
    ok(visibleColumns(Object.assign({ class: 'c4' }, FULL_COLMAP), conClase).some(c => c.id === 'class'));
  });
});

group('gridTemplate', () => {
  test('reproduce exactamente el grid-template-columns actual de escritorio', () => {
    strictEqual(gridTemplate(visibleColumns(FULL_COLMAP, DEFAULT_SEL), false),
      '20px 42px 42px 1fr minmax(0,120px) 44px 86px 86px 78px 62px 64px 62px 68px 38px');
  });

  test('reproduce exactamente el de ≤900px', () => {
    strictEqual(gridTemplate(visibleColumns(FULL_COLMAP, DEFAULT_SEL), true),
      '16px 30px 34px 1fr minmax(0,60px) 30px 62px 62px 56px 44px 46px 44px 48px 30px');
  });

  test('quitar una columna quita su tramo', () => {
    const sel = DEFAULT_SEL.filter(id => id !== 'pit');
    strictEqual(gridTemplate(visibleColumns(FULL_COLMAP, sel), false).split(' ').length, 13);
  });
});

group('theadHtml / rowCells', () => {
  test('la cabecera tiene un span por columna visible', () => {
    const cols = visibleColumns(FULL_COLMAP, DEFAULT_SEL);
    strictEqual((theadHtml(cols, 'pos').match(/<span style="text-align:/g) || []).length, cols.length);
  });

  test('cada celda produce HTML no vacío y la fila las concatena todas', () => {
    const cols = visibleColumns(FULL_COLMAP, DEFAULT_SEL);
    const trozos = cols.map(c => c.cell(fakeEquipo(), fakeDerived()));
    trozos.forEach((t, i) => ok(t.length > 0, `${cols[i].id} pinta vacío`));
    strictEqual(rowCells(cols, fakeEquipo(), fakeDerived()), trozos.join(''));
  });

  test('cabecera y fila tienen SIEMPRE el mismo recuento — si no, la rejilla se descuadra', () => {
    [DEFAULT_SEL, DEFAULT_SEL.filter(id => id !== 'gap'), []].forEach(sel => {
      const cols = visibleColumns(FULL_COLMAP, sel);
      const heads = (theadHtml(cols, 'pos').match(/<span style="text-align:/g) || []).length;
      strictEqual(heads, cols.length);
      cols.forEach(c => ok(typeof c.cell(fakeEquipo(), fakeDerived()) === 'string'));
    });
  });

  test('el toggle de orden sigue estando en Pos y en M5v', () => {
    const html = theadHtml(visibleColumns(FULL_COLMAP, DEFAULT_SEL), 'pos');
    strictEqual((html.match(/_enToggleSort\(\)/g) || []).length, 2);
  });

  test('sin la columna Vueltas, la cabecera no dice Vtas', () => {
    const cm = Object.assign({}, FULL_COLMAP); delete cm.lc;
    ok(!theadHtml(visibleColumns(cm, DEFAULT_SEL), 'pos').includes('Vtas'));
  });
});
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `node tests/columns.test.js`
Expected: FAIL — `visibleColumns is not a function`

- [ ] **Step 3: Implementar las cuatro funciones**

En `src/en-columns.js`, entre `isAvailable` y el `return` final:

```js
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
```

Y el `return` pasa a:

```js
  return { COLUMNS, isAvailable, visibleColumns, gridTemplate, theadHtml, rowCells };
```

- [ ] **Step 4: Ejecutar el test para verificar que pasa**

Run: `node tests/columns.test.js`
Expected: PASS, 0 fallados. Si `gridTemplate` no coincide al carácter con el CSS actual, corrige los anchos del catálogo — no el test: ese test **es** la paridad visual.

- [ ] **Step 5: Commit**

```bash
git add src/en-columns.js tests/columns.test.js
git commit -m "feat(columns): visibilidad, cabecera, celdas y grid-template desde el catálogo"
```

---

### Task 3: Persistencia y migración de la selección

**Files:**
- Modify: `src/en-columns.js`
- Modify: `tests/columns.test.js`

**Interfaces:**
- Consumes: `COLUMNS` de la Task 1.
- Produces: `STORAGE_KEY` (`'stintpro_columns'`), `defaultSelection() -> string[]`, `migrate(stored) -> string[]`, `loadSelection() -> string[]`, `saveSelection(ids) -> void`.

Formato guardado: `{ v: 1, cols: [ids visibles], known: [todos los ids del catálogo al guardar] }`. `known` es lo que permite distinguir *"columna nueva del catálogo"* (entra visible si su `default` no es `false`) de *"columna que el usuario desmarcó"* (sigue oculta). Sin ese campo, cualquier columna desmarcada reaparecería en el siguiente arranque.

- [ ] **Step 1: Escribir el test que falla**

Añadir a `tests/columns.test.js` (y ampliar el `require` con `defaultSelection, migrate, loadSelection, saveSelection, STORAGE_KEY`):

```js
// localStorage de mentira: en Node no existe
function fakeStorage() {
  const store = {};
  return {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    _store: store,
  };
}

group('persistencia', () => {
  test('sin nada guardado, la selección por defecto son las 14 de hoy', () => {
    deepStrictEqual(defaultSelection(), [
      'dot', 'pos', 'kart', 'driver', 'team', 'tours',
      'last', 'best', 'm5v', 'delta', 'gap', 'int', 'score', 'pit',
    ]);
  });

  test('guardar y releer devuelve lo mismo', () => {
    global.localStorage = fakeStorage();
    const sel = defaultSelection().filter(id => id !== 'gap');
    saveSelection(sel);
    deepStrictEqual(loadSelection(), sel);
  });

  test('lo guardado incluye versión y catálogo conocido', () => {
    global.localStorage = fakeStorage();
    saveSelection(['pos', 'kart']);
    const raw = JSON.parse(global.localStorage.getItem(STORAGE_KEY));
    strictEqual(raw.v, 1);
    deepStrictEqual(raw.cols, ['pos', 'kart']);
    deepStrictEqual(raw.known, COLUMNS.map(c => c.id));
  });

  test('sin localStorage disponible no revienta: cae al defecto', () => {
    delete global.localStorage;
    deepStrictEqual(loadSelection(), defaultSelection());
    saveSelection(['pos']); // no debe lanzar
  });

  test('JSON corrupto cae al defecto', () => {
    global.localStorage = fakeStorage();
    global.localStorage.setItem(STORAGE_KEY, '{esto no es json');
    deepStrictEqual(loadSelection(), defaultSelection());
  });

  test('migración: los ids desconocidos se descartan', () => {
    deepStrictEqual(
      migrate({ v: 1, cols: ['pos', 'kart', 'columna_fantasma'], known: COLUMNS.map(c => c.id) }),
      ['pos', 'kart']);
  });

  test('migración: una columna nueva del catálogo entra visible', () => {
    // 'score' no existía cuando se guardó → no está en known → entra
    const known = COLUMNS.map(c => c.id).filter(id => id !== 'score');
    ok(migrate({ v: 1, cols: ['pos', 'kart'], known }).includes('score'));
  });

  test('migración: una columna que el usuario desmarcó NO reaparece', () => {
    // 'gap' ya existía cuando se guardó (está en known) y no está en cols
    const known = COLUMNS.map(c => c.id);
    ok(!migrate({ v: 1, cols: ['pos', 'kart'], known }).includes('gap'));
  });

  test('migración: una columna nueva con default:false NO entra sola', () => {
    const known = COLUMNS.map(c => c.id).filter(id => id !== 'class');
    ok(!migrate({ v: 1, cols: ['pos'], known }).includes('class'));
  });

  test('migración: guardado antiguo sin `known` se trata como catálogo completo', () => {
    ok(!migrate({ v: 1, cols: ['pos', 'kart'] }).includes('gap'));
  });
});
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `node tests/columns.test.js`
Expected: FAIL — `defaultSelection is not a function`

- [ ] **Step 3: Implementar la persistencia**

En `src/en-columns.js`, antes del `return` final:

```js
  const STORAGE_KEY = 'stintpro_columns';
  const VERSION     = 1;

  function defaultSelection() {
    return COLUMNS.filter(c => c.default !== false).map(c => c.id);
  }

  // Reconcilia lo guardado con el catálogo actual:
  //  · ids que ya no existen  → fuera
  //  · columnas añadidas al catálogo desde el último guardado (no están en
  //    `known`) → entran visibles salvo que su default sea false
  //  · columnas que el usuario desmarcó (sí están en `known`) → siguen fuera
  function migrate(stored) {
    if (!stored || !Array.isArray(stored.cols)) return defaultSelection();
    const catalogo = new Set(COLUMNS.map(c => c.id));
    // Sin `known` (formato antiguo) se asume que conocía todo el catálogo: así
    // no se le reactivan al usuario columnas que había quitado.
    const conocidas = new Set(Array.isArray(stored.known) ? stored.known : COLUMNS.map(c => c.id));
    const kept  = stored.cols.filter(id => catalogo.has(id));
    const nuevas = COLUMNS
      .filter(c => c.default !== false && !conocidas.has(c.id))
      .map(c => c.id);
    return Array.from(new Set(kept.concat(nuevas)));
  }

  function loadSelection() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultSelection();
      return migrate(JSON.parse(raw));
    } catch (e) {
      // Sin localStorage (Node, modo privado) o JSON corrupto → defecto
      return defaultSelection();
    }
  }

  function saveSelection(ids) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        v: VERSION, cols: ids, known: COLUMNS.map(c => c.id),
      }));
    } catch (e) { /* preferencia visual: si no se puede guardar, se sigue */ }
  }
```

`return` final:

```js
  return { COLUMNS, isAvailable, visibleColumns, gridTemplate, theadHtml, rowCells,
           defaultSelection, migrate, loadSelection, saveSelection, STORAGE_KEY };
```

- [ ] **Step 4: Ejecutar el test para verificar que pasa**

Run: `node tests/columns.test.js`
Expected: PASS, 0 fallados

- [ ] **Step 5: Commit**

```bash
git add src/en-columns.js tests/columns.test.js
git commit -m "feat(columns): persistencia global en localStorage con migración de catálogo"
```

---

### Task 4: `colMap` llega a la UI y se acumula durante la sesión

**Files:**
- Modify: `src/en-strategy.js:1102-1105`
- Modify: `src/en-state.js` (estado `EnSession`, alrededor de `:7`)
- Create: `tests/colmap-seen.test.js`

**Interfaces:**
- Consumes: el snapshot que ya publica el parser (`colMap`), reenviado por el logger tal cual.
- Produces: `EnSession.data.colMap` (último `colMap` recibido) y `EnSession.colMapSeen` (unión de los vistos en la sesión). Función pura exportada para test: `EnColumns.mergeColMap(prev, next) -> object`.

**Por qué la unión:** `colMap` se vacía en el `_reset()` del parser. Una reconexión a mitad de carrera lo dejaría vacío hasta que Apex reenvíe el grid, y las columnas desaparecerían y reaparecerían solas. La disponibilidad se calcula sobre la unión de todo lo visto en la sesión.

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/colmap-seen.test.js`:

```js
// StintPro — tests de la acumulación de colMap durante una sesión
// Ejecutar: node tests/colmap-seen.test.js
'use strict';

const { deepStrictEqual } = require('assert/strict');
const { mergeColMap } = require('../src/en-columns');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

console.log('\nmergeColMap');

test('sin previo, devuelve el nuevo', () => {
  deepStrictEqual(mergeColMap(null, { rk: 'c1' }), { rk: 'c1' });
});

test('un colMap vacío NO borra lo ya visto (reconexión a mitad de carrera)', () => {
  deepStrictEqual(mergeColMap({ rk: 'c1', lc: 'c6' }, {}), { rk: 'c1', lc: 'c6' });
});

test('colMap undefined tampoco borra nada', () => {
  deepStrictEqual(mergeColMap({ lc: 'c6' }, undefined), { lc: 'c6' });
});

test('suma dtypes nuevos', () => {
  deepStrictEqual(mergeColMap({ rk: 'c1' }, { lc: 'c6' }), { rk: 'c1', lc: 'c6' });
});

test('si Apex reordena el grid, gana la posición nueva', () => {
  deepStrictEqual(mergeColMap({ lc: 'c6' }, { lc: 'c9' }), { lc: 'c9' });
});

console.log(`\n${passed} pasados, ${failed} fallados`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `node tests/colmap-seen.test.js`
Expected: FAIL — `mergeColMap is not a function`

- [ ] **Step 3: Implementar `mergeColMap` y cablearlo**

En `src/en-columns.js`, junto a las demás funciones:

```js
  // Unión de colMaps de la sesión. El parser vacía su colMap al resetear, y una
  // reconexión dejaría la tabla sin columnas hasta que Apex reenvíe el grid.
  function mergeColMap(prev, next) {
    return Object.assign({}, prev || {}, next || {});
  }
```

y añadirla al `return`.

En `src/en-state.js`, en la definición de `EnSession` (junto a `data:` en `:7`), añadir el campo:

```js
  colMapSeen:       {},   // unión de los colMap de Apex vistos en esta sesión
```

En `src/en-strategy.js`, justo después de `EnSession.data.sessionMode=data.sessionMode||'';` (`:1104`):

```js
        // colMap: qué columnas manda Apex en esta sesión. Se acumula porque el
        // parser lo vacía al resetear y una reconexión dejaría la tabla coja.
        EnSession.colMapSeen = EnColumns.mergeColMap(EnSession.colMapSeen, data.colMap);
        EnSession.data.colMap = EnSession.colMapSeen;
```

En `src/en-strategy.js:1366` (`EnSession.data={equipos:[],...}`, el reset de sesión nueva), añadir en la misma función el reseteo:

```js
  EnSession.colMapSeen = {};
```

Añadir el `<script>` en `src/index.html`, **antes** de `en-grid.js` (línea 74) y después de `en-state.js`:

```html
  <script src="en-columns.js"></script>
```

- [ ] **Step 4: Ejecutar los tests**

Run: `node tests/colmap-seen.test.js && node tests/columns.test.js`
Expected: PASS los dos

- [ ] **Step 5: Commit**

```bash
git add src/en-columns.js src/en-state.js src/en-strategy.js src/index.html tests/colmap-seen.test.js
git commit -m "feat(columns): colMap llega a la UI y se acumula durante la sesión"
```

---

### Task 5: La cabecera y la fila se generan desde el catálogo

**Files:**
- Modify: `src/en-grid.js:404-430` (`_enRenderRow`), `:431-460` (`_enRenderRows`), `:642-654` (`_enTheadHtml`)
- Create: `tests/columns-parity.test.js`

**Interfaces:**
- Consumes: `EnColumns.visibleColumns`, `theadHtml`, `rowCells`, `loadSelection`; `EnSession.colMapSeen` de la Task 4.
- Produces: `EnUi.cols` (array de columnas visibles, recalculado en cada render) y `_enActiveColumns()` en `en-grid.js`.

**Test de paridad:** compara el HTML generado por el catálogo con el que producía la fila cableada. Es la red de seguridad de todo el refactor.

- [ ] **Step 1: Escribir el test de paridad que falla**

Crear `tests/columns-parity.test.js`:

```js
// StintPro — paridad visual del refactor de columnas
// El HTML generado desde el catálogo debe ser idéntico, carácter a carácter, al
// que producía _enRenderRow() cableada (src/en-grid.js:404, commit 097c8b1).
// Ejecutar: node tests/columns-parity.test.js
'use strict';

const { strictEqual } = require('assert/strict');
const { COLUMNS, visibleColumns, rowCells, defaultSelection } = require('../src/en-columns');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

global._esc            = s => String(s == null ? '' : s);
global._enFmt          = t => (t == null ? '—' : String(t));
global._enPilotHistory = {};
global._enPilotRatings = {};
global._enScoreColor   = () => '#22c55e';

const e = {
  dorsal: '7', name: 'PILOTO A', teamName: 'EQUIPO A', pos: 3, tours: 42,
  lastLap: 47.2, bestLap: 46.9, interval: '+1.203', standsCount: 2,
};
const d = {
  kc: { bg: '#111', text: '#eee' }, kartBorder: '#22c55e', tooltip: 'tt', qualityBadge: '',
  dotColor: '#22c55e', arrow: '', chkBadge: '', pitBadge: '', fixBadge: '',
  lastCol: '#aaa', bestCol: '#bbb', m5Col: '#ccc', avg5: 47.05,
  trend: { color: '#ddd', arrow: '→' }, deltaCol: '#eee', deltaStr: '+0.150',
  gapHtml: '+2.100',
};

// Copia literal del cuerpo de _enRenderRow() ANTES del refactor
const ESPERADO =
  `<div class="sp-dot" style="background:${d.dotColor}"></div>` +
  `<div class="sp-pos">${e.pos === 99 ? '—' : e.pos}${d.arrow}</div>` +
  `<div><div class="en-kart" style="background:${d.kc.bg};color:${d.kc.text};border:1.5px solid ${d.kartBorder}" onclick="_enToggleQuality('${e.dorsal}',event)" title="${d.tooltip}">${e.dorsal}${d.qualityBadge}</div></div>` +
  `<div class="sp-name">${d.chkBadge}${global._esc(e.name)}${d.pitBadge}${d.fixBadge}</div>` +
  `<div class="sp-name" style="font-size:12px;color:var(--text-3)">${global._esc(e.teamName)}</div>` +
  `<div class="sp-vtas">${e.tours}</div>` +
  `<div class="sp-t" style="color:${d.lastCol}">${global._enFmt(e.lastLap)}</div>` +
  `<div class="sp-t" style="color:${d.bestCol}">${global._enFmt(e.bestLap)}</div>` +
  `<div class="en-m5" style="color:${d.m5Col}">${global._enFmt(d.avg5)}<span style="color:${d.trend.color};font-size:10px;margin-left:2px">${d.trend.arrow}</span></div>` +
  `<div class="en-delta" style="color:${d.deltaCol}">${d.deltaStr}</div>` +
  `<div class="sp-gap">${d.gapHtml}</div>` +
  `<div class="sp-gap">${e.interval}</div>` +
  `<div class="sp-cons" style="cursor:pointer" onclick="_enShowLapHistory('${e.dorsal}',event)" title="Ver vueltas de la sesión"><span style="color:#2d2f38">—</span></div>` +
  `<div class="sp-pitc">${e.standsCount}</div>`;

const FULL_COLMAP = { rk: 'c1', no: 'c2', dr: 'c3', lc: 'c6', llp: 'c7', blp: 'c8', gap: 'c9', int: 'c10', pit: 'c11' };

console.log('\nparidad de la fila');

test('el catálogo reproduce la fila cableada carácter a carácter', () => {
  strictEqual(rowCells(visibleColumns(FULL_COLMAP, defaultSelection()), e, d), ESPERADO);
});

console.log(`\n${passed} pasados, ${failed} fallados`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Ejecutar el test para verificar dónde estamos**

Run: `node tests/columns-parity.test.js`
Expected: PASS si el catálogo de la Task 1 se copió literalmente. Si FALLA, el diff señala exactamente qué `cell` se apartó del original — arregla el catálogo, nunca el esperado.

- [ ] **Step 3: Cablear `en-grid.js` al catálogo**

Añadir cerca del principio de `src/en-grid.js`:

```js
// Columnas visibles ahora mismo: selección del usuario ∩ lo que manda Apex.
// Se recalcula en cada render porque el colMap cambia al empezar sesión.
function _enActiveColumns(){
  return EnColumns.visibleColumns(EnSession.colMapSeen, EnColumns.loadSelection());
}
```

`_enTheadHtml()` (`:642`) pasa a ser:

```js
function _enTheadHtml(){
  return EnColumns.theadHtml(_enActiveColumns(), EnUi.sortMode);
}
```

`_enRenderRow(e, d)` (`:404`) pasa a recibir las columnas y usar `rowCells`:

```js
function _enRenderRow(e, d, cols){
  return`
  <div class="sp-rowwrap">
    <div class="en-row ${d.flash}${d.pinned?' sp-pinned':''}${d.isMe?' en-myrow':''}" onclick="_enPin('${e.dorsal}')">
      ${EnColumns.rowCells(cols, e, d)}
      <div class="sp-lapbar ${d.barClass}" id="en-bar-${e.dorsal}" style="width:${d.barPct}%"></div>
    </div>
  </div>`;
}
```

En `_enRenderRows` (`:431`), calcular las columnas una vez y pasarlas:

```js
  const cols=_enActiveColumns();
```

justo después del `let html='';`, y cambiar la llamada del `forEach`:

```js
      html+=_enRenderRow(e, _enDeriveRow(e, trackAvg, bestSess, leader, myDorsal), cols);
```

- [ ] **Step 4: Ejecutar toda la suite**

Run: `node tests/columns-parity.test.js && node tests/columns.test.js && node tests/colmap-seen.test.js && node tests/apex-protocol.test.js && node tests/stint-timer.test.js && node tests/analysis.test.js && node tests/kart-quality.test.js && node tests/session-changes.test.js && node tests.js`
Expected: PASS todo, 0 fallados

- [ ] **Step 5: Commit**

```bash
git add src/en-grid.js tests/columns-parity.test.js
git commit -m "refactor(grid): cabecera y fila generadas desde el catálogo de columnas"
```

---

### Task 6: CSS dinámico y scroll horizontal

**Files:**
- Modify: `src/en-state.js:154-168` (bloque de estilos de `.en-thead` / `.en-row`)
- Modify: `src/en-grid.js` (nueva `_enApplyColumnStyle`)

**Interfaces:**
- Consumes: `EnColumns.gridTemplate`, `_enActiveColumns()` de la Task 5.
- Produces: `_enApplyColumnStyle(cols)`, que inyecta/actualiza `<style id="en-col-style">`.

- [ ] **Step 1: Quitar los anchos cableados**

En `src/en-state.js`:

- `.en-thead` (`:154`): quitar `grid-template-columns:...;` (dejar el resto de la regla).
- `.en-row` (`:160`): quitar `grid-template-columns:...;`.
- Borrar las dos reglas de alineación por posición, que ya no valen con columnas variables (la alineación la pone ahora cada `<span>` desde el catálogo):
  ```css
  .en-thead span:nth-child(4),.en-thead span:nth-child(5){text-align:left;}
  .en-thead span:nth-child(1),.en-thead span:nth-child(2){text-align:center;}
  ```
  La regla `.en-thead span{...text-align:right;}` se queda: es el defecto y cada span la sobreescribe.
- En la media query `@media (max-width:900px)` (`:167`): quitar el `grid-template-columns:...` de `.en-thead,.en-row`, conservando `column-gap:4px;padding-left:8px;padding-right:8px;`.
- Añadir el scroll horizontal y el estilo de la celda de Clase:
  ```css
    .en-thead{overflow-x:auto;scrollbar-width:none;}
    .en-thead::-webkit-scrollbar{display:none;}
    .sp-body{overflow-x:auto;}
    .sp-cls{font-size:12px;color:var(--text-3);text-align:center;}
  ```

- [ ] **Step 2: Implementar la inyección de estilo**

En `src/en-grid.js`, junto a `_enActiveColumns`:

```js
// El grid-template-columns deja de estar cableado en el CSS: se calcula desde
// los anchos del catálogo. Dos reglas, una por breakpoint, en un <style> propio.
function _enApplyColumnStyle(cols){
  let el=document.getElementById('en-col-style');
  if(!el){ el=document.createElement('style'); el.id='en-col-style'; document.head.appendChild(el); }
  const ancho=EnColumns.gridTemplate(cols,false);
  const estrecho=EnColumns.gridTemplate(cols,true);
  el.textContent=
    `.en-thead,.en-row{grid-template-columns:${ancho};}`+
    `@media (max-width:900px){.en-thead,.en-row{grid-template-columns:${estrecho};}}`;
}
```

Llamarla desde `_enRenderRows`, justo después de `const cols=_enActiveColumns();`:

```js
  _enApplyColumnStyle(cols);
```

y también en `_enTheadHtml()` no hace falta: el thead se pinta en el mismo ciclo.

- [ ] **Step 3: Sincronizar el scroll de cabecera y cuerpo**

Con `overflow-x` en los dos, al desplazar el cuerpo la cabecera se queda quieta. En `src/en-grid.js`, dentro del bloque que crea el skeleton (`:54`, `if(!el.querySelector('.sp-body')){`), después de insertar el HTML:

```js
    // Cabecera y cuerpo scrollean juntos en horizontal
    const _b=el.querySelector('#en-grid-body'), _h=el.querySelector('#en-thead');
    if(_b&&_h)_b.addEventListener('scroll',()=>{ _h.scrollLeft=_b.scrollLeft; });
```

- [ ] **Step 4: Ejecutar la suite y comprobar que no hay regresión**

Run: `node tests/columns.test.js && node tests/columns-parity.test.js && node tests.js`
Expected: PASS

Comprobación adicional, para asegurar que no queda ningún ancho cableado:

Run: `grep -n "grid-template-columns" src/en-state.js`
Expected: ninguna línea de `.en-thead` ni `.en-row` (sí pueden salir `.setup-root`, `.kpis`, etc.)

- [ ] **Step 5: Commit**

```bash
git add src/en-state.js src/en-grid.js
git commit -m "feat(grid): grid-template-columns calculado y scroll horizontal sincronizado"
```

---

### Task 7: Panel de selección de columnas

**Files:**
- Modify: `src/en-columns.js` (función pura `panelHtml`)
- Modify: `tests/columns.test.js`
- Modify: `src/en-grid.js` (botón, apertura/cierre y guardado)

**Interfaces:**
- Consumes: `COLUMNS`, `isAvailable`, `loadSelection`, `saveSelection`.
- Produces: `EnColumns.panelHtml(colMap, selectedIds) -> string`; en `en-grid.js`, `_enToggleColumnPanel()` y `_enSetColumn(id, on)`.

- [ ] **Step 1: Escribir el test que falla**

Añadir a `tests/columns.test.js` (y al `require`, `panelHtml`):

```js
group('panel de selección', () => {
  test('lista todas las columnas del catálogo', () => {
    const html = panelHtml(FULL_COLMAP, DEFAULT_SEL);
    COLUMNS.forEach(c => ok(html.includes(`data-col="${c.id}"`), `falta ${c.id}`));
  });

  test('agrupa en De Apex y De StintPro', () => {
    const html = panelHtml(FULL_COLMAP, DEFAULT_SEL);
    ok(html.includes('De Apex'));
    ok(html.includes('De StintPro'));
  });

  test('las fijas salen marcadas y deshabilitadas', () => {
    const html = panelHtml(FULL_COLMAP, []);
    const fila = html.split('data-col="pos"')[1].split('</label>')[0];
    ok(fila.includes('checked'));
    ok(fila.includes('disabled'));
  });

  test('una columna que Apex no manda sale deshabilitada y con el motivo', () => {
    const html = panelHtml({ rk: 'c1', no: 'c2', dr: 'c3' }, DEFAULT_SEL);
    const fila = html.split('data-col="tours"')[1].split('</label>')[0];
    ok(fila.includes('disabled'));
    ok(html.includes('este circuito no la manda'));
  });

  test('una columna disponible y marcada sale marcada y habilitada', () => {
    const html = panelHtml(FULL_COLMAP, DEFAULT_SEL);
    const fila = html.split('data-col="gap"')[1].split('</label>')[0];
    ok(fila.includes('checked'));
    ok(!fila.includes('disabled'));
  });
});
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `node tests/columns.test.js`
Expected: FAIL — `panelHtml is not a function`

- [ ] **Step 3: Implementar `panelHtml`**

En `src/en-columns.js`:

```js
  // HTML del panel de selección. Función pura: el cableado de eventos vive en
  // en-grid.js. Las no disponibles salen deshabilitadas CON el motivo, para que
  // la ausencia no parezca un bug de la app.
  function panelHtml(colMap, selectedIds) {
    const sel = new Set(selectedIds || []);
    const fila = c => {
      const disponible = isAvailable(c, colMap);
      const marcada    = c.fixed || (sel.has(c.id) && disponible);
      const bloqueada  = c.fixed || !disponible;
      const motivo     = c.fixed ? 'siempre visible'
                       : !disponible ? 'este circuito no la manda' : '';
      return `<label class="en-col-item${bloqueada ? ' en-col-off' : ''}" data-col="${c.id}">`
           + `<input type="checkbox" data-col="${c.id}"${marcada ? ' checked' : ''}${bloqueada ? ' disabled' : ''}`
           + ` onchange="_enSetColumn('${c.id}',this.checked)">`
           + `<span>${c.label || '·'}</span>`
           + (motivo ? `<em class="en-col-why">${motivo}</em>` : '')
           + `</label>`;
    };
    const grupo = (titulo, src) =>
      `<div class="en-col-group"><div class="en-col-title">${titulo}</div>`
      + COLUMNS.filter(c => c.source === src).map(fila).join('')
      + `</div>`;
    return `<div class="en-col-panel" id="en-col-panel">`
         + grupo('De Apex', 'apex')
         + grupo('De StintPro', 'stintpro')
         + `</div>`;
  }
```

Añadirla al `return`.

- [ ] **Step 4: Ejecutar el test para verificar que pasa**

Run: `node tests/columns.test.js`
Expected: PASS

- [ ] **Step 5: Cablear el panel en la UI**

En `src/en-grid.js`, junto a `_enToggleSort` (`:634`):

```js
function _enToggleColumnPanel(){
  const cont=document.getElementById('en-col-panel-wrap');
  if(!cont)return;
  const abierto=cont.innerHTML!=='';
  cont.innerHTML=abierto?'':EnColumns.panelHtml(EnSession.colMapSeen, EnColumns.loadSelection());
}

function _enSetColumn(id,on){
  const sel=new Set(EnColumns.loadSelection());
  if(on)sel.add(id); else sel.delete(id);
  EnColumns.saveSelection(EnColumns.COLUMNS.filter(c=>sel.has(c.id)).map(c=>c.id));
  const thead=document.getElementById('en-thead');
  if(thead)thead.innerHTML=_enTheadHtml();
  _enRender();
}
```

`saveSelection` recibe los ids **en el orden del catálogo**, no en el de marcado: así el orden persistido nunca depende de en qué orden se pulsaron las casillas.

En el skeleton (`src/en-grid.js:194`), justo antes del `<div class="en-thead"...>`:

```js
  <div class="en-col-bar" style="${EnUi.tab==='grid'?'':'display:none'}">
    <span class="en-col-btn" onclick="_enToggleColumnPanel()" title="Elegir columnas">⚙ Columnas</span>
    <div id="en-col-panel-wrap"></div>
  </div>
```

Estilos, en el bloque de `src/en-state.js` junto a los de `.en-thead`:

```css
    .en-col-bar{position:relative;padding:4px 14px;flex-shrink:0;}
    .en-col-btn{font-size:11px;color:var(--text-3);cursor:pointer;letter-spacing:.5px;text-transform:uppercase;}
    .en-col-btn:hover{color:#F5A623;}
    .en-col-panel{position:absolute;z-index:50;top:22px;left:14px;background:#13141a;border:0.5px solid #252630;border-radius:10px;padding:10px 12px;display:flex;gap:18px;box-shadow:0 8px 24px rgba(0,0,0,.5);}
    .en-col-title{font-size:10px;color:#555;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;}
    .en-col-item{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-2);padding:2px 0;cursor:pointer;}
    .en-col-item.en-col-off{opacity:.45;cursor:default;}
    .en-col-why{font-size:10px;color:#555;font-style:normal;}
```

- [ ] **Step 6: Ejecutar la suite completa**

Run: `node tests/columns.test.js && node tests/columns-parity.test.js && node tests/colmap-seen.test.js && node tests.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/en-columns.js src/en-grid.js src/en-state.js tests/columns.test.js
git commit -m "feat(columns): panel de selección con motivo de las no disponibles"
```

---

### Task 8: Columna Clase — portar la categoría al parser de la app

**Files:**
- Modify: `src/apex-protocol.js` (constantes ~`:23`, `_applyCell` `:202`, `getState` `:620`, `setGrid` `:673`, `reset` `:724`)
- Modify: `src/apex-connector.js:115-176`
- Modify: `src/replay-connector.js:237-270`
- Modify: `tests/apex-protocol.test.js`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `category` (string o `null`) por equipo en el snapshot del parser de la app, e `isValidCategory(v) -> boolean` exportada. Es el dato que consume la `cell` de la columna `class` (Task 1).

**Contexto:** el parser del logger ya hace esto (`stintpro-logger/apex-parser.js:53-67` y `stintpro-logger/apex-protocol.js:46-52, 239-241, 758`). En modo logger la categoría **ya llega**; esta task es para que el modo directo (app → Apex) se comporte igual. Copia de allí, no reinventes.

- [ ] **Step 1: Escribir el test que falla**

Añadir a `tests/apex-protocol.test.js`, siguiendo el estilo del archivo:

```js
group('categoría / clase', () => {
  function parserConClase() {
    const p = createParser({});
    p.setGrid({
      colMap:   { no: 'c1', dr: 'c2', class: 'c4', llp: 'c3' },
      colByNum: { c1: 'no', c2: 'dr', c4: 'class', c3: 'llp' },
      catCol:   'c4',
      karts: [{ rowId: 'r1', pos: 1, dorsal: '7', name: 'TEAM A' }],
    });
    return p;
  }

  test('la celda de la columna class llega como category', () => {
    const p = parserConClase();
    p.ingest('r1c4|tn|390');
    strictEqual(p.getState().equipos[0].category, '390');
  });

  test('un código de estado colado en esa columna no es categoría', () => {
    const p = parserConClase();
    p.ingest('r1c4|tn|sr');
    strictEqual(p.getState().equipos[0].category, null);
  });

  test('un tiempo colado en esa columna no es categoría', () => {
    const p = parserConClase();
    p.ingest('r1c4|tn|1:04.500');
    strictEqual(p.getState().equipos[0].category, null);
  });

  test('un nombre largo colado al reordenar el grid no es categoría', () => {
    const p = parserConClase();
    p.ingest('r1c4|tn|Moises Morales Gonzalez');
    strictEqual(p.getState().equipos[0].category, null);
  });

  test('sin columna class, category es null', () => {
    const p = parserWithLlp();
    strictEqual(p.getState().equipos[0].category, null);
  });
});
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `node tests/apex-protocol.test.js`
Expected: FAIL — `category` es `undefined`, no `'390'`

- [ ] **Step 3: Portar la categoría desde el parser del logger**

En `src/apex-protocol.js`, junto a `STATE_CODES` (`:23`), añadir (copiado de `stintpro-logger/apex-protocol.js:31-52`):

```js
  // Tokens que nunca son una categoría aunque caigan en su columna: marcas de
  // agrupación visual, kart doblado y demás ruido de la columna de estado.
  const GROUP_MARKS = new Set(['in','sl','tn','ti','tb','ib','to']);
  // Nombres de tipo de columna de Apex. Al reordenar el grid entre mangas, la
  // columna de categoría cambia de sitio y por ella entran fugazmente celdas de
  // otro tipo: se ha visto llegar el propio token 'dr' como valor.
  const DTYPE_TOKENS = new Set([
    'rk','no','dr','llp','blp','gap','int','tlp','lc','pit','otr',
    's1','s2','s3','grp','sta','nat','class','rku','rkb','rkw','rke',
  ]);

  // ¿Parece una categoría real (PRO, AMATEUR, 270, 390…) y no ruido del feed?
  function isValidCategory(v) {
    const s = String(v == null ? '' : v).trim();
    if (!s || s.length > 16) return false;
    if (STATE_CODES.has(s) || GROUP_MARKS.has(s) || DTYPE_TOKENS.has(s)) return false;
    if (/\d[.:,]\d/.test(s)) return false;   // 29.415, 1:04.500, +1,2
    return true;
  }
```

Estado del módulo, junto a `let _colMap = {};` (`:100`):

```js
    let _catCol          = null;   // columna de categoría/cilindrada (si el circuito la manda)
```

En `_applyCell`, **antes** del bloque de Estado (`:206`), igual que en el logger:

```js
      if (_catCol && col === _catCol) {
        if (!k.category) { const c = (v || '').trim(); if (isValidCategory(c)) k.category = c; }
        return;
      }
```

En `getState()`, dentro del objeto que se devuelve por equipo (junto a `state: k.state || 'sr'`, `:637`):

```js
            category: k.category || null,
```

En `setGrid` (`:673`), aceptar y guardar `catCol`, y arrastrar la categoría del grid:

```js
      setGrid({ colMap, colByNum, karts: gridKarts, otrIsPit, catCol } = {}) {
        _colMap   = colMap   || {};
        _catCol   = catCol   || null;
```

y dentro del bucle que copia campos del grid (junto a `if (kg.tours) k.tours = kg.tours;`, `:716`):

```js
          if (kg.category && !k.category && isValidCategory(kg.category)) k.category = kg.category;
```

En el `reset` interno (`:724`), añadir `_catCol = null;` a la línea que limpia `_colMap`.

Exportar el helper en el `return` del módulo:

```js
  return { createParser, parseTime, isGlitchLap, createRaceStartTracker, createFlagTracker, isValidCategory };
```

- [ ] **Step 4: Detectar la columna en los dos conectores**

En `src/apex-connector.js`, en el bloque que construye `colMap` (`:115-123`), añadir junto a las constantes del archivo:

```js
const CAT_HEADER = /categor|clase|classe|cilindr|^\s*(cat|cls|cc)\.?\s*$/i;
const RESERVED_DTYPES = new Set(['rk','no','dr','llp','blp','gap','int','tlp','lc','pit','otr','s1','s2','s3','grp','sta','nat','rku']);
```

y dentro del bucle de cabeceras, después de `if (cid && dtype) { colMap[dtype] = cid; colByNum[cid] = dtype; }`:

```js
        if (dtype === 'class') catCol = cid;
        else if (!catCol && CAT_HEADER.test(th.textContent || '') && !RESERVED_DTYPES.has(dtype)) catCol = cid;
```

declarando `let catCol = null;` junto a `const colMap = {}, colByNum = {};`, y pasándolo en la llamada de `:176`:

```js
      this._parser.setGrid({ colMap, colByNum, karts: gridKarts, otrIsPit, catCol });
```

Repetir lo mismo en `src/replay-connector.js` (`:237-244` y su `setGrid`), que es una copia del mismo bloque.

Nota: el nombre de la variable del elemento de cabecera (`th`) puede diferir en cada conector — usa el que ya exista en ese bucle en vez de inventarlo.

- [ ] **Step 5: Ejecutar la suite completa**

Run: `node tests/apex-protocol.test.js && node tests/columns.test.js && node tests/columns-parity.test.js && node tests/colmap-seen.test.js && node tests/stint-timer.test.js && node tests/analysis.test.js && node tests/kart-quality.test.js && node tests/session-changes.test.js && node tests.js`
Expected: PASS todo, 0 fallados

- [ ] **Step 6: Commit**

```bash
git add src/apex-protocol.js src/apex-connector.js src/replay-connector.js tests/apex-protocol.test.js
git commit -m "feat(parser): la app lee la categoría de Apex, como ya hacía el logger"
```

---

### Task 9: Verificación end-to-end y checklist de carrera

**Files:**
- Modify: `docs/superpowers/specs/2026-08-30-columnas-dashboard-design.md` (marcar estado implementado)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada de código. Cierra el trabajo dejando constancia de qué se verificó y qué queda pendiente de una carrera real.

**Limitación conocida:** el arranque de la app pasa por Supabase (`src/app.js:5-18`: rol de usuario y flag `demo_mode`), así que un agente sin sesión iniciada **no puede** cargar el dashboard en un navegador. La verificación automática llega hasta el HTML generado; el resto es una comprobación manual de Javier.

- [ ] **Step 1: Verificar que no queda nada cableado**

Run: `grep -n "sp-vtas\|sp-pitc\|Vtas\|Δ Pista" src/en-grid.js`
Expected: ninguna coincidencia — todo eso vive ahora en `src/en-columns.js`

Run: `grep -c "en-columns.js" src/index.html`
Expected: `1`

- [ ] **Step 2: Ejecutar la suite entera una última vez**

Run: `for f in tests/*.test.js; do echo "== $f"; node "$f" || exit 1; done && node tests.js`
Expected: PASS todo. Anota el total de tests: debe ser ≥ 222 + los nuevos.

- [ ] **Step 3: Escribir el checklist manual en el spec**

Añadir al final de `docs/superpowers/specs/2026-08-30-columnas-dashboard-design.md`:

```markdown
## Verificación pendiente en la app real

Requiere sesión iniciada (el arranque consulta Supabase). A comprobar por
Javier antes de fusionar a `main`:

- [ ] Con la selección por defecto, la tabla se ve **igual que antes**.
- [ ] El botón "⚙ Columnas" abre el panel y las casillas responden.
- [ ] Desmarcar una columna la quita de cabecera y filas a la vez, sin
      descuadrar la rejilla.
- [ ] La selección sobrevive a recargar la página.
- [ ] En un circuito sin columna de vueltas, "Vtas" no aparece (antes salía un
      número inventado).
- [ ] En un circuito con categorías, "Clase" se puede marcar y muestra el valor.
- [ ] En iPad: si las columnas no caben, la tabla scrollea en horizontal y la
      cabecera acompaña al cuerpo.
- [ ] Una reconexión a mitad de sesión no hace desaparecer columnas.
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-08-30-columnas-dashboard-design.md
git commit -m "docs: checklist de verificación en carrera real"
```

- [ ] **Step 5: Parar y avisar**

**NO fusionar a `main`. NO hacer push. NO desplegar.** El trabajo se queda en
`feat/columnas-dashboard` hasta que Javier complete el checklist del paso 3 en
una sesión real. Si algo no funciona, la vuelta atrás es no fusionar.
