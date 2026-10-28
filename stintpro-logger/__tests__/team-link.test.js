'use strict';

// team-link.js — reparto de mensajes del panel al piloto en pista.
const { EventEmitter } = require('events');
const { createTeamLink, validateRoster, validatePilotIndex, validateTeamMsg } = require('../team-link');

function fakeWs() {
  const ws = new EventEmitter();
  ws.readyState = 1;
  ws.sent = [];
  ws.send = (s) => ws.sent.push(JSON.parse(s));
  ws.last = (type) => [...ws.sent].reverse().find(m => m.type === type);
  ws.pings = 0;
  ws.ping = () => { ws.pings++; };
  ws.terminated = false;
  ws.terminate = () => { ws.terminated = true; ws.readyState = 3; };
  return ws;
}

describe('validateRoster', () => {
  test('acepta una lista válida y normaliza', () => {
    expect(validateRoster({ dorsal: 17, pilotos: [' Javier ', 'Pablo'], current: 1 }))
      .toEqual({ dorsal: '17', pilotos: ['Javier', 'Pablo'], current: 1, source: 'panel' });
  });
  test('source radio se conserva; otro valor se rechaza', () => {
    expect(validateRoster({ dorsal: '7', pilotos: ['A'], source: 'radio' }).source).toBe('radio');
    expect(validateRoster({ dorsal: '7', pilotos: ['A'], source: 'x' }).error).toBe('source inválido');
  });
  test('current ausente → null', () => {
    expect(validateRoster({ dorsal: '7', pilotos: ['A'] }).current).toBeNull();
  });
  test.each([
    [{ dorsal: '', pilotos: ['A'] }],
    [{ dorsal: '1'.repeat(17), pilotos: ['A'] }],
    [{ dorsal: '7', pilotos: [] }],
    [{ dorsal: '7', pilotos: Array(11).fill('A') }],
    [{ dorsal: '7', pilotos: ['A', ''] }],
    [{ dorsal: '7', pilotos: ['X'.repeat(41)] }],
    [{ dorsal: '7', pilotos: ['A'], current: 1 }],
    [{ dorsal: '7', pilotos: ['A'], current: 0.5 }],
  ])('rechaza %j', (msg) => {
    expect(validateRoster(msg).error).toBeTruthy();
  });
});

describe('validatePilotIndex', () => {
  test('ausente o null → null', () => {
    expect(validatePilotIndex(undefined)).toEqual({ pilot: null });
    expect(validatePilotIndex(null)).toEqual({ pilot: null });
  });
  test('0..9 válido; resto error', () => {
    expect(validatePilotIndex(9)).toEqual({ pilot: 9 });
    expect(validatePilotIndex(10).error).toBeTruthy();
    expect(validatePilotIndex(-1).error).toBeTruthy();
    expect(validatePilotIndex('1').error).toBeTruthy();
  });
});

describe('validateTeamMsg', () => {
  test('sin pilot: compatibilidad (tono naranja, hasta 500)', () => {
    expect(validateTeamMsg({ dorsal: '7', text: 'X'.repeat(500) }))
      .toEqual({ dorsal: '7', text: 'X'.repeat(500), pilot: null, tone: 'orange', id: null });
  });
  test('con pilot: texto ≤40', () => {
    expect(validateTeamMsg({ dorsal: '7', text: 'X'.repeat(41), pilot: 0 }).error).toMatch(/40/);
    expect(validateTeamMsg({ dorsal: '7', text: 'BOX', pilot: 0, tone: 'red', id: 'm-1' }))
      .toEqual({ dorsal: '7', text: 'BOX', pilot: 0, tone: 'red', id: 'm-1' });
  });
  test.each([
    [{ dorsal: '7' }],
    [{ text: 'hola' }],
    [{ dorsal: '7', text: 'X'.repeat(501) }],
    [{ dorsal: '1'.repeat(17), text: 'hola' }],
    [{ dorsal: '7', text: 'hola', tone: 'green' }],
    [{ dorsal: '7', text: 'hola', pilot: 12 }],
    [{ dorsal: '7', text: 'hola', id: 'x'.repeat(65) }],
  ])('rechaza %j', (msg) => {
    expect(validateTeamMsg(msg).error).toBeTruthy();
  });
});

