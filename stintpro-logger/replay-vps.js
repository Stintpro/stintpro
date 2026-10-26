'use strict';
// Reproduce un .ndjson en el monitor de un circuito del servidor en vivo.
// Uso: node replay-vps.js <archivo.ndjson> <slug> [--speed N]

const fs   = require('fs');
const path = require('path');

const args   = process.argv.slice(2);
const file   = args[0];
const slug   = args[1];
const speed  = parseFloat(args[args.indexOf('--speed') + 1] || '1');

if (!file || !slug) {
  console.log('Uso: node replay-vps.js <archivo.ndjson> <slug> [--speed N]');
  process.exit(1);
}

const CircuitMonitor = require('./circuit-monitor');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const circuitCfg = config.circuits.find(c => c.slug === slug);
if (!circuitCfg) {
  console.error(`Circuito '${slug}' no encontrado en config.json`);
  process.exit(1);
}

// Crear monitor sin conectar a Apex
const mon = new CircuitMonitor(circuitCfg);
mon.recording = false; // no grabar en BD durante replay

// Leer líneas del ndjson
const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map(l => {
  try { return JSON.parse(l); } catch(e) { return null; }
}).filter(Boolean);

if (!lines.length) { console.error('Fichero vacío o inválido'); process.exit(1); }

console.log(`[Replay] ${lines.length} mensajes, circuito: ${slug}, velocidad: ${speed}x`);

// Necesitamos exponer el monitor globalmente para que server.js lo use
// Inyectamos el monitor en el servidor si está corriendo
const http = require('http');

function notifyServer(rawMsg) {
  // Enviamos el mensaje al parser del monitor via HTTP interno
  // En realidad lo más directo: parchear el parser directamente
}

let i = 0;
function next() {
  if (i >= lines.length) {
    console.log('[Replay] Completado');
    return;
  }
  const cur  = lines[i];
  const nxt  = lines[i + 1];
  const delay = nxt ? Math.max(0, (nxt.t - cur.t) / speed) : 0;

  // Inyectar en el parser del monitor
  try { mon.parser.parse(cur.raw); } catch(e) {}

  i++;
  setTimeout(next, delay);
}

// Arrancar el servidor HTTP/WS para que la app Flutter pueda conectar
const express = require('express');
const { WebSocketServer } = require('ws');
const db = require('./db');
const { createTeamLink, validateRoster, validatePilotIndex, validateTeamMsg } = require('./team-link');
const teamLink = createTeamLink();

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

const API_KEY = (process.env.STINTPRO_API_KEY || '').trim();

function checkAuth(req) {
  if (!API_KEY) return true;
  const url = new URL(req.url, 'http://localhost');
  return url.searchParams.get('apikey') === API_KEY;
}

wss.on('connection', (ws, req) => {
  if (!checkAuth(req)) { ws.close(); return; }

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      // Errores con `extra` (id del team_msg / about:'team_roster') como el servidor.
      const err = (m, extra) => ws.send(JSON.stringify({ type: 'error', msg: m, ...extra }));
      // La app manda { type:'auth', token|apikey } primero y espera auth_ok
      // para suscribirse; en el replay local no se verifica.
      if (msg.type === 'auth') {
        ws.send(JSON.stringify({ type: 'auth_ok' }));
      } else if (msg.type === 'pilot') {
        const p = validatePilotIndex(msg.pilot);
        if (p.error) return err(p.error);
        mon.subscribePilot(ws, msg.dorsal);
        teamLink.registerPilot(ws, slug, msg.dorsal, p.pilot);
      } else if (msg.type === 'subscribe') {
        mon.subscribe(ws);
      } else if (msg.type === 'team_roster') {
        const r = validateRoster(msg);
        if (r.error) return err(r.error, { about: 'team_roster' });
        teamLink.setRoster(ws, slug, r);
      } else if (msg.type === 'roster_get') {
        const r = teamLink.getRoster(slug, msg.dorsal);
        ws.send(JSON.stringify({ type: 'team_roster', pilotos: r ? r.pilotos : null, current: r ? r.current : null }));
      } else if (msg.type === 'team_msg') {
        const v = validateTeamMsg(msg);
        if (v.error) return err(v.error, typeof msg.id === 'string' ? { id: msg.id } : {});
        const delivered = teamLink.deliver(slug, v);
        ws.send(JSON.stringify({ type: 'team_msg_sent', id: v.id, dorsal: v.dorsal, pilot: v.pilot, text: v.text, delivered }));
      }
    } catch(e) {}
  });
});

const PORT = parseInt(process.env.REPLAY_PORT || '3001');
db.init().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Replay] Servidor WebSocket en :${PORT}`);
    console.log(`[Replay] Conecta la app con ws://<ip>:${PORT}?apikey=<key>`);
    console.log('[Replay] Iniciando reproducción...');
    // Pequeña pausa para que los clientes puedan conectar
    setTimeout(next, 1000);
  });
});
