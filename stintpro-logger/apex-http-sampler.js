// ── apex-http-sampler.js — muestreo del canal HTTP request.php de Apex Timing ──
// Investigación: acumular ejemplos reales de .P (pits: driver_id, relay_laps_number,
// pit_time...) antes de decidir si merece la pena construir una feature real encima.
// No toca la BD ni el esquema — solo escribe un JSONL aparte, filtrando fuera las
// respuestas sin datos de pit para no llenar el disco de ruido.
// Apagado por defecto — activar con STINTPRO_APEX_HTTP_SAMPLE=true o cfg.apexHttpSample.
//
// El logger es Node puro (sin navegador) → sin restricción CORS, llama directo a
// Apex, a diferencia de la app (que necesita el proxy de Vercel).

const fs   = require('fs');
const path = require('path');

const SAMPLE_DIR = path.join(__dirname, 'apex_http_samples');
const REQUEST_URL = 'https://live-data.apex-timing.com/live-timing/commonv2/functions/request.php';

async function fetchWithTimeout(url, options, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchConfigPort(slug) {
  try {
    const res  = await fetchWithTimeout(`https://live.apex-timing.com/${slug}/javascript/config.js`, {}, 5000);
    const text = await res.text();
    const m    = text.match(/var configPort\s*=\s*(\d+)/);
    return m ? parseInt(m[1]) : null;
  } catch(e) { return null; }
}

async function fetchKartHistory(port, id) {
  const request = `D%23-100%23D${id}.L%23-999%23D${id}.P%232%23D${id}.B%231%23D${id}.INF`;
  try {
    const res = await fetchWithTimeout(REQUEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
      body: `port=${port}&request=${request}`,
    }, 8000);
    return (await res.text()).trim();
  } catch(e) { return null; }
}

function appendSample(slug, entry) {
  try {
    if (!fs.existsSync(SAMPLE_DIR)) fs.mkdirSync(SAMPLE_DIR, { recursive: true });
    const file = path.join(SAMPLE_DIR, `${slug}.ndjson`);
    fs.appendFileSync(file, JSON.stringify(entry) + '\n');
  } catch(e) {}
}

// Muestrea los karts activos de un circuito; solo guarda cuando la respuesta trae
// al menos una línea .P con datos (si no hay pits, el servidor omite la línea
// entera en vez de devolverla vacía — confirmado empíricamente).
async function sampleCircuit(slug, port, kartIds) {
  await Promise.allSettled(kartIds.slice(0, 30).map(async ({ rowId, dorsal }) => {
    const id   = rowId.replace('r', '');
    const text = await fetchKartHistory(port, id);
    if (!text || text === 'error') return;
    const hasPit = text.split('\n').some(l => l.includes(`D${id}.P#`));
    if (!hasPit) return;
    appendSample(slug, { t: Date.now(), rowId, dorsal, raw: text });
  }));
}

module.exports = { fetchConfigPort, sampleCircuit };