describe('createTeamLink', () => {
  const ROSTER = { dorsal: '7', pilotos: ['Javier', 'Pablo'], current: 0 };

  test('entrega solo al móvil del piloto en pista', () => {
    const tl = createTeamLink();
    const javier = fakeWs(), pablo = fakeWs();
    tl.registerPilot(javier, 's', '7', 0);
    tl.registerPilot(pablo, 's', '7', 1);
    const n = tl.deliver('s', { dorsal: '7', text: 'BOX', tone: 'red', pilot: 0 });
    expect(n).toBe(1);
    expect(javier.last('team_msg')).toEqual({ type: 'team_msg', text: 'BOX', tone: 'red' });
    expect(pablo.last('team_msg')).toBeUndefined();
  });

  test('sin pilot llega a todos los móviles del dorsal, y a ninguno de otro dorsal', () => {
    const tl = createTeamLink();
    const a = fakeWs(), b = fakeWs(), otro = fakeWs();
    tl.registerPilot(a, 's', '7', 0);
    tl.registerPilot(b, 's', '7', null);
    tl.registerPilot(otro, 's', '9', 0);
    expect(tl.deliver('s', { dorsal: '7', text: 'hola', tone: 'orange', pilot: null })).toBe(2);
    expect(otro.last('team_msg')).toBeUndefined();
  });

  test('0 entregados si el piloto no tiene móvil o está cerrado', () => {
    const tl = createTeamLink();
    const a = fakeWs();
    tl.registerPilot(a, 's', '7', 0);
    a.readyState = 3;
    expect(tl.deliver('s', { dorsal: '7', text: 'BOX', tone: 'red', pilot: 0 })).toBe(0);
    expect(tl.deliver('s', { dorsal: '7', text: 'BOX', tone: 'red', pilot: 1 })).toBe(0);
  });

  test('setRoster guarda, reenvía la lista a los móviles y manda presencia al panel', () => {
    const tl = createTeamLink();
    const movil = fakeWs(), panel = fakeWs();
    tl.registerPilot(movil, 's', '7', 1);
    tl.setRoster(panel, 's', ROSTER);
    expect(tl.getRoster('s', '7')).toEqual({ pilotos: ['Javier', 'Pablo'], current: 0 });
    expect(movil.last('team_roster')).toEqual({ type: 'team_roster', pilotos: ['Javier', 'Pablo'], current: 0 });
    expect(panel.last('pilot_presence')).toEqual({ type: 'pilot_presence', dorsal: '7', connected: [1] });
  });

  test('registerPilot manda la lista si existe y avisa al panel', () => {
    const tl = createTeamLink();
    const panel = fakeWs(), movil = fakeWs();
    tl.setRoster(panel, 's', ROSTER);
    tl.registerPilot(movil, 's', '7', 0);
    expect(movil.last('team_roster').pilotos).toEqual(['Javier', 'Pablo']);
    expect(panel.last('pilot_presence').connected).toEqual([0]);
  });

  test('resuscribir la misma conexión sustituye su piloto (sin duplicar)', () => {
    const tl = createTeamLink();
    const panel = fakeWs(), movil = fakeWs();
    tl.setRoster(panel, 's', ROSTER);
    tl.registerPilot(movil, 's', '7', 0);
    tl.registerPilot(movil, 's', '7', 1);
    expect(panel.last('pilot_presence').connected).toEqual([1]);
    expect(tl.deliver('s', { dorsal: '7', text: 'BOX', tone: 'red', pilot: 0 })).toBe(0);
    expect(tl.deliver('s', { dorsal: '7', text: 'BOX', tone: 'red', pilot: 1 })).toBe(1);
  });

  test('al cerrar el móvil el panel ve la presencia actualizada; al cerrar el panel deja de recibirla', () => {
    const tl = createTeamLink();
    const panel = fakeWs(), movil = fakeWs(), movil2 = fakeWs();
    tl.setRoster(panel, 's', ROSTER);
    tl.registerPilot(movil, 's', '7', 0);
    movil.emit('close');
    expect(panel.last('pilot_presence').connected).toEqual([]);
    panel.emit('close');
    const antes = panel.sent.length;
    tl.registerPilot(movil2, 's', '7', 1);
    expect(panel.sent.length).toBe(antes);
    expect(tl.getRoster('s', '7')).toEqual({ pilotos: ['Javier', 'Pablo'], current: 0 }); // la lista sobrevive
  });

  test('getRoster de un dorsal sin lista → null', () => {
    expect(createTeamLink().getRoster('s', '7')).toBeNull();
  });

  test('mover un móvil a otro dorsal actualiza la presencia del anterior y deja de recibir sus mensajes', () => {
    const tl = createTeamLink();
    const panel7 = fakeWs(), panel9 = fakeWs(), movil = fakeWs();
    tl.setRoster(panel7, 's', ROSTER);
    tl.setRoster(panel9, 's', { ...ROSTER, dorsal: '9' });
    tl.registerPilot(movil, 's', '7', 0);
    expect(panel7.last('pilot_presence').connected).toEqual([0]);
    tl.registerPilot(movil, 's', '9', 1);
    expect(panel7.last('pilot_presence').connected).toEqual([]);
    expect(panel9.last('pilot_presence').connected).toEqual([1]);
    expect(tl.deliver('s', { dorsal: '7', text: 'BOX', tone: 'red', pilot: 0 })).toBe(0);
    expect(tl.deliver('s', { dorsal: '7', text: 'hola', tone: 'orange', pilot: null })).toBe(0);
    expect(tl.deliver('s', { dorsal: '9', text: 'BOX', tone: 'red', pilot: 1 })).toBe(1);
  });
});

