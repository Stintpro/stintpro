'use strict';

// Tests para circuit-monitor.js — conexión Apex, grabación en BD y difusión WS.
//
// Se mockea únicamente 'ws' (la conexión saliente real a Apex Timing por red).
// El parser (ApexParser/ApexProtocol) y la BD (sql.js) son los módulos reales,
// igual que en apex-parser.test.js y db.test.js — así los tests ejercitan la
// lógica de negocio real, no una reimplementación de juguete.

jest.mock('ws', () => {
  const { EventEmitter } = require('events');
  class FakeWebSocket extends EventEmitter {
    constructor(url, opts) {
      super();
      this.url        = url;
      this.opts       = opts;
      this.readyState = FakeWebSocket.CONNECTING;
      this.sent       = [];
      FakeWebSocket.instances.push(this);
    }
    send(data)  { this.sent.push(data); }
    close()     { this.readyState = FakeWebSocket.CLOSED; }
  }
  FakeWebSocket.CONNECTING = 0;
  FakeWebSocket.OPEN       = 1;
  FakeWebSocket.CLOSING    = 2;
  FakeWebSocket.CLOSED     = 3;
  FakeWebSocket.instances  = [];
  return FakeWebSocket;
});

const WebSocket      = require('ws'); // FakeWebSocket (mock de arriba)
const db             = require('../db');
const CircuitMonitor = require('../circuit-monitor');

const SLUG = 'test-monitor-circuit';

// Mismos helpers de grid que apex-parser.test.js: c1=no, c2=dr, c3=llp.
const STANDARD_COLS =
  '<td data-id="c1" data-type="no"></td>' +
  '<td data-id="c2" data-type="dr"></td>' +
  '<td data-id="c3" data-type="llp"></td>';

function buildGrid(rows) {
  return 'grid|<table><tbody>' + `<tr data-id="r0">${STANDARD_COLS}</tr>` + rows + '</tbody></table>';
}
function kartRow(rowId, dorsal, name) {
  return `<tr data-id="${rowId}">` +
    `<td data-id="${rowId}c1"><div>${dorsal}</div></td>` +
    `<td data-id="${rowId}c2"><div>${name}</div></td>` +
    `<td data-id="${rowId}c3"></td>` +
    '</tr>';
}

// ws de un cliente suscrito (dashboard o piloto) — EventEmitter real para poder
// disparar 'close'/'error' como hace circuit-monitor.subscribe().
function fakeClientWs() {
  const { EventEmitter } = require('events');
  const ws = new EventEmitter();
  ws.readyState = 1; // WebSocket.OPEN
  ws.send = jest.fn();
  return ws;
}

const monitors = [];
function createMonitor(cfg = {}, computeRatings) {
  const m = new CircuitMonitor({ slug: SLUG, port: 9999, name: 'Test Circuit', ...cfg }, computeRatings);
  monitors.push(m);
  return m;
}

beforeAll(async () => { await db.init(); });

afterEach(() => {
  monitors.forEach(m => m.stop());
  monitors.length = 0;
  WebSocket.instances.length = 0;
  db.getAllSessions().filter(s => s.slug === SLUG).forEach(s => db.deleteSession(s.id));
});

// ── getInfo ───────────────────────────────────────────────────────────────────

describe('getInfo', () => {
  test('estado inicial antes de conectar', () => {
    const m = createMonitor();
    expect(m.getInfo()).toMatchObject({
      slug: SLUG, name: 'Test Circuit', port: 9999,
      connected: false, sessionActive: false, sessionId: null,
      lapCount: 0, kartCount: 0, subscribers: 0, recording: true, rawLog: false,
    });
  });

  test('recording=false si se configura explícitamente', () => {
    const m = createMonitor({ recording: false });
    expect(m.getInfo().recording).toBe(false);
  });
});

// ── Conexión Apex ─────────────────────────────────────────────────────────────

