// StintPro — tests unitarios de apex-connector.js
// Foco: registro correcto de última vuelta (lastLap / lapHistory)
// Ejecutar: node tests-connector.js

const { strictEqual, deepEqual, ok } = require('assert');
const fs = require('fs');

// ── Mock mínimo de DOM (apex-connector no necesita DOM real para mensajes WS) ──
global.window = {};
global.DOMParser = class {
  parseFromString() {
    return { querySelector: () => null, querySelectorAll: () => [] };
  }
};
global.window.ApexClock = { sync: () => {}, stop: () => {}, reset: () => {}, _synced: false };

eval(fs.readFileSync('src/apex-connector.js', 'utf8'));
const AC = global.window.ApexConnector;

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch(e) { console.log('  ✗', name, '→', e.message); failed++; }
}

// Helper: resetea el conector y configura colMap
function setup(colMap = {}) {
  AC._karts = {};
  AC._colMap = colMap;
  AC._colByNum = {};
  Object.entries(colMap).forEach(([dtype, col]) => { AC._colByNum[col] = dtype; });
  AC._sessionActive = true;
  AC.onData = null; // evitar callbacks
}

// Helper: obtiene el objeto kart interno
function kart(rowId = 'r1') {
  return AC._karts[rowId];
}

// ── Registro desde |*| ────────────────────────────────────────────────────────
console.log('\n|*| sin columna llp');

test('registra lastLap y lapHistory', () => {
  setup();
  AC._parse('r1|*|62000|\n');
  strictEqual(kart().lastLap, 62.0);
  deepEqual(kart().lapHistory, [62.0]);
});

test('registra bestLap si es la primera vuelta', () => {
  setup();
  AC._parse('r1|*|62000|\n');
  strictEqual(kart().bestLap, 62.0);
});

test('actualiza bestLap si la vuelta es mejor', () => {
  setup();
  AC._parse('r1|*|63000|\n');
  AC._parse('r1|*|61500|\n');
  strictEqual(kart().bestLap, 61.5);
});

test('NO actualiza bestLap si la vuelta es peor', () => {
  setup();
  AC._parse('r1|*|61500|\n');
  AC._parse('r1|*|63000|\n');
  strictEqual(kart().bestLap, 61.5);
});

test('no registra vueltas < 20s (inválidas)', () => {
  setup();
  AC._parse('r1|*|15000|\n');
  ok(!kart() || !kart().lastLap, 'no debe haber lastLap para vuelta de 15s');
});

test('no registra vueltas >= 300s (inválidas)', () => {
  setup();
  AC._parse('r1|*|300000|\n');
  ok(!kart() || !kart().lastLap, 'no debe haber lastLap para vuelta de 300s');
});

test('no registra vuelta si _lapInvalid está activo', () => {
  setup();
  AC._parse('r1|*in|0\n');   // marca vuelta inválida
  AC._parse('r1|*|62000|\n');
  ok(!kart().lastLap, 'vuelta inválida no debe registrar lastLap');
});

// ── |*| cuando SÍ hay columna llp — BUG ORIGINAL ────────────────────────────
console.log('\n|*| con columna llp (debe ser ignorado)');

test('NO registra lastLap desde |*| cuando hay columna llp', () => {
  setup({ llp: 'c9' });
  AC._parse('r1|*|62000|\n');
  ok(!kart() || !kart().lastLap, 'lastLap debe ser null — llp es la fuente de verdad');
});

test('NO añade a lapHistory desde |*| cuando hay columna llp', () => {
  setup({ llp: 'c9' });
  AC._parse('r1|*|62000|\n');
  const h = kart() ? kart().lapHistory : [];
  ok(h.length === 0, 'lapHistory debe estar vacío — |*| no debe registrar con llp presente');
});

test('sí activa el flash visual aunque no registre tiempo', () => {
  setup({ llp: 'c9' });
  AC._parse('r1|*|62000|\n');
  ok(kart()._lapFlash, 'el flash visual debe activarse siempre en |*|');
});

// ── Registro desde celda llp ──────────────────────────────────────────────────
console.log('\ncelda llp registra última vuelta');

