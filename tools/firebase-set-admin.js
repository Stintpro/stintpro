#!/usr/bin/env node
// tools/firebase-set-admin.js — marca una cuenta de Firebase como admin de StintPro
// (custom claims { admin: true, member: true }). Se ejecuta UNA vez, en tu Mac, con la clave de
// la cuenta de servicio (que nunca se sube al repo).
//
// Uso: node tools/firebase-set-admin.js <ruta-cuenta-servicio.json> <email>
'use strict';

const fs = require('fs');
const admin = require('firebase-admin');

async function main() {
  const [keyPath, email] = process.argv.slice(2);
  if (!keyPath || !email) {
    console.error('uso: node tools/firebase-set-admin.js <ruta-cuenta-servicio.json> <email>');
    process.exit(2);
  }
  const cred = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  admin.initializeApp({ credential: admin.credential.cert(cred) });
  const user = await admin.auth().getUserByEmail(email);
  await admin.auth().setCustomUserClaims(user.uid, Object.assign({}, user.customClaims, { admin: true, member: true }));
  console.log(`✓ ${email} (${user.uid}) es admin. Cierra sesión y vuelve a entrar para que se aplique.`);
}

main().catch((e) => { console.error('✗', e.message); process.exit(1); });