describe('conexión a Apex', () => {
  test('start() abre WS al puerto del circuito; "open" marca connected y envía el slug', () => {
    const m = createMonitor();
    m.start();
    const ws = WebSocket.instances[0];
    expect(ws.url).toBe('wss://live-data.apex-timing.com:9999/');

    ws.emit('open');
    expect(m.connected).toBe(true);
    expect(ws.sent).toContain(SLUG);
  });

  test('"close" marca connected=false y reprograma la reconexión a los 5s', () => {
    jest.useFakeTimers();
    try {
      const m = createMonitor();
      m.start();
      WebSocket.instances[0].emit('open');
      WebSocket.instances[0].emit('close');

      expect(m.connected).toBe(false);
      expect(WebSocket.instances).toHaveLength(1);

      jest.advanceTimersByTime(5000);
      expect(WebSocket.instances).toHaveLength(2); // reconectó
    } finally {
      jest.useRealTimers();
    }
  });

  test('"error" marca connected=false sin lanzar', () => {
    const m = createMonitor();
    m.start();
    const ws = WebSocket.instances[0];
    ws.emit('open');
    expect(() => ws.emit('error', new Error('boom'))).not.toThrow();
    expect(m.connected).toBe(false);
  });

  test('un mensaje que no es protocolo válido no lanza excepción', () => {
    const m = createMonitor();
    m.start();
    const ws = WebSocket.instances[0];
    ws.emit('open');
    expect(() => ws.emit('message', Buffer.from('esto-no-es-protocolo-apex'))).not.toThrow();
  });

  test('stop() cierra el WS y cancela el timer de reconexión pendiente', () => {
    jest.useFakeTimers();
    try {
      const m = createMonitor();
      m.start();
      const ws = WebSocket.instances[0];
      ws.emit('open');
      ws.emit('close'); // programa una reconexión a los 5s
      m.stop();

      jest.advanceTimersByTime(10000);
      expect(WebSocket.instances).toHaveLength(1); // no reconectó tras stop()
    } finally {
      jest.useRealTimers();
    }
  });
});

// ── _onLap ────────────────────────────────────────────────────────────────────

describe('_onLap', () => {
  test('no crea sesión ni guarda nada si recording=false', () => {
    const m = createMonitor({ recording: false });
    m._onLap('7', 'JAVIER', null, 64893, 1, Date.now());
    expect(m.sessionId).toBeNull();
    expect(m.getInfo().lapCount).toBe(0);
  });

  test('primera vuelta real crea sesión y la guarda en BD', () => {
    const m = createMonitor();
    m._onLap('7', 'JAVIER', 'Equipo X', 64893, 1, Date.now());

    expect(m.sessionId).not.toBeNull();
    expect(m.getInfo().lapCount).toBe(1);
    const laps = db.getLapsBySession(m.sessionId);
    expect(laps).toHaveLength(1);
    expect(laps[0]).toMatchObject({ dorsal: '7', name: 'JAVIER', team_name: 'Equipo X', lap_time_ms: 64893 });
  });

  test('limpia el sufijo "[mm:ss]" del nombre antes de guardarlo', () => {
    const m = createMonitor();
    m._onLap('7', 'JAVIER [12:34]', null, 64893, 1, Date.now());
    const laps = db.getLapsBySession(m.sessionId);
    expect(laps[0].name).toBe('JAVIER');
  });

  test('vueltas sucesivas reutilizan la misma sesión e incrementan el contador', () => {
    const m = createMonitor();
    m._onLap('7', 'JAVIER', null, 64000, 1, Date.now());
    const sid = m.sessionId;
    m._onLap('7', 'JAVIER', null, 63500, 2, Date.now());

    expect(m.sessionId).toBe(sid);
    expect(m.getInfo().lapCount).toBe(2);
    expect(db.getLapsBySession(sid)).toHaveLength(2);
  });
});

// ── _onPit ────────────────────────────────────────────────────────────────────

