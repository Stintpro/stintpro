# Login con Firebase Authentication (sustituye a Supabase) — diseño

Fecha: 2026-10-26 · Aprobado por el usuario en conversación el mismo día.

## Contexto

El proyecto de Supabase `nyybrybnvflwbdwdqpwa` ya no existe (su dominio da NXDOMAIN en los DNS públicos; el usuario confirma que los registros se han eliminado). Con él se han perdido las cuentas, los roles, la tabla `circuits` y el ajuste `demo_mode`. Los datos de carreras viven en el VPS y están intactos.

Hoy está roto: el login de la web, las lecturas de la web al logger (el VPS solo acepta JWT de Supabase), el ingeniero de IA y el admin.

## Decisiones tomadas

- **Firebase Authentication solo para cuentas** (email + contraseña). Sin Firestore ni ninguna otra base de datos de Firebase.
- **Rol** como custom claim `admin: true` en la cuenta, puesto solo desde el servidor. **Nombre** en el `displayName` de la cuenta. Desaparece la tabla `profiles`.
- **Circuitos solo en el código** (`_CIRCUIT_CATALOG` de `src/circuits.js`), igual que los trazados, offsets y coordenadas. Se quitan `loadFromSupabase()` y la página «Circuitos» del admin.
- **Modo demo fuera**: la app es solo para el equipo; se quita la lectura de `settings.demo_mode` y la página «Modo Demo» del admin. El código del modo demo (`_launchDemoMode`) se conserva, sin llamarse.
- **Invitación**: el admin crea la cuenta sin contraseña desde el servidor y el navegador del admin pide a Firebase que mande el correo de restablecer contraseña. Firebase envía el correo; la página para poner la contraseña es la de Firebase, que vuelve a `/landing.html`.
- **Sin secretos en el código ni en manos de Claude**: la configuración web de Firebase es pública y va en el código; la clave de cuenta de servicio la pega el usuario en Vercel.

## Arquitectura

### 1. Navegador — `src/firebase-auth.js` (nuevo)

- Carga previa en cada página que lo use, desde jsDelivr (permitido ya en `script-src`):
  `https://cdn.jsdelivr.net/npm/firebase@10.14.1/firebase-app-compat.js` y `…/firebase-auth-compat.js`.
- Inicializa con `FIREBASE_CONFIG` (apiKey, authDomain, projectId, appId — valores públicos que da el usuario) y persistencia `LOCAL` (la sesión sobrevive a cerrar el navegador; el token de 1 h se renueva solo).
- Expone `window.SPAuth`:
  - `ready() → Promise<User|null>` — resuelve con el primer `onAuthStateChanged`.
  - `signIn(email, password) → Promise<User>` · `signOut()` · `sendReset(email)` (con `url: location.origin + '/landing.html'`).
  - `idToken(force = false) → Promise<string>` — `''` sin sesión.
  - `isAdmin() → Promise<boolean>` — lee `admin === true` de `getIdTokenResult()`.
  - `name()` — `displayName || email`.
- Errores de Firebase traducidos a mensajes en español (`auth/invalid-credential`, `auth/too-many-requests`, `auth/network-request-failed`, otro → genérico).

### 2. Páginas

| Página | Cambio |
|---|---|
| `src/landing.html` | Login con `SPAuth.signIn`; enlace «¿Has olvidado la contraseña?» → `sendReset`. Fuera la tarjeta «Activar cuenta» y el código de invitación por hash. Tras entrar: admin → `/hub.html`, resto → `/index.html`. |
| `src/index.html` | `_spRolePromise` con `SPAuth.ready()` + `isAdmin()`; sin sesión → `/landing.html`; admin → `/hub.html` salvo `?hub`. Fuera el `<script>` de supabase-js. `signOutSP()` → `SPAuth.signOut()`. |
| `src/hub.html`, `src/admin.html` | Mismo control de acceso con `SPAuth` (solo admin). |
| `src/profile.html` | Cambiar nombre → `user.updateProfile({displayName})`. Borrar cuenta → `user.delete()`; si Firebase pide login reciente (`auth/requires-recent-login`), pedir la contraseña y `reauthenticateWithCredential` antes. |
| `src/app.js` | Fuera `loadFromSupabase()` y la lectura de `demo_mode`. |
| `src/circuits.js` | Fuera `loadFromSupabase`. Catálogo + 7 circuitos del VPS (tabla abajo). |
| `src/logger-connector.js`, `src/en-ai-engineer.js` | Token con `SPAuth.idToken()` en vez de la sesión de Supabase (mismo uso: cabecera `Authorization: Bearer` y primer mensaje del WS). |
| `src/supabase.js`, `src/supabase-config.js` | Borrar (no los carga ninguna página). |

Circuitos que se añaden al catálogo (puertos de `/api/status` del VPS):

| slug | nombre | puerto | coordenadas (meteo) |
|---|---|---|---|
| korridas | Korridas | 7633 | 41.17568, -8.68299 (Matosinhos, OSM) |
| kartodromo-de-tapia | Kartódromo de Tapia | 8443 | 43.54655, -6.90399 (OSM) |
| misanino-kart | Misanino Kart (IT) | 8043 | sin coordenadas (no está en OSM; pendiente del usuario) |
| worldkarts | WorldKarts (BE) | 8143 | sin coordenadas (OSM da dos sedes; pendiente del usuario) |
| firstkartinn | First Kart Inn (BE) | 8113 | 50.90603, 4.41669 (Machelen, OSM) |
| grancanaria-karting | Gran Canaria Karting | 9183 | sin coordenadas (no está en OSM; pendiente del usuario) |
| prestige-karting | Prestige Karting | 9613 | 43.34890, 6.33847 (Le Luc, OSM) |

