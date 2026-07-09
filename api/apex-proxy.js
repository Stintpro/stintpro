// Vercel Serverless Function — proxy CORS para Apex Timing
// El navegador no puede leer directamente config.js ni request.php de
// apex-timing.com (no manda Access-Control-Allow-Origin) — bloquea tanto
// _fetchHttpPort() como _fetchLapHistories() en apex-connector.js. Esta
// función hace el fetch servidor-a-servidor (sin restricción CORS) y
// devuelve el texto crudo tal cual, para no duplicar en el servidor la
// lógica de parseo que ya vive en el cliente.

const SLUG_RE = /^[a-z0-9-]{1,64}$/;
// Debe coincidir exactamente con el directive que genera apex-connector.js
// (mismo id de kart repetido en las 4 posiciones) — evita que este proxy se
// use como gateway genérico hacia apex-timing.com.
const REQUEST_RE = /^D%23-100%23D(\d+)\.L%23-999%23D\1\.P%232%23D\1\.B%231%23D\1\.INF$/;

async function fetchWithTimeout(url, options, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); }
  catch(e) { return res.status(400).json({ error: 'JSON inválido' }); }

  const { action } = body;

  try {
    if (action === 'config') {
      const { slug } = body;
      if (!slug || !SLUG_RE.test(slug)) return res.status(400).json({ error: 'slug inválido' });
      const r = await fetchWithTimeout(`https://live.apex-timing.com/${slug}/javascript/config.js`, {}, 5000);
      const text = await r.text();
      return res.status(200).json({ text });
    }

    if (action === 'history') {
      const { port, request } = body;
      const p = parseInt(port);
      if (isNaN(p) || p < 1 || p > 65535) return res.status(400).json({ error: 'port inválido' });
      if (!request || !REQUEST_RE.test(request)) return res.status(400).json({ error: 'request inválido' });
      const r = await fetchWithTimeout('https://live-data.apex-timing.com/live-timing/commonv2/functions/request.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
        body: `port=${p}&request=${request}`,
      }, 8000);
      const text = await r.text();
      return res.status(200).json({ text });
    }

    return res.status(400).json({ error: 'action inválido' });
  } catch(e) {
    return res.status(502).json({ error: 'Error al contactar Apex Timing' });
  }
};
