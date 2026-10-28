# Radio web móvil — mensajes al piloto sin el panel

Fecha: 2026-10-28 · Estado: diseño aprobado en chat, pendiente de revisión escrita

## Objetivo

Una persona con **solo un móvil** (mecánico, jefe de equipo en el muro) manda
mensajes de radio al piloto en pista sin abrir el panel StintPro. Mismo canal
que la radio del panel (spec `2026-10-26-mensajes-al-piloto-design.md`): el
logger del VPS reenvía `team_msg` a la app StintPro Pilot del móvil del piloto,
que lo muestra a pantalla completa 10 s.

Fuera de alcance: enlaces sin cuenta, mandar a todos a la vez, historial de
mensajes, confirmación de lectura del piloto, cualquier dato de carrera
(posiciones, tiempos) en esta web.

## Decisiones tomadas

| Pregunta | Decisión |
|---|---|
| ¿A quién va cada mensaje? | Se elige destinatario **en cada envío**; se preselecciona el que Apex marca en pista. |
| ¿De dónde sale la lista de pilotos sin panel? | De **Apex** (`request.php` `.INF`: plantilla completa + `current="1"`). |
| ¿Acceso? | **Cuenta StintPro** (Firebase, claim member/admin), igual que panel y app. |
| ¿Dónde vive? | Página nueva en la web de Vercel: `src/radio.html` → `stintpro.vercel.app/radio.html`. |
| Prioridad de diseño | **Solo móvil** (360–430 px, vertical, una mano). |

Enfoque descartado: que el logger lea `.INF` y publique la lista por su cuenta
(más código y despliegues en el VPS, una consulta a Apex por dorsal).

## Arquitectura

```
radio.html (móvil) ──login──▶ Firebase Auth (SPAuth, firebase-auth.js)
     │
     ├──POST .INF──▶ request.php de Apex  (CORS *, puerto = WS − 3)
     │   (fila rNNN del dorsal: conexión WS puntual a Apex, como en-apex-team.js)
     │
     └──WS──▶ logger VPS (wss://stintpro.duckdns.org)
              auth{token} → team_watch / team_roster{source:'radio'} / team_msg
                                  │
                                  └──▶ app StintPro Pilot (móviles del dorsal)
```

### Piezas reutilizadas (sin copiar código)

- `src/firebase-auth.js` (`SPAuth`): login, `idToken()`, `isMember()`.
- `src/en-apex-team.js` núcleo `EnApexTeam`: `REQUEST_URL`, `parseInf`.
  La búsqueda de la fila (`_apexRowIdOf`) hoy depende de `AppState`; se extrae
  a una función pura reutilizable `EnApexTeam.rowIdFor(slug, port, dorsal)`
  (misma lógica: WS puntual, `grid|`, `ApexGrid.parseGridHtml`, timeout 12 s)
  y el panel pasa a usarla también.
- `src/en-pilot-link-core.js`: `QUICK_MESSAGES` (mismos textos y tonos que el panel).
- `src/circuits.js` `_CIRCUIT_CATALOG`: los 21 circuitos con slug y puerto.

### Piezas nuevas

- `src/radio.html` + `src/radio.css` + `src/radio.js` (UI y conexión).
- `src/radio-core.js` — lógica pura con tests (`tests/radio-core.test.js`):
  qué lista usar, a quién preseleccionar, construir `team_roster`/`team_msg`,
  control anti-repetición.
- `src/radio.webmanifest` + icono (añadir a pantalla de inicio).
- Logger: mensaje `team_watch` y campo `source` en `team_roster`
  (`stintpro-logger/team-link.js`, `server.js`, tests).

## Protocolo con el logger

### Nuevo: `team_watch {slug, dorsal}`

El socket se apunta como **observador** del dorsal sin publicar nada. Recibe:

- en el acto, `team_roster {pilotos, current, source, panel}` (o `pilotos:null`
  si no hay lista; `panel` = sigue conectado algún panel que publicó la lista)
  y `pilot_presence {dorsal, connected}`;
- después, cada cambio de lista (`team_roster`), la desconexión del último
  panel (`team_roster` con `panel:false`) y cada cambio de presencia
  (`pilot_presence`). Los móviles siguen recibiendo `team_roster` con la forma
  de siempre (`{pilotos, current}`).