test('registra lastLap desde celda llp (formato M:SS.mmm)', () => {
  setup({ llp: 'c9' });
  AC._parse('r1c9|sr|1:02.000|\n');
  strictEqual(kart().lastLap, 62.0);
});

test('registra lastLap desde celda llp (formato SS.mmm)', () => {
  setup({ llp: 'c9' });
  AC._parse('r1c9|sr|47.234|\n');
  strictEqual(kart().lastLap, 47.234);
});

test('registra en lapHistory al llegar llp', () => {
  setup({ llp: 'c9' });
  AC._parse('r1c9|sr|1:02.000|\n');
  deepEqual(kart().lapHistory, [62.0]);
});

test('actualiza bestLap desde llp', () => {
  setup({ llp: 'c9' });
  AC._parse('r1c9|sr|1:02.000|\n');
  strictEqual(kart().bestLap, 62.0);
});

test('ignora llp con valor < 20s', () => {
  setup({ llp: 'c9' });
  AC._parse('r1c9|sr|15.000|\n');
  ok(!kart() || !kart().lastLap);
});

// ── Anti-duplicado llp / |*| ──────────────────────────────────────────────────
// Circuito SIN llp: |*| registra, luego llp llega con valor similar → refinar
console.log('\nanti-duplicado |*| + llp');

test('llp refina vuelta previa de |*| si diferencia <= 0.05s', () => {
  setup(); // sin colMap.llp → |*| registra
  AC._parse('r1|*|62000|\n');  // registra 62.000, _lapFromFlash=62.000
  // Ahora mapeamos llp y llega celda con 62.020 (diff 0.02s ≤ 0.05)
  AC._colMap.llp = 'c9';
  AC._colByNum['c9'] = 'llp';
  AC._parse('r1c9|sr|1:02.020|\n');
  strictEqual(kart().lastLap, 62.02, 'debe refinar a 62.020');
  strictEqual(kart().lapHistory.length, 1, 'no debe duplicar en lapHistory');
});

test('llp añade entrada nueva si diferencia > 0.05s', () => {
  setup();
  AC._parse('r1|*|62000|\n');  // 62.000
  AC._colMap.llp = 'c9';
  AC._colByNum['c9'] = 'llp';
  AC._parse('r1c9|sr|1:02.200|\n'); // 62.200 → diff 0.2 > 0.05
  strictEqual(kart().lapHistory.length, 2, 'diferencia grande → entrada nueva');
});

// ── Múltiples vueltas ─────────────────────────────────────────────────────────
console.log('\nmúltiples vueltas');

test('acumula varias vueltas en lapHistory', () => {
  setup();
  AC._parse('r1|*|62000|\n');
  AC._parse('r1|*|63000|\n');
  AC._parse('r1|*|61500|\n');
  deepEqual(kart().lapHistory, [62.0, 63.0, 61.5]);
});

test('lastLap es siempre la más reciente', () => {
  setup();
  AC._parse('r1|*|62000|\n');
  AC._parse('r1|*|65000|\n');
  strictEqual(kart().lastLap, 65.0);
});

test('_lapInvalid se limpia tras el pase por meta válido', () => {
  setup();
  AC._parse('r1|*in|0\n');     // marca inválida
  AC._parse('r1|*|62000|\n');  // esta es inválida
  ok(!kart().lastLap, 'vuelta inválida');
  AC._parse('r1|*|63000|\n');  // la SIGUIENTE ya es válida
  strictEqual(kart().lastLap, 63.0, 'siguiente vuelta válida debe registrar');
});

// ── Pit IN / OUT ──────────────────────────────────────────────────────────────
console.log('\npit in / out');

test('pit IN activa k.pit y pitState=in', () => {
  setup({ grp: 'c1' });
  AC._parse('r1c1|si||\n');
  ok(kart().pit === true);
  strictEqual(kart().pitState, 'in');
});

test('pit OUT activa pitState=out', () => {
  setup({ grp: 'c1' });
  AC._parse('r1c1|so||\n');
  strictEqual(kart().pitState, 'out');
});

// ── Resultado ─────────────────────────────────────────────────────────────────
console.log(`\n${passed} pasados, ${failed} fallados`);
if (failed) process.exit(1);