describe('_onPit', () => {
  test('ignorado si aún no hay sesión activa', () => {
    const m = createMonitor();
    m._onPit('7', 'in', 3, Date.now());
    expect(m.pitEvents).toHaveLength(0);
  });

  test('con sesión activa: se guarda en BD y en memoria', () => {
    const m = createMonitor();
    m._onLap('7', 'JAVIER', null, 64000, 1, Date.now());
    m._onPit('7', 'in', 3, Date.now());

    expect(m.pitEvents).toHaveLength(1);
    expect(m.pitEvents[0]).toMatchObject({ dorsal: '7', event: 'in', standsCount: 3 });
    expect(db.getPitEventsBySession(m.sessionId)).toHaveLength(1);
  });

  test('ignorado si recording=false aunque haya sesión activa', () => {
    const m = createMonitor();
    m._onLap('7', 'JAVIER', null, 64000, 1, Date.now());
    m.setRecording(false);
    m._onPit('7', 'in', 3, Date.now());
    expect(m.pitEvents).toHaveLength(0);
  });
});

// ── _onState (broadcast + throttle) ──────────────────────────────────────────

describe('_onState', () => {
  function state(equipos) {
    return { equipos, leaderLap: 1, timestamp: Date.now(), sessionFinished: false };
  }

  test('difunde "live" con lapHistory recortado a las últimas 10 vueltas', () => {
    const m  = createMonitor();
    const ws = fakeClientWs();
    m.subscribe(ws);   // primer envío es 'history'
    ws.send.mockClear();

    const laps = Array.from({ length: 15 }, (_, i) => 60 + i);
    m._onState(state([{ dorsal: '7', pos: 1, lapHistory: laps }]));

    expect(ws.send).toHaveBeenCalledTimes(1);
    const msg = JSON.parse(ws.send.mock.calls[0][0]);
    expect(msg.type).toBe('live');
    expect(msg.data.equipos[0].lapHistory).toHaveLength(10);
    expect(msg.data.equipos[0].lapHistory[0]).toBe(laps[5]);
    // Contador del historial completo — el cliente fusiona por diferencia de
    // contadores (no por valor de vuelta, que descartaba tiempos repetidos)
    expect(msg.data.equipos[0].lapHistoryTotal).toBe(15);
  });

  test('el snapshot "history" incluye lapHistoryTotal del parser', () => {
    const m  = createMonitor();
    // Grid con colMap (c3=llp) + 3 vueltas reales por celda llp
    m.parser.parse(buildGrid(kartRow('r1', '7', 'JAVIER')));
    m.parser.parse('r1c3|ti|1:04.100');
    m.parser.parse('r1c3|ti|1:04.200');
    m.parser.parse('r1c3|ti|1:04.100'); // tiempo repetido — cuenta igual

    const ws = fakeClientWs();
    m.subscribe(ws); // primer envío es el snapshot 'history'
    const msg = JSON.parse(ws.send.mock.calls[0][0]);
    expect(msg.type).toBe('history');
    const kart = msg.snapshot.equipos.find(e => e.dorsal === '7');
    expect(kart.lapHistory).toHaveLength(3);
    expect(kart.lapHistoryTotal).toBe(3);
  });

  test('throttle: dos actualizaciones en menos de 200ms solo emiten un broadcast', () => {
    const m  = createMonitor();
    const ws = fakeClientWs();
    m.subscribe(ws);
    ws.send.mockClear();

    m._onState(state([{ dorsal: '7', pos: 1, lapHistory: [] }]));
    m._onState(state([{ dorsal: '7', pos: 1, lapHistory: [] }])); // demasiado pronto, se descarta

    expect(ws.send).toHaveBeenCalledTimes(1);
  });
});

describe('_broadcastPilots (vía _onState)', () => {
  test('el piloto suscrito recibe solo su dato, con gapBehind del siguiente en clasificación', () => {
    const m      = createMonitor();
    const wsPilot = fakeClientWs();
    m.subscribePilot(wsPilot, '7');
    wsPilot.send.mockClear(); // descarta el ack de suscripción

    m._onState({
      equipos: [
        { dorsal: '7', pos: 1, gap: '', interval: '', lastLap: 60.1, pit: false },
        { dorsal: '9', pos: 2, gap: '+1.200', interval: '+1.200', lastLap: 60.5, pit: false },
      ],
      leaderLap: 1, timestamp: Date.now(), sessionFinished: false,
    });

    expect(wsPilot.send).toHaveBeenCalledTimes(1);
    const msg = JSON.parse(wsPilot.send.mock.calls[0][0]);
    expect(msg).toMatchObject({ type: 'pilot', pos: 1, gapBehind: '+1.200' });
  });

  test('no envía nada si el dorsal suscrito no está en la clasificación actual', () => {
    const m      = createMonitor();
    const wsPilot = fakeClientWs();
    m.subscribePilot(wsPilot, '99');
    wsPilot.send.mockClear();

    m._onState({ equipos: [{ dorsal: '7', pos: 1 }], leaderLap: 1, timestamp: Date.now(), sessionFinished: false });
    expect(wsPilot.send).not.toHaveBeenCalled();
  });
});

