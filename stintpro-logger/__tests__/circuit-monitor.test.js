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
    ping()      { this.pings = (this.pings || 0) + 1; }
    // Fiel al `ws` real (medido contra un endpoint no enrutable): terminate()
    // sobre un socket en CONNECTING emite SIEMPRE 'error' + 'close' de forma
    // síncrona. Si el mock no lo replica, el test no ve que un 'error' sin
    // listener tumba el proceso — que es justo el fallo que se coló aquí.
    terminate() {
      const wasConnecting = this.readyState === FakeWebSocket.CONNECTING;
      this.readyState = FakeWebSocket.CLOSED;
      if (wasConnecting) {
        this.emit('error', new Error('WebSocket was closed before the connection was established'));
      }
      this.emit('close');
    }
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

  // Regresión: el 2026-07-20, tras reiniciar el VPS, campillos abrió el socket y
  // se quedó en CONNECTING sin emitir 'open', 'error' ni 'close'. Como la
  // reconexión solo colgaba de 'close', el monitor quedó muerto en silencio
  // hasta reiniciar el servicio entero.
  describe('handshake colgado (sin open/error/close)', () => {
    test('un socket que nunca abre se cierra por timeout y reconecta', () => {
      jest.useFakeTimers();
      try {
        const m = createMonitor();
        m.start();
        const ws = WebSocket.instances[0];

        // A los 19s aún no ha pasado nada: sigue esperando el handshake.
        jest.advanceTimersByTime(19000);
        expect(WebSocket.instances).toHaveLength(1);
        expect(ws.readyState).not.toBe(WebSocket.CLOSED);

        // A los 20s salta el timeout: mata el socket y programa reconexión.
        jest.advanceTimersByTime(1000);
        expect(ws.readyState).toBe(WebSocket.CLOSED);
        expect(m.connected).toBe(false);
        expect(WebSocket.instances).toHaveLength(1); // aún no ha reintentado

        jest.advanceTimersByTime(5000);
        expect(WebSocket.instances).toHaveLength(2); // reconectó con el backoff de 5s
      } finally {
        jest.useRealTimers();
      }
    });

    test('un "close" tardío tras el timeout no duplica la reconexión', () => {
      jest.useFakeTimers();
      try {
        const m = createMonitor();
        m.start();
        const ws = WebSocket.instances[0];

        jest.advanceTimersByTime(20000);  // timeout → socket abandonado
        ws.emit('close');                 // el socket muerto avisa tarde
        ws.emit('error', new Error('ECONNRESET'));

        jest.advanceTimersByTime(5000);
        expect(WebSocket.instances).toHaveLength(2); // un solo socket nuevo, no dos
      } finally {
        jest.useRealTimers();
      }
    });

    test('tras un "open" correcto el timeout ya no mata el socket', () => {
      jest.useFakeTimers();
      try {
        const m = createMonitor();
        m.start();
        const ws = WebSocket.instances[0];
        ws.readyState = WebSocket.OPEN;
        ws.emit('open');

        // 25s: pasado el timeout de handshake (20s) y antes del ciclo ping/pong.
        jest.advanceTimersByTime(25000);
        expect(m.connected).toBe(true);
        expect(ws.readyState).toBe(WebSocket.OPEN);
        expect(WebSocket.instances).toHaveLength(1); // no reconectó
      } finally {
        jest.useRealTimers();
      }
    });

    test('stop() cancela el timeout de handshake pendiente', () => {
      jest.useFakeTimers();
      try {
        const m = createMonitor();
        m.start();
        m.stop();

        jest.advanceTimersByTime(60000);
        expect(WebSocket.instances).toHaveLength(1);
      } finally {
        jest.useRealTimers();
      }
    });
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

  test('persiste en BD la duración oficial (segundos → ms) del evento out', () => {
    const m = createMonitor();
    m._onLap('7', 'JAVIER', null, 64000, 1, Date.now());
    m._onPit('7', 'out', 1, Date.now(), 92.5); // crono otr en segundos

    const pit = db.getPitEventsBySession(m.sessionId).find(p => p.event_type === 'out');
    expect(pit.duration_ms).toBe(92500);
  });

  test('duration_ms null cuando el out no trae crono (circuito sin otr)', () => {
    const m = createMonitor();
    m._onLap('7', 'JAVIER', null, 64000, 1, Date.now());
    m._onPit('7', 'out', 1, Date.now()); // sin 5º argumento

    const pit = db.getPitEventsBySession(m.sessionId).find(p => p.event_type === 'out');
    expect(pit.duration_ms).toBeNull();
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

// ── _onMessage (canal msg| de dirección de carrera) ──────────────────────────

describe('_onMessage', () => {
  test('difunde la sanción ya clasificada a los subscriptores', () => {
    const m  = createMonitor();
    const ws = fakeClientWs();
    m.subscribe(ws);
    ws.send.mockClear(); // descarta el snapshot histórico del subscribe

    m._onMessage({
      kind: 'penalty', dorsal: '14', team: 'KARTMANS II',
      reason: 'Passage au stand en 01:58 (Tour 82)', penalty: '1 Tour',
      text: 'N°14 KARTMANS II : Pénalité - Passage au stand en 01:58 (Tour 82) - 1 Tour',
    });

    expect(ws.send).toHaveBeenCalledTimes(1);
    const msg = JSON.parse(ws.send.mock.calls[0][0]);
    expect(msg).toMatchObject({ type: 'message', kind: 'penalty', dorsal: '14', penalty: '1 Tour' });
    expect(typeof msg.ts).toBe('number');
  });

  test('las mejores vueltas del evento NO se difunden (ruido: 684 de 887 mensajes)', () => {
    const m  = createMonitor();
    const ws = fakeClientWs();
    m.subscribe(ws);
    ws.send.mockClear();

    m._onMessage({ kind: 'best', dorsal: null, team: null,
                   reason: 'Meilleur Tour : KJC RACING - 1:00.095', penalty: null,
                   text: 'Meilleur Tour : KJC RACING - 1:00.095' });

    expect(ws.send).not.toHaveBeenCalled();
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

  // El parser borra sus karts ANTES de disparar onNewSession, así que un
  // _saveSnapshot() que lea getState() en ese momento persiste una parrilla
  // vacía encima de la sesión que acaba de terminar — y el informe de carrera
  // pierde la clasificación oficial de Apex.
  test('al detectar sesión nueva, el snapshot conserva la clasificación de la que termina', () => {
    const m = createMonitor();
    m.start();
    const ws = WebSocket.instances[0];
    ws.emit('open');

    ws.emit('message', Buffer.from(buildGrid(kartRow('r1', '7', 'JAVIER') + kartRow('r2', '9', 'ANA'))));
    ws.emit('message', Buffer.from('r1c3|llp|1:05.234'));
    ws.emit('message', Buffer.from('r2c3|llp|1:06.100'));
    const sesionA = m.sessionId;
    expect(sesionA).not.toBeNull();

    // Bandera a cuadros y, acto seguido, la parrilla de la sesión siguiente.
    ws.emit('message', Buffer.from('light|lf'));
    ws.emit('message', Buffer.from(buildGrid(kartRow('r1', '21', 'LUIS') + kartRow('r2', '22', 'MARIA'))));

    expect(m.sessionId).not.toBe(sesionA); // se cerró la anterior

    const snap = db.getSnapshot(sesionA);
    expect(snap).toBeTruthy();
    const dorsales = (snap.equipos || []).filter(Boolean).map(k => k.dorsal).sort();
    expect(dorsales).toEqual(['7', '9']);
  });
});

// ── Raw log de sesión: grid de apertura ───────────────────────────────────────
//
// ── Reanudar la sesión tras un reinicio del logger ────────────────────────────
// `sessionId` vive en memoria: un reinicio a mitad de carrera creaba una sesión
// NUEVA y partía la carrera en dos. Ahora se intenta reanudar la que quedó activa,
// pero solo con evidencia fuerte. El criterio es asimétrico a propósito: partir una
// carrera es recuperable (ingest-raw-log), fusionar dos NO lo es → ante la duda,
// partir. El discriminador es `tours`, el contador oficial de Apex, que no se
// reinicia con nuestro proceso: si ha retrocedido es otra tanda, no la misma carrera.

describe('canResumeSession', () => {
  const AHORA = 1700000000000;
  const snap = (pares, ts = AHORA - 60000) =>
    ({ timestamp: ts, equipos: pares.map(([dorsal, tours]) => ({ dorsal, tours })) });
  const vivo = pares => ({ equipos: pares.map(([dorsal, tours]) => ({ dorsal, tours })) });
  const puede = (sn, lv, now = AHORA) => CircuitMonitor.canResumeSession(sn, lv, now);

  test('reanuda: misma parrilla y las vueltas siguen avanzando', () => {
    expect(puede(
      snap([['6', 40], ['14', 39], ['23', 40]]),
      vivo([['6', 41], ['14', 40], ['23', 41]]),
    )).toBe(true);
  });

  test('reanuda aunque algún kart se haya retirado (solape suficiente)', () => {
    expect(puede(
      snap([['6', 40], ['14', 39], ['23', 40], ['9', 38]]),
      vivo([['6', 41], ['14', 40], ['23', 41]]),
    )).toBe(true);
  });

  test('NO reanuda si las vueltas han retrocedido: es una tanda nueva', () => {
    // El caso real de Cabanillas: dos tandas seguidas, mismos karts, mismo título.
    expect(puede(
      snap([['6', 40], ['14', 39], ['23', 40]]),
      vivo([['6', 2], ['14', 1], ['23', 2]]),
    )).toBe(false);
  });

  test('NO reanuda si el grid aún no ha llegado (contadores a cero)', () => {
    expect(puede(
      snap([['6', 40], ['14', 39], ['23', 40]]),
      vivo([['6', 0], ['14', 0], ['23', 0]]),
    )).toBe(false);
  });

  test('NO reanuda si el snapshot es viejo', () => {
    expect(puede(
      snap([['6', 40], ['14', 39], ['23', 40]], AHORA - 45 * 60000),
      vivo([['6', 41], ['14', 40], ['23', 41]]),
    )).toBe(false);
  });

  test('NO reanuda si la parrilla apenas coincide', () => {
    expect(puede(
      snap([['6', 40], ['14', 39], ['23', 40], ['9', 40], ['5', 40]]),
      vivo([['6', 41], ['77', 12], ['88', 12], ['99', 12]]),
    )).toBe(false);
  });

  test('NO reanuda si la sesión anterior apenas había arrancado', () => {
    // Partirla no cuesta casi nada y evita fusionar por error.
    expect(puede(
      snap([['6', 1], ['14', 1], ['23', 1]]),
      vivo([['6', 2], ['14', 2], ['23', 2]]),
    )).toBe(false);
  });

  test('NO reanuda sin snapshot o sin parrilla', () => {
    expect(puede(null, vivo([['6', 41]]))).toBe(false);
    expect(puede(snap([['6', 40], ['14', 40], ['23', 40]]), { equipos: [] })).toBe(false);
    expect(puede({ timestamp: AHORA, equipos: [] }, vivo([['6', 41]]))).toBe(false);
  });
});

describe('_onLap tras un reinicio', () => {
  // La parrilla estándar de estos tests no trae columna de vueltas, y `tours` —el
  // contador oficial de Apex— es justo el discriminador. Aquí se usa una con `lc`.
  const COLS_LC = STANDARD_COLS + '<td data-id="c4" data-type="lc"></td>';
  const gridLc = rows => 'grid|<table><tbody>' + `<tr data-id="r0">${COLS_LC}</tr>` + rows + '</tbody></table>';
  const filaLc = (rowId, dorsal, name, vueltas) =>
    `<tr data-id="${rowId}">` +
    `<td data-id="${rowId}c1"><div>${dorsal}</div></td>` +
    `<td data-id="${rowId}c2"><div>${name}</div></td>` +
    `<td data-id="${rowId}c3"></td>` +
    `<td data-id="${rowId}c4">${vueltas}</td>` +
    '</tr>';
  const PARRILLA = v => gridLc(
    filaLc('r1', '6', 'JAVIER', v) + filaLc('r2', '14', 'ANA', v) + filaLc('r3', '23', 'LUIS', v));

  // Deja una sesión grabando y "muere" sin cerrarla, como un systemctl restart.
  function sesionEnCurso() {
    const m1 = createMonitor();
    m1.parser.parse(PARRILLA(40));
    m1._onLap('6',  'JAVIER', null, 64000, 1, Date.now());
    m1._onLap('14', 'ANA',    null, 64500, 1, Date.now());
    m1._saveSnapshot();   // el snapshot periódico es lo que deja el rastro
    return m1.sessionId;
  }

  test('reanuda la sesión que quedó abierta en vez de crear otra', () => {
    const sid = sesionEnCurso();

    const m2 = createMonitor();          // proceso nuevo: sessionId=null
    m2.parser.parse(PARRILLA(41));       // misma parrilla, contadores avanzados
    m2._onLap('6', 'JAVIER', null, 63800, 2, Date.now());

    expect(m2.sessionId).toBe(sid);
    expect(db.getLapsBySession(sid)).toHaveLength(3);   // 2 de antes + 1 de ahora
    expect(db.getAllSessions().filter(x => x.slug === SLUG)).toHaveLength(1);
  });

  test('restaura el contador de vueltas ya grabadas', () => {
    sesionEnCurso();
    const m2 = createMonitor();
    m2.parser.parse(PARRILLA(41));
    m2._onLap('6', 'JAVIER', null, 63800, 2, Date.now());
    expect(m2.getInfo().lapCount).toBe(3);
  });

  test('una tanda NUEVA crea sesión aparte y cierra la que quedó colgada', () => {
    const sid = sesionEnCurso();

    const m2 = createMonitor();
    m2.parser.parse(PARRILLA(1));        // contadores reiniciados → otra carrera
    m2._onLap('6', 'JAVIER', null, 64100, 1, Date.now());

    expect(m2.sessionId).not.toBe(sid);
    expect(db.getAllSessions().filter(x => x.slug === SLUG)).toHaveLength(2);
    // La vieja se cierra: así no se acumulan sesiones con is_active=1
    const vieja = db.getAllSessions().find(x => x.id === sid);
    expect(vieja.is_active).toBe(0);
    // ...y se sella con su última actividad real, no con la hora de ahora: hay
    // sesiones colgadas desde hace semanas y fecharlas hoy sería falsear el dato.
    expect(vieja.ended_at).toBeLessThanOrEqual(Date.now());
    expect(vieja.ended_at).toBeGreaterThan(0);
  });

  test('solo se intenta reanudar una vez por arranque', () => {
    sesionEnCurso();
    const m2 = createMonitor();
    m2.parser.parse(PARRILLA(41));
    m2._onLap('6', 'JAVIER', null, 63800, 2, Date.now());
    const sid2 = m2.sessionId;
    const spy = jest.spyOn(db, 'getResumableSession');
    m2._onLap('14', 'ANA', null, 64200, 2, Date.now());
    expect(spy).not.toHaveBeenCalled();
    expect(m2.sessionId).toBe(sid2);
    spy.mockRestore();
  });
});

// Apex solo manda `grid|` al conectar. En una sesión larga sin reconexión (un 24h)
// el grid puede quedar FUERA de la ventana de prólogo (15 min) y el .ndjson nace
// sin él → al reproducirlo no hay colMap y se pierde la mayoría de las vueltas.

describe('raw log de sesión', () => {
  const fs   = require('fs');
  const path = require('path');
  const RECORDINGS = path.join(__dirname, '..', 'recordings');

  function limpiarGrabaciones() {
    if (!fs.existsSync(RECORDINGS)) return;
    fs.readdirSync(RECORDINGS)
      .filter(f => f.startsWith(SLUG + '_'))
      .forEach(f => { try { fs.unlinkSync(path.join(RECORDINGS, f)); } catch(e) {} });
  }

  afterEach(limpiarGrabaciones);

  // Abre monitor con raw log armado, manda el grid, deja pasar `minutosDespues`
  // de reloj simulado CON TRÁFICO (como el feed real, que nunca calla: es ese
  // tráfico el que poda el búfer de prólogo) y manda una vuelta, que confirma la
  // sesión y abre el fichero. Devuelve las líneas ya volcadas a disco.
  // `filaEnVivo` permite simular una sesión cuyos rowId NO son los del grid
  // cacheado (evento distinto): Apex asigna rowId nuevos en cada evento.
  async function grabarSesion(minutosDespues, filaEnVivo = 'r1') {
    let ahora = Date.parse('2026-08-22T12:00:00Z');
    const spy = jest.spyOn(Date, 'now').mockImplementation(() => ahora);
    try {
      const m  = createMonitor({ rawLog: true, recording: false });
      m.start();
      const ws = WebSocket.instances[0];
      ws.emit('open');
      ws.emit('message', buildGrid(kartRow('r1', '7', 'JAVIER')));

      for (let min = 1; min <= minutosDespues; min++) {
        ahora += 60 * 1000;
        ws.emit('message', `${filaEnVivo}c9|in|${min}`);
      }
      ws.emit('message', `${filaEnVivo}c3|tn|1:04.893`);

      expect(m._rawLogPath).not.toBeNull();
      await new Promise(res => m._rawLog.end(res));
      const contenido = fs.readFileSync(m._rawLogPath, 'utf8');
      return contenido.trim().split('\n').map(JSON.parse);
    } finally {
      spy.mockRestore();
    }
  }

  test('el .ndjson arranca con el grid cuando la vuelta llega dentro de la ventana', async () => {
    const lineas = await grabarSesion(1);
    expect(lineas[0].raw).toContain('grid|');
  });

  test('el .ndjson arranca con el grid aunque sea más viejo que la ventana de prólogo', async () => {
    const lineas = await grabarSesion(20); // > RAW_PRELUDE_WINDOW_MS (15 min)
    expect(lineas[0].raw).toContain('grid|');
  });

  test('no duplica el grid cuando el prólogo aún lo conserva', async () => {
    const lineas = await grabarSesion(1);
    expect(lineas.filter(l => l.raw.includes('grid|'))).toHaveLength(1);
  });

  // Apex reasigna los rowId en cada evento. Anteponer el grid de un evento
  // anterior sería peor que no poner ninguno: al reproducirlo habría colMap
  // pero ningún kart casaría con su fila, y los dorsales se leerían del rowId
  // (transponders de 5 cifras — el bug de la sesión 1075).
  test('no antepone un grid cuyas filas no son las de la sesión en curso', async () => {
    const lineas = await grabarSesion(20, 'r2');
    expect(lineas.some(l => l.raw.includes('grid|'))).toBe(false);
  });
});