// Latido: «Entregado» solo cuenta móviles con conexión viva. Un socket medio
// abierto (el móvil perdió cobertura sin cerrar) se corta al no contestar pong.
describe('createTeamLink — latido de los móviles', () => {
  const ROSTER = { dorsal: '7', pilotos: ['Javier', 'Pablo'], current: 0 };
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('hace ping a los móviles en cada latido y no corta a los que contestan pong', () => {
    const tl = createTeamLink({ heartbeatMs: 10000 });
    const movil = fakeWs();
    tl.registerPilot(movil, 's', '7', 0);
    jest.advanceTimersByTime(10000);
    expect(movil.pings).toBe(1);
    movil.emit('pong');
    jest.advanceTimersByTime(10000);
    expect(movil.pings).toBe(2);
    expect(movil.terminated).toBe(false);
    tl.stop();
  });

  test('sin pong desde el ping anterior → terminate, presencia actualizada y 0 entregados', () => {
    const tl = createTeamLink({ heartbeatMs: 10000 });
    const panel = fakeWs(), movil = fakeWs();
    tl.setRoster(panel, 's', ROSTER);
    tl.registerPilot(movil, 's', '7', 0);
    jest.advanceTimersByTime(10000);          // ping
    expect(movil.terminated).toBe(false);
    jest.advanceTimersByTime(10000);          // sin pong → fuera
    expect(movil.terminated).toBe(true);
    expect(panel.last('pilot_presence').connected).toEqual([]);
    expect(tl.deliver('s', { dorsal: '7', text: 'BOX', tone: 'red', pilot: 0 })).toBe(0);
    tl.stop();
  });

  test('los paneles (solo publican la lista) no reciben ping ni se cortan', () => {
    const tl = createTeamLink({ heartbeatMs: 10000 });
    const panel = fakeWs();
    tl.setRoster(panel, 's', ROSTER);
    jest.advanceTimersByTime(30000);
    expect(panel.pings).toBe(0);
    expect(panel.terminated).toBe(false);
    tl.stop();
  });

  test('un móvil que se cerró deja de recibir pings', () => {
    const tl = createTeamLink({ heartbeatMs: 10000 });
    const movil = fakeWs();
    tl.registerPilot(movil, 's', '7', 0);
    movil.emit('close');
    jest.advanceTimersByTime(30000);
    expect(movil.pings).toBe(0);
    tl.stop();
  });

  test('stop() detiene el latido', () => {
    const tl = createTeamLink({ heartbeatMs: 10000 });
    const movil = fakeWs();
    tl.registerPilot(movil, 's', '7', 0);
    tl.stop();
    jest.advanceTimersByTime(30000);
    expect(movil.pings).toBe(0);
  });
});

