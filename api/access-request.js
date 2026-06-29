const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); }
  catch(e) { return res.status(400).json({ error: 'JSON inválido' }); }

  const { name, email, reason } = body;
  if (!name || !email) return res.status(400).json({ error: 'Faltan campos' });

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY } = process.env;

  // Guardar solicitud en Supabase
  if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const { error } = await sb.from('access_requests').insert({ name, email, reason: reason || null, status: 'pending' });
    if (error) {
      console.error('[access-request] Supabase insert error:', error.message);
      return res.status(500).json({ error: 'No se pudo guardar la solicitud' });
    }
  }

  // Notificar al admin por email (opcional)
  if (RESEND_API_KEY) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'StintPro <onboarding@resend.dev>',
        to: 'coyjavier@gmail.com',
        subject: 'Nueva solicitud de acceso — ' + name,
        html: `<p><strong>Nombre:</strong> ${name}</p><p><strong>Email:</strong> ${email}</p><p><strong>Motivo:</strong> ${reason || '(no especificado)'}</p>`
      })
    }).catch(() => {});
  }

  res.status(200).json({ ok: true });
};
