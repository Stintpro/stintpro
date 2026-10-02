// Límite de peticiones en memoria por clave (IP o usuario), ventana deslizante.
// El "_" del nombre hace que Vercel no lo publique como función: solo se importa.
// Vive por instancia: se resetea en cold start y no se comparte entre instancias,
// así que frena ráfagas y bucles de abuso, no es un contador exacto global.

function makeLimiter({ windowMs, max }) {
  const hits = new Map(); // clave → [timestamps]
  return function allow(key) {
    const now = Date.now();
    const list = (hits.get(key) || []).filter(t => now - t < windowMs);
    if (list.length >= max) { hits.set(key, list); return false; }
    list.push(now);
    hits.set(key, list);
    // Poda ocasional para que el mapa no crezca sin fin con IPs de un solo uso
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] >= windowMs) hits.delete(k);
    return true;
  };
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim() || 'unknown';
}

module.exports = { makeLimiter, clientIp };
