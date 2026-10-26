// Firebase Admin compartido por las funciones de Vercel. El "_" del nombre hace
// que Vercel no lo publique como función: solo se importa.
// Variable de entorno: FIREBASE_SERVICE_ACCOUNT = JSON completo de la cuenta de
// servicio (Firebase → Configuración → Cuentas de servicio). NUNCA en el cliente.
const admin = require('firebase-admin');

let _app = null;

function app() {
  if (_app) return _app;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  let cred;
  try { cred = JSON.parse(raw); }
  catch (e) { console.error('[firebase] FIREBASE_SERVICE_ACCOUNT no utilizable:', e.message); return null; }
  try {
    _app = (admin.apps && admin.apps.length) ? admin.app() : admin.initializeApp({ credential: admin.credential.cert(cred) });
  } catch (e) { console.error('[firebase] FIREBASE_SERVICE_ACCOUNT no utilizable:', e.message); return null; }
  return _app;
}

const configured = () => !!app();
const auth = () => { const a = app(); return a ? a.auth() : null; };

function bearer(req) {
  const h = (req.headers && req.headers.authorization) || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

// ID token de Firebase de la cabecera Authorization → token decodificado o null.
// checkRevoked = true además rechaza tokens de sesiones revocadas.
async function verifyRequest(req, checkRevoked = false) {
  const t = bearer(req), a = auth();
  if (!t || !a) return null;
  try { return await a.verifyIdToken(t, checkRevoked); } catch (e) { return null; }
}

// Miembro de StintPro = cuenta creada por un admin (claim member:true) o admin.
// Los claims solo los pone el servidor: una cuenta dada de alta por la API
// pública de Firebase (sign-up con el apiKey) no los tiene y no entra.
const isMember = (decoded) => !!decoded && (decoded.member === true || decoded.admin === true);

// Exige un admin (custom claim admin:true). Si no, responde y devuelve null.
async function requireAdmin(req, res) {
  if (!configured()) { res.status(500).json({ error: 'Servidor no configurado (FIREBASE_SERVICE_ACCOUNT)' }); return null; }
  const d = await verifyRequest(req, true);
  if (!d) { res.status(401).json({ error: 'Token inválido' }); return null; }
  if (d.admin !== true) { res.status(403).json({ error: 'Se requiere rol admin' }); return null; }
  return d;
}

module.exports = { verifyRequest, requireAdmin, isMember, auth, configured };