Errores con `about:'team_watch'`. Requiere `auth` como el resto de mensajes de
equipo. Un socket observa un solo dorsal; un nuevo `team_watch` sustituye al
anterior. Al cerrar, sale de los observadores.

### Cambio: `team_roster` lleva `source`

- El panel no manda `source` → se guarda como `'panel'` (compatibilidad total).
- La web manda `source:'radio'`.
- **El panel siempre gana**: un `team_roster` con `source:'radio'` se rechaza
  (`error`, `about:'team_roster'`, `msg:'lista del panel activa'`) si la lista
  actual es de `'panel'` y algún panel que la publicó sigue conectado. Si el
  panel se desconectó, el logger acepta la lista de la web, pero **la web
  nunca reemplaza una lista `source:'panel'`** (ni con `panel:false`): los
  nombres del panel los teclea el equipo y no coinciden con los de Apex;
  sustituirlos haría que los móviles olvidaran su piloto guardado y la radio
  del panel dejara de entregar (un corte de Wi-Fi de 1 s bastaría).
- Todo cambio de lista se reenvía a móviles **y** a observadores, con `source`.
  Hoy los paneles no reciben el `team_roster` de otro; los observadores sí.

`team_msg` no cambia. Con lista, la web manda `pilot` = índice elegido; sin
lista (tanda de alquiler, `.INF` vacío) manda sin `pilot` → llega a todos los
móviles del dorsal.

## Flujo de la web

1. **Login** (si no hay sesión o no es member/admin → pantalla de login; misma
   cuenta que el panel). Sesión caducada en cualquier momento → vuelve al login.
2. **Elegir circuito y dorsal** (lista de `_CIRCUIT_CATALOG`; se recuerda en
   `localStorage` la última elección, en try/catch).
3. Conecta al logger: `auth{token}` → `team_watch{slug, dorsal}`.
4. **Lista de pilotos:**
   - Si el logger devuelve lista `source:'panel'` → se usa tal cual, solo lectura,
     esté el panel conectado o no (la web nunca la reemplaza; si el panel cae se
     avisa «Lista del panel StintPro (panel desconectado)»).
   - Si no hay lista o es `source:'radio'` → la web pide `.INF` a Apex y publica
     `team_roster{source:'radio', pilotos, current}` con esos nombres (máx. 10,
     40 caracteres). Repite cada **60 s** para que `current` siga a Apex (la app
     del piloto muestra «📢 TÚ EN PISTA» con él). Solo republica si cambió.
   - Si Apex no trae plantilla → modo **«todo el dorsal»**: sin lista, sin
     selector de piloto, `team_msg` sin `pilot`.
   - Si llega un `team_roster` de `'panel'` mientras la web publicaba → deja de
     publicar y pasa a solo lectura.
   - Nombres de Apex a la lista: el orden de `.INF`. Si después abre un panel
     con otro orden, la app del piloto ya se reubica por nombre (`resolvePilot`).
5. **Destinatario:** preseleccionado el `current` de la lista (de Apex o del
   panel). Si no hay `current`, ninguno: los mensajes rápidos quedan inactivos
   hasta elegir. Elegir otro piloto no cambia la lista publicada; solo el
   destino de los mensajes siguientes. **Si cambia el piloto en pista (o la
   lista), la elección manual se descarta** y vuelve a preseleccionarse el que
   va en pista: un BOX no puede acabar en el móvil del que acaba de bajarse.
6. **Enviar:** un toque en un mensaje rápido o «Enviar» del texto libre →
   `team_msg{slug, dorsal, text, tone, pilot, id}` → `team_msg_sent` →
   «Entregado a CARLOS ✓» (verde) o «No entregado: CARLOS sin móvil conectado»
   (rojo); en modo «todo el dorsal», «Entregado a N móviles del #7 ✓». Sin respuesta en 5 s → «Sin confirmación».

## Interfaz — solo móvil

### Distribución (vertical, de arriba abajo)

1. **Barra de estado** fija: circuito · dorsal · conexión (🟢 conectado,
   🟠 reconectando, 🔴 sin conexión) · menú (cambiar dorsal, cerrar sesión).
2. **Pilotos**: botones grandes en rejilla de 2 columnas, el elegido resaltado;
   punto verde si su móvil está conectado (`pilot_presence`), gris si no.
   «EN PISTA» bajo el que marca la lista como `current`.
