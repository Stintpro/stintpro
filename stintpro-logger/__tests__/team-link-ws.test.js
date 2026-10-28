'use strict';

// Integración: mensajes al piloto en pista a través del handler WS real.
const { WebSocket } = require('ws');
const db = require('../db');
const { createTestServer } = require('./helpers/test-server');

const KEY = 'test-key-teamlink';
let server, wsUrl;

beforeAll(async () => {
  await db.init();
  ({ server, wsUrl } = await createTestServer({ apiKey: KEY }));
});
afterAll(() => new Promise(r => server.close(r)));

// Cliente autenticado que acumula todo lo que recibe.
async function client() {
  const ws = new WebSocket(wsUrl);
  ws.inbox = [];
  ws.on('message', m => ws.inbox.push(JSON.parse(m.toString())));
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  ws.send(JSON.stringify({ type: 'auth', apikey: KEY }));
  await waitFor(ws, m => m.type === 'auth_ok');
  return ws;
}
function waitFor(ws, pred, ms = 2000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      const i = ws.inbox.findIndex(pred);
      if (i >= 0) return resolve(ws.inbox.splice(i, 1)[0]);
      if (Date.now() - t0 > ms) return reject(new Error('timeout esperando mensaje'));
      setTimeout(poll, 10);
    })();
  });
}
const send = (ws, o) => ws.send(JSON.stringify(o));
const ROSTER = { type: 'team_roster', slug: 'test-slug', dorsal: '7', pilotos: ['Javier', 'Pablo'], current: 0 };

test('BOX solo llega al móvil del piloto en pista y el panel recibe delivered=1', async () => {
  const panel = await client(), javier = await client(), pablo = await client();
  send(panel, ROSTER);
  await waitFor(panel, m => m.type === 'pilot_presence');
  send(javier, { type: 'pilot', slug: 'test-slug', dorsal: '7', pilot: 0 });
  send(pablo,  { type: 'pilot', slug: 'test-slug', dorsal: '7', pilot: 1 });
  await waitFor(panel, m => m.type === 'pilot_presence' && m.connected.length === 2);
  await waitFor(javier, m => m.type === 'team_roster');

  send(panel, { type: 'team_msg', slug: 'test-slug', dorsal: '7', text: 'BOX', tone: 'red', pilot: 0, id: 'm-1' });
  const ack = await waitFor(panel, m => m.type === 'team_msg_sent');
  expect(ack).toMatchObject({ id: 'm-1', dorsal: '7', pilot: 0, delivered: 1 });
  expect(await waitFor(javier, m => m.type === 'team_msg')).toEqual({ type: 'team_msg', text: 'BOX', tone: 'red' });
  await new Promise(r => setTimeout(r, 100));
  expect(pablo.inbox.find(m => m.type === 'team_msg')).toBeUndefined();
  [panel, javier, pablo].forEach(w => w.close());
});

test('roster_get devuelve la lista publicada, o null si no hay', async () => {
  const panel = await client(), movil = await client();
  send(movil, { type: 'roster_get', slug: 'test-slug', dorsal: '55' });
  expect(await waitFor(movil, m => m.type === 'team_roster')).toEqual({ type: 'team_roster', pilotos: null, current: null });
  send(panel, { ...ROSTER, dorsal: '55' });
  await waitFor(panel, m => m.type === 'pilot_presence');
  send(movil, { type: 'roster_get', slug: 'test-slug', dorsal: '55' });
  expect(await waitFor(movil, m => m.type === 'team_roster')).toEqual({ type: 'team_roster', pilotos: ['Javier', 'Pablo'], current: 0 });
  [panel, movil].forEach(w => w.close());
});

test('delivered=0 si el piloto en pista no tiene móvil', async () => {
  const panel = await client();
  send(panel, { ...ROSTER, dorsal: '66' });
  send(panel, { type: 'team_msg', slug: 'test-slug', dorsal: '66', text: 'BOX', tone: 'red', pilot: 1, id: 'm-2' });
  expect(await waitFor(panel, m => m.type === 'team_msg_sent')).toMatchObject({ id: 'm-2', delivered: 0 });
  panel.close();
});

test.each([
  [{ type: 'team_roster', slug: 'test-slug', dorsal: '7', pilotos: [] }],
  [{ type: 'team_roster', slug: 'circuito-fantasma', dorsal: '7', pilotos: ['A'] }],
  [{ type: 'roster_get', slug: 'circuito-fantasma', dorsal: '7' }],
  [{ type: 'pilot', slug: 'test-slug', dorsal: '7', pilot: 42 }],
  [{ type: 'team_msg', slug: 'test-slug', dorsal: '7', text: 'X'.repeat(41), pilot: 0 }],
  [{ type: 'team_msg', slug: 'test-slug', dorsal: '7', text: 'hola', tone: 'verde' }],
])('error de forma: %j', async (msg) => {
  const ws = await client();
  send(ws, msg);
  expect((await waitFor(ws, m => m.type === 'error')).type).toBe('error');
  ws.close();
});

