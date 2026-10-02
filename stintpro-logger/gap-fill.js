// ── gap-fill.js — relleno de huecos con el historial de request.php de Apex ──
// Si el logger se reinicia o pierde la conexión con Apex en plena carrera, las
// vueltas y paradas de ese rato no llegan por el WebSocket. Apex las guarda
// mientras dure la sesión y las sirve por request.php:
//   D<id>.L0037#s1|s2|s3|74227   vuelta 37 (número oficial), tiempos en ms
//   D<id>.P04#4|27|in|out|dur|stint|vueltas_stint|piloto|acumulado
//                                parada 4 en la vuelta 27, tiempos relativos
//                                al inicio de la sesión
// Lógica pura (sin red ni BD) para poder testearla: circuit-monitor.js pide los
// datos, consulta la BD e inserta lo que planifica este módulo.

const MIN_LAP_MS = 20000;   // mismo filtro de vuelta válida que el parser
const MAX_LAP_MS = 300000;
const LAP_TOL_MS = 3000;    // margen al cuadrar la suma de vueltas con nuestros timestamps
const PIT_DUP_MS = 30000;   // una parada ya grabada a menos de esto no se duplica
const OFFSET_TOL_MS = 3000; // coincidencias del inicio de sesión estimado

const num = (s) => {
  const d = String(s ?? '').replace(/[^0-9]/g, '');
  return d ? parseInt(d, 10) : null;
};

// Vueltas de un kart: Map número → { ms }. La vuelta 1 llega vacía y las marcas
// de mejor tiempo ('g', 'p'…) van pegadas al número.
function parseLaps(text, id) {
  const out = new Map();
  const re = new RegExp(`^D${id}\\.L(\\d+)#([^\\n]*)$`, 'gm');
  for (const m of String(text || '').matchAll(re)) {
    const ms = num(m[2].split('|')[3]);
    if (ms) out.set(parseInt(m[1], 10), { ms });
  }
  return out;
}

// Paradas de un kart, ordenadas por número.
function parsePits(text, id) {
  const out = [];
  const re = new RegExp(`^D${id}\\.P\\d+#([^\\n]*)$`, 'gm');
  for (const m of String(text || '').matchAll(re)) {
    const f = m[1].split('|');
    const n = num(f[0]), inMs = num(f[2]);
    if (n == null || inMs == null) continue;
    out.push({ n, lap: num(f[1]), inMs, outMs: num(f[3]), durMs: num(f[4]),
      stintMs: num(f[5]), stintLaps: num(f[6]), driverId: num(f[7]), accMs: num(f[8]) });
  }
  return out.sort((a, b) => a.n - b.n);
}

// Asigna a cada vuelta grabada su número oficial de Apex, casando por el tiempo
// exacto en ms y de atrás hacia delante (los números solo pueden decrecer).
function assignNumbers(apexLaps, dbLaps) {
  const nums = [...apexLaps.keys()].sort((a, b) => b - a);
  const out = [];
  let i = 0;
  for (let j = dbLaps.length - 1; j >= 0 && i < nums.length; j--) {
    const k = nums.slice(i).findIndex(n => apexLaps.get(n).ms === dbLaps[j].lap_time_ms);
    if (k < 0) continue;
    out.unshift({ n: nums[i + k], ts: dbLaps[j].timestamp });
    i += k + 1;
  }
  return out;
}