Sin coordenadas el aviso de lluvia simplemente no aparece en ese circuito. El test `tests/circuit-coords.test.js` pasa a comprobar solo los circuitos que tienen coordenadas, con rango ampliado a Europa (`27 < lat < 56`, `-17 < lon < 20`), y que la lista de los que no tienen es exactamente `['misanino-kart', 'worldkarts', 'grancanaria-karting']`.

### 3. Funciones de Vercel

- `api/_firebase.js` (nuevo, el `_` evita que Vercel lo publique): inicializa `firebase-admin` con `FIREBASE_SERVICE_ACCOUNT` (JSON completo en una variable de entorno). `verifyRequest(req) → decodedToken | null` (cabecera `Authorization: Bearer`), `requireAdmin(req, res) → decodedToken | null` (401/403 si no).
- `api/admin.js`, acciones (todas exigen admin):
  - `list-users` → `listUsers(1000)` → `{uid, email, name, admin, createdAt, lastSignIn}`.
  - `create-user` `{email, name, password, role}` → `createUser` + claim si `role==='admin'`.
  - `invite-user` `{email, name}` → `createUser` sin contraseña; el navegador del admin llama luego a `SPAuth.sendReset(email)`.
  - `set-role` `{uid, role}` → `setCustomUserClaims(uid, role==='admin' ? {admin:true} : {})`; no permite quitarse el admin a uno mismo.
  - `delete-user` `{uid}` → `deleteUser`; no permite borrarse a uno mismo.
- `api/ai-engineer.js`: `verifyRequest`; sin token válido → 401. Fuera la consulta a `profiles`.
- `api/profile.js`: borrar (lo hace el navegador).
- `package.json`: fuera `@supabase/supabase-js`, dentro `firebase-admin` (versión exacta fijada).

### 4. Logger del VPS — `stintpro-logger/server.js`

Sustituye `verifySupabaseJwt` por `verifyFirebaseIdToken(token)`:
- Claves públicas JWK de `https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`, caché 1 h (respetando la misma estructura que la caché JWKS actual).
- Cabecera `alg === 'RS256'` y `kid` conocido; firma RS256 con `crypto.verify('sha256', …, {key: jwk, format: 'jwk'})`.
- Payload: `aud === FIREBASE_PROJECT_ID`, `iss === 'https://securetoken.google.com/' + FIREBASE_PROJECT_ID`, `exp > ahora`, `iat <= ahora + 60 s`, `auth_time <= ahora + 60 s`, `sub` no vacío.
- `FIREBASE_PROJECT_ID` por variable de entorno del servicio systemd (sin secreto). Sin la variable, ningún token es válido (las lecturas con API key siguen funcionando).
- La ruta con `x-api-key` no cambia. Se conserva `_injectJwksForTest` (renombrada si hace falta) para los tests.

### 5. Seguridad (`vercel.json`)

`connect-src` añade `https://identitytoolkit.googleapis.com https://securetoken.googleapis.com` y quita los dos orígenes de Supabase. El resto de la CSP no cambia.

### 6. Herramienta para el primer admin — `tools/firebase-set-admin.js`

`node tools/firebase-set-admin.js <ruta-cuenta-servicio.json> <email>` → pone `{admin:true}` en esa cuenta e imprime el resultado. La ejecuta el usuario en su Mac; la clave no entra en el repo (`.gitignore` con `*service-account*.json`).

## Lo que hace el usuario (no Claude)

1. Crear el proyecto en console.firebase.google.com, activar «Email/contraseña» y registrar una app web; pasar la configuración web (pública).
2. Añadir `stintpro.vercel.app` (y `localhost` para pruebas) a los dominios autorizados de Firebase Authentication.
3. Crear una clave de cuenta de servicio y pegarla en Vercel como `FIREBASE_SERVICE_ACCOUNT`; quitar `SUPABASE_URL` y `SUPABASE_SERVICE_KEY`.
4. Crear su propia cuenta (desde la consola de Firebase) y ejecutar `tools/firebase-set-admin.js` una vez.
5. Autorizar el despliegue: push a `main` (Vercel) y, en el VPS, `FIREBASE_PROJECT_ID` en el servicio + copiar `server.js` + reiniciar en un hueco sin sesiones activas.
6. Volver a invitar a los usuarios.

## Pruebas

- `stintpro-logger/__tests__`: `verifyFirebaseIdToken` con un par RSA generado en el test y claves inyectadas (sin red): token válido; firma de otra clave; `kid` desconocido; `alg` distinto; `aud` o `iss` de otro proyecto; caducado; `iat` en el futuro; `sub` vacío; sin `FIREBASE_PROJECT_ID`. Los tests de auth existentes (API key, WS) siguen verdes.
- `tests/`: `circuit-coords.test.js` actualizado (arriba); la suite completa del cliente verde.
- `api/_firebase.js`: test con `firebase-admin` simulado por inyección (`verifyRequest` sin cabecera, con token inválido, con token válido; `requireAdmin` 403 sin claim).
- Navegador (local, con el proyecto de Firebase real del usuario cuando exista): login correcto e incorrecto, «¿Has olvidado la contraseña?», redirecciones admin/usuario, cierre de sesión, sin errores de CSP en Vercel tras desplegar.

## Riesgos y límites

- Hasta desplegar web + logger + variables de Vercel, nadie puede entrar (igual que ahora).
- Firebase Auth es de Google: si un día se dejara de usar, la cuenta se pierde igual que con Supabase. A diferencia del plan gratuito de Supabase, Firebase Auth no pausa proyectos inactivos.
- El correo de Firebase sale de `noreply@<proyecto>.firebaseapp.com` y puede caer en spam la primera vez.
- Sin coordenadas, 3 circuitos del VPS no tendrán aviso de lluvia hasta que el usuario las confirme.
