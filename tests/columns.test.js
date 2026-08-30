// StintPro — tests del registro de columnas (src/en-columns.js)
// Ejecutar: node tests/columns.test.js
'use strict';

const { strictEqual, deepStrictEqual, ok } = require('assert/strict');
const { COLUMNS, isAvailable, visibleColumns, gridTemplate, theadHtml, rowCells } = require('../src/en-columns');

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

console.log(`\n${passed} pasados, ${failed} fallados`);
process.exit(failed ? 1 : 0);