describe('watch (radio web)', () => {
  const R = (over = {}) => ({ dorsal: '7', pilotos: ['Ana', 'Luis'], current: 0, source: 'panel', ...over });

  test('al apuntarse recibe la lista vacía y la presencia', () => {
    const tl = createTeamLink({ heartbeatMs: 0 });
    const w = fakeWs();
    tl.watch(w, 'henakart', '7');
    expect(w.last('team_roster')).toEqual({ type: 'team_roster', pilotos: null, current: null, source: null, panel: false });
    expect(w.last('pilot_presence')).toEqual({ type: 'pilot_presence', dorsal: '7', connected: [] });
  });

  test('recibe la lista del panel con source y panel:true, y los cambios', () => {
    const tl = createTeamLink({ heartbeatMs: 0 });
    const panel = fakeWs(), w = fakeWs();
    tl.watch(w, 'henakart', '7');
    tl.setRoster(panel, 'henakart', R());
    expect(w.last('team_roster')).toEqual({ type: 'team_roster', pilotos: ['Ana', 'Luis'], current: 0, source: 'panel', panel: true });
    tl.setRoster(panel, 'henakart', R({ current: 1 }));
    expect(w.last('team_roster').current).toBe(1);
  });

  test('los móviles siguen recibiendo la forma de siempre (sin source)', () => {
    const tl = createTeamLink({ heartbeatMs: 0 });
    const panel = fakeWs(), movil = fakeWs();
    tl.registerPilot(movil, 'henakart', '7', 0);
    tl.setRoster(panel, 'henakart', R());
    expect(movil.last('team_roster')).toEqual({ type: 'team_roster', pilotos: ['Ana', 'Luis'], current: 0 });
  });

  test('recibe la presencia cuando un móvil se conecta y se va', () => {
    const tl = createTeamLink({ heartbeatMs: 0 });
    const w = fakeWs(), movil = fakeWs();
    tl.watch(w, 'henakart', '7');
    tl.registerPilot(movil, 'henakart', '7', 1);
    expect(w.last('pilot_presence').connected).toEqual([1]);
    movil.emit('close');
    expect(w.last('pilot_presence').connected).toEqual([]);
  });

  test('lista radio rechazada con panel conectado; aceptada cuando el panel se va', () => {
    const tl = createTeamLink({ heartbeatMs: 0 });
    const panel = fakeWs(), radio = fakeWs();
    tl.watch(radio, 'henakart', '7');
    tl.setRoster(panel, 'henakart', R());
    expect(tl.setRoster(radio, 'henakart', R({ pilotos: ['X'], source: 'radio' }))).toEqual({ error: 'lista del panel activa' });
    expect(tl.getRoster('henakart', '7').pilotos).toEqual(['Ana', 'Luis']);
    panel.emit('close');
    expect(radio.last('team_roster')).toMatchObject({ source: 'panel', panel: false });
    expect(tl.setRoster(radio, 'henakart', R({ pilotos: ['X'], source: 'radio' }))).toEqual({ ok: true });
    expect(radio.last('team_roster')).toEqual({ type: 'team_roster', pilotos: ['X'], current: 0, source: 'radio', panel: false });
  });

  test('un panel pisa una lista radio', () => {
    const tl = createTeamLink({ heartbeatMs: 0 });
    const panel = fakeWs(), radio = fakeWs();
    tl.setRoster(radio, 'henakart', R({ source: 'radio' }));
    expect(tl.setRoster(panel, 'henakart', R({ pilotos: ['P'] }))).toEqual({ ok: true });
    expect(tl.getRoster('henakart', '7').pilotos).toEqual(['P']);
  });

  test('un nuevo watch sustituye al anterior y el cierre lo quita', () => {
    const tl = createTeamLink({ heartbeatMs: 0 });
    const w = fakeWs(), movil = fakeWs();
    tl.watch(w, 'henakart', '7');
    tl.watch(w, 'henakart', '8');
    const n = w.sent.length;
    tl.registerPilot(movil, 'henakart', '7', 0);
    expect(w.sent.length).toBe(n);           // ya no observa el 7
    w.emit('close');
    tl.registerPilot(fakeWs(), 'henakart', '8', 0);
    expect(w.sent.length).toBe(n);           // ni el 8 tras cerrar
  });

  test('un panel que pasa del dorsal 7 al 8 deja de bloquear al 7', () => {
    const tl = createTeamLink({ heartbeatMs: 0 });
    const panel = fakeWs(), w = fakeWs(), web = fakeWs();
    tl.watch(w, 'henakart', '7');
    tl.setRoster(panel, 'henakart', R());
    tl.setRoster(panel, 'henakart', R({ dorsal: '8' }));
    // el observador del 7 se entera de que ya no hay panel
    expect(w.last('team_roster').panel).toBe(false);
    // y la web puede publicar en el 7
    expect(tl.setRoster(web, 'henakart', R({ source: 'radio' }))).toEqual({ ok: true });
  });
});