// ── _onSessionEnd / _onNewSession ────────────────────────────────────────────

describe('_onSessionEnd / _onNewSession', () => {
  test('_onSessionEnd guarda snapshot y cierra la sesión en BD', () => {
    const m = createMonitor();
    m._onLap('7', 'JAVIER', null, 64000, 1, Date.now());
    const sid = m.sessionId;
    m._onSessionEnd();

    const s = db.getAllSessions().find(s => s.id === sid);
    expect(s.is_active).toBe(0);
  });

  test('_onNewSession cierra la sesión anterior y resetea el estado en memoria', () => {
    const m = createMonitor();
    m._onLap('7', 'JAVIER', null, 64000, 1, Date.now());
    m._onPit('7', 'in', 1, Date.now());
    const sid = m.sessionId;
    m._onNewSession();

    expect(m.sessionId).toBeNull();
    expect(m.pitEvents).toHaveLength(0);
    expect(m.getInfo().lapCount).toBe(0);
    expect(db.getAllSessions().find(s => s.id === sid).is_active).toBe(0);
  });

  test('_onNewSession sin sesión previa no lanza', () => {
    const m = createMonitor();
    expect(() => m._onNewSession()).not.toThrow();
  });
});

// ── _onTitle ──────────────────────────────────────────────────────────────────

describe('_onTitle', () => {
  test('ignorado si aún no hay sesión activa', () => {
    const m = createMonitor();
    expect(() => m._onTitle('CARRERA')).not.toThrow();
  });

  test('actualiza el título de la sesión activa en BD', () => {
    const m = createMonitor();
    m._onLap('7', 'JAVIER', null, 64000, 1, Date.now());
    m._onTitle('85 PRO · CARRERA');

    expect(db.getAllSessions().find(s => s.id === m.sessionId).title).toBe('85 PRO · CARRERA');
  });
});

// ── _onCountdown ──────────────────────────────────────────────────────────────

describe('_onCountdown', () => {
  test('modo countdown difunde el reloj y lo recuerda para snapshots futuros', () => {
    const m  = createMonitor();
    const ws = fakeClientWs();
    m.subscribe(ws);
    ws.send.mockClear();

    m._onCountdown(300000, 'countdown');
    const msg = JSON.parse(ws.send.mock.calls[0][0]);
    expect(msg).toMatchObject({ type: 'clock', ms: 300000, mode: 'countdown' });
  });

  test('modo stop limpia el ms', () => {
    const m  = createMonitor();
    const ws = fakeClientWs();
    m.subscribe(ws);
    ws.send.mockClear();

    m._onCountdown(null, 'stop');
    const msg = JSON.parse(ws.send.mock.calls[0][0]);
    expect(msg).toMatchObject({ type: 'clock', ms: null, mode: 'stop' });
  });
});

// ── subscribe / subscribePilot ────────────────────────────────────────────────

describe('subscribe', () => {
  test('añade el ws a la lista y envía el snapshot histórico de inmediato', () => {
    const m  = createMonitor();
    const ws = fakeClientWs();
    m.subscribe(ws);

    expect(m.subscribers.has(ws)).toBe(true);
    expect(ws.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(ws.send.mock.calls[0][0]).type).toBe('history');
  });

  test('se elimina de la lista al cerrarse la conexión', () => {
    const m  = createMonitor();
    const ws = fakeClientWs();
    m.subscribe(ws);
    ws.emit('close');
    expect(m.subscribers.has(ws)).toBe(false);
  });
});