// Los errores deben poder atribuirse: el panel rechaza el envío pendiente por
// `id` y muestra el fallo de la lista por `about`.
test.each([
  [{ type: 'team_msg', slug: 'test-slug', dorsal: '7', text: 'X'.repeat(41), pilot: 0, id: 'e-1' }],
  [{ type: 'team_msg', slug: 'test-slug', dorsal: '7', text: 'hola', tone: 'verde', id: 'e-1' }],
  [{ type: 'team_msg', slug: 'circuito-fantasma', dorsal: '7', text: 'BOX', pilot: 0, id: 'e-1' }],
])('error de team_msg lleva el id: %j', async (msg) => {
  const ws = await client();
  send(ws, msg);
  expect(await waitFor(ws, m => m.type === 'error')).toMatchObject({ id: 'e-1' });
  ws.close();
});

test('error por rate limit de team_msg lleva el id', async () => {
  const ws = await client();
  for (let i = 0; i < 11; i++) send(ws, { type: 'team_msg', slug: 'test-slug', dorsal: '77', text: 'hola', id: `r-${i}` });
  expect(await waitFor(ws, m => m.type === 'error')).toMatchObject({ id: 'r-10' });
  ws.close();
});

test.each([
  [{ type: 'team_roster', slug: 'test-slug', dorsal: '7', pilotos: [] }],
  [{ type: 'team_roster', slug: 'circuito-fantasma', dorsal: '7', pilotos: ['A'] }],
])('error de team_roster lleva about: %j', async (msg) => {
  const ws = await client();
  send(ws, msg);
  expect(await waitFor(ws, m => m.type === 'error')).toMatchObject({ about: 'team_roster' });
  ws.close();
});

test('team_watch: lista y presencia al apuntarse y lista del panel en vivo', async () => {
  const radio = await client(), panel = await client();
  send(radio, { type: 'team_watch', slug: 'test-slug', dorsal: '81' });
  expect(await waitFor(radio, m => m.type === 'team_roster'))
    .toEqual({ type: 'team_roster', pilotos: null, current: null, source: null, panel: false });
  expect(await waitFor(radio, m => m.type === 'pilot_presence')).toEqual({ type: 'pilot_presence', dorsal: '81', connected: [] });
  send(panel, { ...ROSTER, dorsal: '81' });
  expect(await waitFor(radio, m => m.type === 'team_roster'))
    .toEqual({ type: 'team_roster', pilotos: ['Javier', 'Pablo'], current: 0, source: 'panel', panel: true });
  [radio, panel].forEach(w => w.close());
});

test('lista de la radio rechazada con panel conectado y aceptada al irse', async () => {
  const radio = await client(), panel = await client();
  send(panel, { ...ROSTER, dorsal: '82' });
  await waitFor(panel, m => m.type === 'pilot_presence');
  send(radio, { type: 'team_watch', slug: 'test-slug', dorsal: '82' });
  await waitFor(radio, m => m.type === 'team_roster');
  send(radio, { type: 'team_roster', slug: 'test-slug', dorsal: '82', pilotos: ['Apex'], current: 0, source: 'radio' });
  expect(await waitFor(radio, m => m.type === 'error'))
    .toEqual({ type: 'error', msg: 'lista del panel activa', about: 'team_roster' });
  panel.close();
  await waitFor(radio, m => m.type === 'team_roster' && m.panel === false);
  send(radio, { type: 'team_roster', slug: 'test-slug', dorsal: '82', pilotos: ['Apex'], current: 0, source: 'radio' });
  expect(await waitFor(radio, m => m.type === 'team_roster' && m.source === 'radio'))
    .toMatchObject({ pilotos: ['Apex'], current: 0 });
  radio.close();
});

test.each([
  [{ type: 'team_watch', slug: 'circuito-fantasma', dorsal: '7' }, "Circuito 'circuito-fantasma' no encontrado"],
  [{ type: 'team_watch', slug: 'test-slug', dorsal: '' }, 'dorsal requerido (≤16)'],
])('team_watch inválido %j → error con about', async (msg, text) => {
  const ws = await client();
  send(ws, msg);
  expect(await waitFor(ws, m => m.type === 'error')).toEqual({ type: 'error', msg: text, about: 'team_watch' });
  ws.close();
});
