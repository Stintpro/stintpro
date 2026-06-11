// Vercel Serverless Function — gestión de usuarios (requiere service role key)
// Variables de entorno necesarias en Vercel:
//   SUPABASE_URL         → igual que en supabase-config.js
//   SUPABASE_SERVICE_KEY → Settings → API → service_role (NUNCA en el cliente)

const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'No token' });

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Servidor no configurado (variables de entorno faltantes)' });
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // Verificar que el token pertenece a un usuario admin
  const { data: { user }, error: authErr } = await adminClient.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Token inválido' });

  const { data: profile } = await adminClient
    .from('profiles').select('role').eq('id', user.id).single();
  if (profile?.role !== 'admin') return res.status(403).json({ error: 'Se requiere rol admin' });

  // Parsear body
  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); }
  catch(e) { return res.status(400).json({ error: 'JSON inválido' }); }

  const { action } = body;

  // ── LIST USERS ──────────────────────────────────────────────────────────
  if (action === 'list-users') {
    const { data: { users }, error } = await adminClient.auth.admin.listUsers({ perPage: 200 });
    if (error) return res.status(500).json({ error: error.message });

    const { data: profiles } = await adminClient.from('profiles').select('*');
    const byId = Object.fromEntries((profiles || []).map(p => [p.id, p]));

    return res.json({
      users: users.map(u => ({
        id:         u.id,
        email:      u.email,
        name:       byId[u.id]?.name || '',
        role:       byId[u.id]?.role || 'user',
        created_at: u.created_at
      }))
    });
  }

  // ── CREATE USER ─────────────────────────────────────────────────────────
  if (action === 'create-user') {
    const { email, password, name, role = 'user' } = body;
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña son obligatorios' });

    const { data, error } = await adminClient.auth.admin.createUser({
      email, password, email_confirm: true
    });
    if (error) return res.status(400).json({ error: error.message });

    await adminClient.from('profiles').insert({
      id:   data.user.id,
      email,
      name: name || email.split('@')[0],
      role: ['admin', 'user'].includes(role) ? role : 'user'
    });

    return res.json({ ok: true, userId: data.user.id });
  }

  // ── DELETE USER ─────────────────────────────────────────────────────────
  if (action === 'delete-user') {
    const { userId } = body;
    if (!userId) return res.status(400).json({ error: 'userId requerido' });
    if (userId === user.id) return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });

    const { error } = await adminClient.auth.admin.deleteUser(userId);
    if (error) return res.status(400).json({ error: error.message });

    await adminClient.from('profiles').delete().eq('id', userId);
    return res.json({ ok: true });
  }

  return res.status(400).json({ error: 'Acción desconocida: ' + action });
};
