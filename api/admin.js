// Vercel Serverless Function — gestión de usuarios con Firebase Authentication.
// Variable de entorno en Vercel: FIREBASE_SERVICE_ACCOUNT (ver api/_firebase.js).
// Claims: toda cuenta creada aquí lleva { member: true } (sin ella el logger, la
// IA y la app la rechazan); un admin lleva { admin: true, member: true }.
// Nombre = displayName.

const { requireAdmin, auth } = require('./_firebase');

// Errores de Firebase Admin → mensaje en español (nunca el mensaje interno).
const MESSAGES = {
  'auth/email-already-exists': 'Ya existe una cuenta con ese email',
  'auth/invalid-email':        'El email no es válido',
  'auth/invalid-password':     'La contraseña debe tener al menos 6 caracteres',
  'auth/user-not-found':       'Ese usuario no existe',
};
const messageOf = (e) => (e && MESSAGES[e.code]) || 'No se ha podido completar la operación';
const nameOr = (name, email) => (name && String(name).trim()) || String(email).split('@')[0];
const ROLES = ['admin', 'user'];
const validRole = (role) => ROLES.includes(role);
const claimsFor = (role) => (role === 'admin' ? { admin: true, member: true } : { member: true });

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const me = await requireAdmin(req, res);
  if (!me) return;

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); }
  catch (e) { return res.status(400).json({ error: 'JSON inválido' }); }

  const fa = auth();
  const { action } = body;
  try {
    if (action === 'list-users') {
      const { users } = await fa.listUsers(1000);
      return res.json({ users: users.map(u => ({
        id:         u.uid,
        email:      u.email || '',
        name:       u.displayName || '',
        role:       u.customClaims && u.customClaims.admin === true ? 'admin' : 'user',
        created_at: (u.metadata && u.metadata.creationTime) || null,
      })) });
    }

    if (action === 'create-user') {
      const { email, password, name, role = 'user' } = body;
      if (!validRole(role)) return res.status(400).json({ error: 'Rol no válido' });
      if (!email || !password) return res.status(400).json({ error: 'Email y contraseña son obligatorios' });
      const u = await fa.createUser({ email, password, displayName: nameOr(name, email) });
      await fa.setCustomUserClaims(u.uid, claimsFor(role));
      return res.json({ ok: true, userId: u.uid });
    }

    // Cuenta sin contraseña: el navegador del admin pide después a Firebase el
    // correo de "restablecer contraseña" (SPAuth.sendReset), que es la invitación.
    if (action === 'invite-user') {
      const { email, name } = body;
      if (!email) return res.status(400).json({ error: 'email requerido' });
      const u = await fa.createUser({ email, displayName: nameOr(name, email) });
      await fa.setCustomUserClaims(u.uid, claimsFor('user'));
      return res.json({ ok: true, userId: u.uid });
    }

    if (action === 'set-role') {
      const { userId, role } = body;
      if (!validRole(role)) return res.status(400).json({ error: 'Rol no válido' });
      if (!userId) return res.status(400).json({ error: 'userId requerido' });
      if (userId === me.uid && role !== 'admin') return res.status(400).json({ error: 'No puedes quitarte el rol admin a ti mismo' });
      await fa.setCustomUserClaims(userId, claimsFor(role));
      if (role !== 'admin') {
        // Cierra la sesión vigente: el ID token ya emitido no puede seguir siendo admin.
        await fa.revokeRefreshTokens(userId);
      }
      return res.json({ ok: true });
    }

    if (action === 'delete-user') {
      const { userId } = body;
      if (!userId) return res.status(400).json({ error: 'userId requerido' });
      if (userId === me.uid) return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
      await fa.deleteUser(userId);
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'Acción desconocida: ' + action });
  } catch (e) {
    return res.status(400).json({ error: messageOf(e) });
  }
};
