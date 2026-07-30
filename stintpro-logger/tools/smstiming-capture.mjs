#!/usr/bin/env node
// SMS-Timing / BMI Leisure live-timing capturer.
// Depende del paquete `ws` (ya presente en stintpro-logger/node_modules).
//
// Reproduce la cadena de conexión del livetiming web y vuelca cada trama del
// WebSocket a un .ndjson (una línea JSON por push, con timestamp de recepción).
//
// CLAVE: el servidor solo emite el stream real de datos a clientes que negocian
// permessage-deflate (los frames de datos van COMPRIMIDOS). El WebSocket nativo
// de Node (undici) no lo soporta y recibe cadenas vacías en lugar de datos; por
// eso usamos el paquete `ws` con perMessageDeflate activado.
//
// Uso:
//   node smstiming-capture.mjs "<URL completa del livetiming>"   [salida.ndjson]
//   node smstiming-capture.mjs "<base64 key (cliente:guid)>"     [salida.ndjson]
//
// Ejemplos:
//   node smstiming-capture.mjs "https://modules.sms-timing.com/livetiming/?key=dmFuZGVs...%3d%3d"
//   node smstiming-capture.mjs "dmFuZGVsZ29rYXJ0OjM4M2ZiYzQ4L..." captura.ndjson
//
// Ctrl+C para parar (cierra el fichero limpiamente).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// El paquete `ws` es CommonJS; se carga vía require para resolverlo desde
// stintpro-logger/node_modules aunque el script viva en tools/.
const require = createRequire(import.meta.url);
const WebSocket = require('ws');

const BACKEND = 'https://backend.sms-timing.com';
const WS_ORIGIN = 'https://modules.sms-timing.com';

// Carpeta de capturas por defecto: <repo>/stintpro-logger/data/smstiming/
// (data/ está en .gitignore, así que no engorda el repositorio).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CAPTURE_DIR = path.resolve(__dirname, '..', 'data', 'smstiming');

// ---- argumentos --------------------------------------------------------------
const arg = process.argv[2];
if (!arg) {
  console.error('Falta el argumento: URL del livetiming o la key base64.');
  console.error('Uso: node smstiming-capture.mjs "<url|key>" [salida.ndjson]');
  process.exit(1);
}

// Extrae la key: si es una URL, saca el parámetro ?key= ; si no, úsala tal cual.
function extractKey(input) {
  try {
    const u = new URL(input);
    const k = u.searchParams.get('key');
    if (k) return k;               // URL.searchParams ya hace el url-decode
  } catch { /* no era URL */ }
  return decodeURIComponent(input);
}
const AUTH_B64 = extractKey(arg);          // base64 de "cliente:guid"
const clientName = (() => { try { return Buffer.from(AUTH_B64, 'base64').toString().split(':')[0]; } catch { return 'cliente'; } })();

// Si se pasa 2º argumento, se respeta tal cual; si no, se guarda en CAPTURE_DIR.
const defaultName = `smstiming_${clientName}_${new Date().toISOString().replace(/[:.]/g, '-')}.ndjson`;
const OUT = process.argv[3] || path.join(CAPTURE_DIR, defaultName);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const out = fs.createWriteStream(OUT, { flags: 'a' });

// ---- helpers de log ----------------------------------------------------------
const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const log = (...a) => console.error(`[${ts()}]`, ...a);

// ---- saltos HTTP: connectioninfo -> settings ---------------------------------
async function getConnectionInfo() {
  const r = await fetch(`${BACKEND}/api/connectioninfo?type=modules`, {
    headers: { Authorization: `Basic ${AUTH_B64}`, Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`connectioninfo HTTP ${r.status}`);
  return r.json();   // { ClientKey, ServiceAddress, AccessToken }
}

async function getSettings(ci) {
  // OJO: los 4 parámetros deben ir presentes (aunque vacíos) o el backend da 404.
  const url = `https://${ci.ServiceAddress}/api/livetiming/settings/${ci.ClientKey}` +
              `?locale=&styleId=&resourceId=&accessToken=${encodeURIComponent(ci.AccessToken)}`;
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`settings HTTP ${r.status}`);
  return r.json();   // { liveServerHost, liveServerWssPort, liveServerKey, ... }
}

// ---- estado de captura -------------------------------------------------------
let frames = 0;
let keepalives = 0;
let lastSession = null;
let stopping = false;
let ws = null;
let reconnectTimer = null;

function dump(kind, raw) {
  // Una línea por trama: { rt: epoch_ms, kind, data }
  out.write(JSON.stringify({ rt: Date.now(), kind, data: raw }) + '\n');
}

async function connectOnce() {
  const ci = await getConnectionInfo();
  const settings = await getSettings(ci);
  const host = settings.liveServerHost;
  const port = settings.liveServerWssPort;
  const key = settings.liveServerKey;
  if (!host || !port || !key) throw new Error('settings sin host/puerto/key: ' + JSON.stringify(settings));

  const wsUri = `wss://${host}:${port}/`;
  log(`Cliente="${clientName}" liveKey="${key}" -> ${wsUri}`);

  // permessage-deflate OBLIGATORIO: sin él el servidor no manda datos reales.
  ws = new WebSocket(wsUri, { perMessageDeflate: true, origin: WS_ORIGIN });

  ws.on('open', () => {
    log(`WS abierto (ext: ${ws.extensions || 'ninguna'}). Enviando START…`);
    ws.send('START ' + key);
    // Registro de metadatos de la sesión al inicio de cada conexión.
    dump('meta', JSON.stringify({ liveServerKey: key, wsUri, branding: settings.branding || null }));
  });

  ws.on('message', (data) => {
    const raw = data.toString();
    // Frames de texto vacío ("") o "{}" = LATIDO/keepalive (sin heat activo o sin
    // cambios). No son datos.
    if (raw === '' || raw === '{}' || raw.trim() === '') {
      keepalives++;
      dump('keepalive', raw === '{}' ? '{}' : '');
      if (keepalives % 500 === 0) log(`… (${keepalives} latidos; ${frames} tramas con datos)`);
      return;
    }
    frames++;
    dump('frame', raw);
    // eco ligero a stderr: sesión + nº de pilotos, sin spamear
    try {
      const p = JSON.parse(raw);
      if (p.N !== lastSession) {
        lastSession = p.N;
        log(`Sesión activa: "${p.N}"  (pilotos: ${(p.D || []).length}, estado S=${p.S})`);
      }
    } catch { /* ignore */ }
    if (frames % 50 === 0) log(`… ${frames} tramas capturadas`);
  });

  ws.on('close', () => {
    log(`WS cerrado. (tramas con datos: ${frames}, latidos: ${keepalives})`);
    scheduleReconnect();
  });
  ws.on('error', (e) => {
    log('WS error:', e?.message || e);
    try { ws.close(); } catch {}
  });
}

function scheduleReconnect() {
  if (stopping || reconnectTimer) return;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try { await connectOnce(); }
    catch (e) { log('Reintento falló:', e.message); scheduleReconnect(); }
  }, 5000);
}

// ---- arranque ----------------------------------------------------------------
log(`Volcando a: ${OUT}`);
try {
  await connectOnce();
} catch (e) {
  log('No se pudo conectar:', e.message);
  scheduleReconnect();
}

// ---- cierre limpio -----------------------------------------------------------
function shutdown() {
  if (stopping) return;
  stopping = true;
  log(`Parando. Total tramas: ${frames}. Fichero: ${OUT}`);
  try { ws && ws.close(); } catch {}
  if (reconnectTimer) clearTimeout(reconnectTimer);
  out.end(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