describe('subscribePilot', () => {
  test('registra al piloto por dorsal y envía un ack', () => {
    const m  = createMonitor();
    const ws = fakeClientWs();
    m.subscribePilot(ws, 7);

    expect(m.pilotSubscribers.get('7').has(ws)).toBe(true);
    const msg = JSON.parse(ws.send.mock.calls[0][0]);
    expect(msg).toMatchObject({ type: 'pilot_ack', slug: SLUG, dorsal: '7' });
  });

  test('se elimina de su grupo al cerrarse la conexión', () => {
    const m  = createMonitor();
    const ws = fakeClientWs();
    m.subscribePilot(ws, '7');
    ws.emit('close');
    expect(m.pilotSubscribers.get('7').has(ws)).toBe(false);
  });
});

// ── _sendHistoryTo: enriquecido desde BD ─────────────────────────────────────

describe('_sendHistoryTo (enriquecido desde BD)', () => {
  test('completa lapHistory/lastLap desde BD cuando tiene más vueltas que el estado en memoria', () => {
    const m = createMonitor();
    // Construye estado real vía el parser (igual que llegaría por WS)
    m.parser.parse(buildGrid(kartRow('r1', '7', 'JAVIER')));
    m.parser.parse('r1c3|llp|1:04.000');
    m.parser.parse('r1c3|llp|1:03.500');
    expect(m.sessionId).not.toBeNull();

    // Simula una vuelta ya persistida que el parser en memoria no tiene
    // (p.ej. tras un reinicio del servidor a mitad de sesión)
    db.insertLap(m.sessionId, '7', 'JAVIER', null, 62000, 3, Date.now());

    const ws = fakeClientWs();
    m.subscribe(ws);
    const kart = JSON.parse(ws.send.mock.calls[0][0]).snapshot.equipos.find(e => e.dorsal === '7');

    expect(kart.lapHistory).toHaveLength(3);
    expect(kart.lastLap).toBeCloseTo(62, 1);
  });

  test('stintLapCount cuenta solo las vueltas posteriores al último pit out', () => {
    const m = createMonitor();
    m.parser.parse(buildGrid(kartRow('r1', '7', 'JAVIER')));
    m.parser.parse('r1c3|llp|1:04.000');

    const pitOutTime = Date.now();
    m._onPit('7', 'out', 1, pitOutTime);
    db.insertLap(m.sessionId, '7', 'JAVIER', null, 61000, 2, pitOutTime + 1000);

    const ws = fakeClientWs();
    m.subscribe(ws);
    const kart = JSON.parse(ws.send.mock.calls[0][0]).snapshot.equipos.find(e => e.dorsal === '7');

    expect(kart.stintLapCount).toBe(1);
  });

  test('incluye pilotRatings cuando se pasó computeRatings', () => {
    const ratings = [{ name: 'JAVIER', score: 90 }];
    const m = createMonitor({}, () => ratings);
    const ws = fakeClientWs();
    m.subscribe(ws);

    expect(JSON.parse(ws.send.mock.calls[0][0]).snapshot.pilotRatings).toEqual(ratings);
  });

  test('un computeRatings que lanza no rompe el envío del snapshot', () => {
    const m  = createMonitor({}, () => { throw new Error('boom'); });
    const ws = fakeClientWs();
    expect(() => m.subscribe(ws)).not.toThrow();
    expect(JSON.parse(ws.send.mock.calls[0][0]).snapshot.pilotRatings).toBeUndefined();
  });
});

// ── Integración: WS real (mockeado) → parser real → BD real ─────────────────

describe('integración de extremo a extremo', () => {
  test('start → open → grid → vuelta crea la sesión y la vuelta en BD', () => {
    const m = createMonitor();
    m.start();
    const ws = WebSocket.instances[0];
    ws.emit('open');

    ws.emit('message', Buffer.from(buildGrid(kartRow('r1', '7', 'JAVIER'))));
    ws.emit('message', Buffer.from('r1c3|llp|1:05.234'));

    expect(m.sessionId).not.toBeNull();
    const laps = db.getLapsBySession(m.sessionId);
    expect(laps).toHaveLength(1);
    expect(laps[0]).toMatchObject({ dorsal: '7', name: 'JAVIER' });
  });
});