3. **Resultado del último envío** (una línea, grande).
4. **Mensajes rápidos** (`QUICK_MESSAGES`, mismos textos y tonos que el panel):
   rejilla de 2 columnas, en la mitad inferior de la pantalla (zona del pulgar).
5. **Texto libre** abajo del todo: campo + «Enviar», contador `n/40`.

### Requisitos móviles

- Ancho de diseño 360–430 px; en pantallas más anchas, columna centrada de 430 px.
- Todo lo pulsable ≥ 56 px de alto y ≥ 8 px de separación.
- Sin confirmaciones: un toque envía. Anti-repetición: tras enviar, ese botón
  muestra «Enviado ✓» y queda bloqueado **2 s**; los demás siguen activos.
- `viewport-fit=cover` y `env(safe-area-inset-*)` (notch y barra de inicio).
- Campo de texto con `font-size ≥ 16px` (iOS no hace zoom),
  `autocapitalize="characters"`, `enterkeyhint="send"`.
- Tema oscuro StintPro de **alto contraste**: texto blanco sobre fondo casi
  negro; tonos rojo/naranja/azul saturados como la app del piloto; contraste
  de texto ≥ 7:1.
- **Pantalla siempre encendida** con Screen Wake Lock (se vuelve a pedir al
  volver a la pestaña; si el navegador no lo soporta, se ignora).
- `navigator.vibrate(30)` al enviar donde exista (Android).
- **Sin cola offline**: si el WS no está abierto, los botones de envío se
  desactivan y se muestra «Sin conexión — no se puede enviar». Un mensaje que
  llega tarde es peor que ninguno.
- Ligera: HTML/CSS/JS sin frameworks ni build; solo el SDK compat de Firebase
  que ya usa la web.
- **PWA mínima**: `radio.webmanifest` (`display: standalone`, tema oscuro,
  icono 192/512 + `apple-touch-icon`). Sin service worker (no hace falta
  offline y evita cachés viejas).

## Errores y reconexión

- WS cerrado → reconexión con espera 1 s, 2 s, 5 s, 5 s…; al reconectar repite
  `auth` + `team_watch` (+ republica la lista si era de la web).
- `auth` rechazado → refresca el token una vez (`idToken(true)`); si vuelve a
  fallar → login.
- `.INF` falla (red, sin fila, `error`) → se mantiene la lista que hubiera; si
  no había ninguna, modo «todo el dorsal». Se reintenta en el siguiente ciclo
  de 60 s.
- Dorsal sin fila en la parrilla de Apex → aviso «Dorsal N no aparece en
  Apex» y modo «todo el dorsal».
- Errores del servidor con `about`/`id` se muestran en la línea de resultado.

## Seguridad

- Requiere token Firebase con claim member/admin (el logger ya lo exige).
- Todo texto que llega del servidor o de Apex (nombres de pilotos) se pinta
  con `textContent`, nunca `innerHTML` (`tests/radio-page.test.js` lo vigila).
- La CSP actual de `vercel.json` ya permite logger, Firebase y Apex; no cambia.

## Pruebas

- **Logger** (`stintpro-logger` tests): `team_watch` recibe lista y presencia
  al apuntarse y en cada cambio; `source` por defecto `'panel'`; lista
  `'radio'` rechazada con panel conectado y aceptada sin él; un panel pisa una
  lista `'radio'`; cierre del observador lo quita.
- **`radio-core`** (`tests/radio-core.test.js`): elección de lista (panel /
  Apex / ninguna), preselección del destinatario, `team_msg` con y sin
  `pilot`, recorte a 10 pilotos y 40 caracteres, anti-repetición de 2 s,
  republicar solo si cambió.
- **`EnApexTeam.rowIdFor`**: el panel sigue funcionando igual (tests de
  `apex-team` existentes).
- **Manual**: replay del VPS en local + app en el iPhone + `radio.html` en el
  navegador con tamaño 375×812; después prueba con el iPhone real abriendo la
  web y añadiéndola a la pantalla de inicio.

## Despliegue

- Web: push a `main` → Vercel (con confirmación explícita).
- Logger: copia de seguridad, `scp` de `team-link.js` y `server.js`, restart y
  md5, mirando antes los raw logs vivos (con confirmación explícita).
- Orden: primero el logger (es compatible hacia atrás: el panel actual no
  manda `source` ni `team_watch`), después la web.
