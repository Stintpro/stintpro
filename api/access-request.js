const { createClient } = require('@supabase/supabase-js');

// ── Rate limiting por IP (en memoria) ────────────────────────────────────────
// Máx 3 peticiones por IP en una ventana de 1 hora.
// Se resetea en cold start, pero frena ataques de burst dentro de la misma instancia.
const _ipWindow  = 60 * 60 * 1000; // 1 hora en ms
const _ipMax     = 3;
const _ipCounts  = new Map(); // ip → [timestamp, ...]

function _checkIpLimit(ip) {
  const now  = Date.now();
  const hits = (_ipCounts.get(ip) || []).filter(t => now - t < _ipWindow);
  if (hits.length >= _ipMax) return false;
  hits.push(now);
  _ipCounts.set(ip, hits);
  return true;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  // ── Rate limit por IP ───────────────────────────────────────────────────
  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  if (!_checkIpLimit(ip)) {
    return res.status(429).json({ error: 'Demasiadas solicitudes. Inténtalo más tarde.' });
  }

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); }
  catch(e) { return res.status(400).json({ error: 'JSON inválido' }); }

  const { name, email, reason } = body;
  if (!name || !email) return res.status(400).json({ error: 'Faltan campos' });

  // Validación básica de email
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Email inválido' });
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY } = process.env;

  if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // ── Rate limit por email (24h) ────────────────────────────────────────
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recent } = await sb
      .from('access_requests')
      .select('id')
      .eq('email', email.toLowerCase())
      .gte('created_at', since)
      .limit(1);

    if (recent && recent.length > 0) {
      return res.status(429).json({ error: 'Ya existe una solicitud reciente con este email. Revisa tu bandeja en las próximas horas.' });
    }

    // ── Insertar solicitud ────────────────────────────────────────────────
    const { error } = await sb.from('access_requests').insert({
      name:   name.trim().slice(0, 100),
      email:  email.toLowerCase().trim(),
      reason: reason ? reason.trim().slice(0, 500) : null,
      status: 'pending',
    });
    if (error) {
      console.error('[access-request] Supabase insert error:', error.message);
      return res.status(500).json({ error: 'No se pudo guardar la solicitud' });
    }
  }

  // ── Notificar al admin por email ──────────────────────────────────────────
  if (RESEND_API_KEY) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'StintPro <onboarding@resend.dev>',
        to:   'coyjavier@gmail.com',
        subject: 'Nueva solicitud de acceso — ' + name,
        html: `<p><strong>Nombre:</strong> ${name}</p><p><strong>Email:</strong> ${email}</p><p><strong>Motivo:</strong> ${reason || '(no especificado)'}</p>`,
      })
    }).catch(() => {});
  }

  res.status(200).json({ ok: true });
};