// Vueltas que faltan dentro de la ventana del corte, con su paso por meta.
// Entre dos vueltas grabadas, solo si la suma de los tiempos de Apex cuadra con
// nuestros timestamps; tras la última grabada (el kart aún no ha cruzado desde
// la reconexión), solo las anteriores al final de la ventana.
function planLaps({ apexLaps, apexPits = [], dbLaps, window }) {
  const sorted = [...(dbLaps || [])].sort((a, b) => a.timestamp - b.timestamp);
  const anchors = assignNumbers(apexLaps, sorted);
  if (!anchors.length) return [];
  const pitLaps = new Set(apexPits.map(p => p.lap).filter(l => l != null));
  const maxN = Math.max(...apexLaps.keys());
  const inWin = ts => ts > window.from && ts < window.to + LAP_TOL_MS;
  const plan = [];

  const fill = (from, to, startTs) => {
    const out = [];
    let ts = startTs;
    for (let n = from; n <= to; n++) {
      const lap = apexLaps.get(n);
      if (!lap) return null;              // falta una vuelta en Apex: no se puede situar
      ts += lap.ms;
      if (lap.ms >= MIN_LAP_MS && lap.ms < MAX_LAP_MS)
        out.push({ lapNumber: n, ms: lap.ms, timestamp: ts, isPitLap: pitLaps.has(n - 1) });
    }
    return { laps: out, endTs: ts };
  };

  for (let a = 0; a < anchors.length; a++) {
    const cur = anchors[a], next = anchors[a + 1];
    if (next) {
      if (next.n - cur.n < 2) continue;
      const r = fill(cur.n + 1, next.n, cur.ts);
      if (!r || Math.abs(r.endTs - next.ts) > LAP_TOL_MS) continue;
      plan.push(...r.laps.filter(l => l.lapNumber < next.n && inWin(l.timestamp)));
    } else if (cur.n < maxN) {
      const r = fill(cur.n + 1, maxN, cur.ts);
      if (r) plan.push(...r.laps.filter(l => inWin(l.timestamp) && l.timestamp <= window.to));
    }
  }
  return plan;
}

// Instante absoluto del inicio de la sesión (los tiempos de .P son relativos a
// él), deducido de paradas ya grabadas. Exige al menos 2 paradas distintas que
// coincidan; si no, null y las paradas del hueco no se rellenan.
function sessionOffset(apexPitsByDorsal, dbPits) {
  const cand = [];
  for (const e of dbPits || []) {
    if (e.event_type !== 'in') continue;
    for (const p of apexPitsByDorsal[String(e.dorsal)] || []) cand.push({ c: e.timestamp - p.inMs, ev: e });
  }
  let best = null;
  for (const { c } of cand) {
    const near = cand.filter(x => Math.abs(x.c - c) <= OFFSET_TOL_MS);
    const support = new Set(near.map(x => x.ev)).size;
    if (!best || support > best.support) best = { support, near };
  }
  if (!best || best.support < 2) return null;
  const vals = best.near.map(x => x.c).sort((a, b) => a - b);
  return vals[Math.floor(vals.length / 2)];
}

// Eventos de parada (entrada/salida) de un kart dentro de la ventana que no
// estén ya grabados.
function planPits({ apexPits, dbPits, offset, window }) {
  if (offset == null) return [];
  const have = (type, ts) => (dbPits || []).some(e => e.event_type === type && Math.abs(e.timestamp - ts) <= PIT_DUP_MS);
  const inWin = ts => ts >= window.from && ts <= window.to;
  const plan = [];
  for (const p of apexPits) {
    const tin = offset + p.inMs;
    // Misma convención que las paradas grabadas en vivo: la entrada lleva el
    // contador de antes de la parada (n − 1) y la salida el de después (n).
    if (inWin(tin) && !have('in', tin)) plan.push({ eventType: 'in', standsCount: p.n - 1, timestamp: tin, durationMs: null });
    if (p.outMs != null) {
      const tout = offset + p.outMs;
      if (inWin(tout) && !have('out', tout)) plan.push({ eventType: 'out', standsCount: p.n, timestamp: tout, durationMs: p.durMs ?? null });
    }
  }
  return plan.sort((a, b) => a.timestamp - b.timestamp);
}

// Petición encadenada (url-encoded) con vueltas y paradas de varios karts. Una
// sola "D" inicial y luego pares (cantidad, elemento): repetir la "D" por kart
// hace que Apex responda vacío (verificado en Campillos, 2026-10-02).
function historyRequest(ids) {
  return 'D%23' + ids.map(id => `-999%23D${id}.L%23-999%23D${id}.P`).join('%23');
}

module.exports = { parseLaps, parsePits, planLaps, sessionOffset, planPits, historyRequest };
