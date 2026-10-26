# Mensajes del panel al piloto en pista — diseño

Fecha: 2026-10-26 · Aprobado por el usuario en conversación el mismo día.

## Contexto

StintPro Pilot (app Flutter, repo aparte `~/stintpro_pilot`) ya muestra un aviso a pantalla completa cuando le llega `{type:'team_msg', text}` por el WebSocket del VPS, y el logger ya acepta `team_msg {slug, dorsal, text}` y lo entrega a **todos** los móviles suscritos a ese dorsal. Pero el panel de StintPro no tiene nada que los envíe.

En resistencia **cada piloto lleva su propio móvil y su propio RaceBox**, y todos se suscriben al mismo dorsal (el del equipo). Entregar por dorsal haría saltar «BOX» también en los móviles de los que esperan en el box. Hay que entregar **solo al móvil del piloto que va en pista**.

## Decisiones tomadas

- **Quién va en pista lo decide el panel** (`EnSession.currentPilot`), no el móvil. El panel ya lo actualiza solo con el nombre que da Apex en cada relevo (`_enPilotFromApex`, 153 de 158 relevos en la 7H de Los Santos) y se puede corregir a mano. Descartado: que cada móvil se detecte en pista por la velocidad del RaceBox.
- **Mensajes solo al piloto en pista.** No hay mensajes a un piloto del box ni opción «mandar a todos».
- **El piloto no escribe su nombre: lo elige de la lista que publica el panel.** Se identifica por la **posición** en esa lista, no por el texto, para sobrevivir a que el panel cambie «Piloto 2» por el nombre de Apex.
- **Sin interacción del piloto**: el aviso se cierra solo a los **10 s**; no hay «visto». El panel solo sabe «entregado» / «no entregado».
- **Sin cola**: un mensaje a un móvil desconectado se pierde y el panel ve «No entregado». Un BOX con 30 s de retraso es peor que no recibirlo.
- **13 mensajes rápidos fijos** más texto libre de hasta 40 caracteres.

## Mensajes rápidos

| Grupo | Texto | Tono (color del aviso) |
|---|---|---|
| Box | BOX · BOX PRÓXIMA · NO ENTRES · UNA VUELTA MÁS | `red` |
| Ritmo | PUSH · MANTÉN RITMO · TRANQUILO | `orange` |
| Rivales | RIVAL DETRÁS · ATACA | `orange` |
| Dirección | BANDERA AZUL | `blue` |
| Dirección | LÍMITES DE PISTA · SANCIÓN | `orange` |
| Otros | OK | `orange` |

El texto libre siempre va en `orange`. La primera fila del modal del panel es la de Box.

## Protocolo WebSocket (logger del VPS)

Todos los mensajes requieren la conexión autenticada (`auth` con API key o ID token de Firebase), como el resto.

### Lista de pilotos — `team_roster`

Panel → VPS, al conectar y cada vez que cambian `cfg.pilotos` o `EnSession.currentPilot`:

```json
{ "type": "team_roster", "slug": "campillos", "dorsal": "17",
  "pilotos": ["Javier", "Pablo", "Luis"], "current": 0 }
```

- Validación: `slug` existente; `dorsal` ≤ 16 caracteres; 1–10 pilotos (el máximo del panel, `MAX_PILOTS`); cada nombre 1–40 caracteres; `current` entero en rango o `null` (nadie marcado).
- El VPS lo guarda **en memoria** por `slug|dorsal` (`{pilotos, current, publishers:Set<ws>}`); la conexión que lo envía queda registrada como *publisher* hasta que se cierra. Sin base de datos: tras un reinicio el panel lo republica al reconectar.
- El VPS reenvía la lista a todas las apps suscritas a ese dorsal: `{type:'team_roster', pilotos, current}`.

App → VPS, para la pantalla «¿Quién eres?»: `{type:'roster_get', slug, dorsal}` → `{type:'team_roster', pilotos, current}` o `{type:'team_roster', pilotos:null}` si ningún panel la ha publicado.

### Suscripción del piloto — `pilot` (ampliado)

```json
{ "type": "pilot", "slug": "campillos", "dorsal": "17", "pilot": 0 }
```

- `pilot` es opcional (índice en la lista). Sin él, el móvil recibe datos de carrera pero no mensajes dirigidos.
- Volver a enviar `pilot` desde la misma conexión **sustituye** la suscripción anterior (el piloto puede elegirse desde la pantalla del piloto sin reconectar). Hoy `subscribePilot` solo añade: hay que quitar el `ws` de su dorsal anterior.
- Tras suscribirse, el VPS le manda la lista actual si existe.

### Presencia — `pilot_presence`

VPS → publishers del dorsal, cada vez que un móvil entra, sale o cambia de piloto:

```json
{ "type": "pilot_presence", "dorsal": "17", "connected": [0, 2] }
```

(índices de piloto con al menos un móvil conectado). También se envía a un publisher justo después de su `team_roster`.

### Envío — `team_msg` (ampliado)

Panel → VPS:

```json
{ "type": "team_msg", "slug": "campillos", "dorsal": "17",
  "text": "BOX", "tone": "red", "pilot": 0, "id": "m-1698..." }
```

- Con `pilot`: se entrega solo a los móviles suscritos a ese dorsal **con ese índice**.
- Sin `pilot`: comportamiento actual, a todos los móviles del dorsal (compatibilidad con el replay y clientes antiguos).
- `tone` ∈ `red|orange|blue`, por defecto `orange`. `text` 1–40 caracteres cuando lleva `pilot` (se mantiene el límite actual de 500 sin él). `id` opcional, hasta 64 caracteres, se devuelve tal cual en el acuse.
- Se mantiene el límite de 10 mensajes / 10 s por conexión.
- A la app le llega `{type:'team_msg', text, tone}`.
- Acuse al panel: `{type:'team_msg_sent', id, dorsal, pilot, delivered: <nº de móviles>}`. `delivered: 0` = no entregado.

## Panel (navegador)

### Módulo nuevo `src/en-pilot-link.js`

Conexión propia al WebSocket del VPS, **independiente del modo de datos** del panel (Logger, directo a Apex o replay): los mensajes deben funcionar aunque los datos vengan directos de Apex.

- URL: la misma que usa `logger-connector.js` (`AppState.loggerUrl` → `localStorage.stintpro_logger_url`), en `wss://`. Auth con `SPAuth.idToken()`; reconexión cada 5 s con token renovado.
- Con `cfg.myDorsal` y circuito activo, publica `team_roster` al conectar y cuando cambian `cfg.pilotos` o `EnSession.currentPilot` (comparando con lo último enviado, sin depender de quién lo cambió).
- Guarda `connected` de `pilot_presence` y los acuses por `id`.
- Expone `EnPilotLink.send(text, tone)` → promesa con el acuse (o error «sin conexión» / tiempo agotado a los 5 s).
- Núcleo puro testeable (validar y construir mensajes, decidir cuándo republicar) separado de la parte con `WebSocket`, como `en-apex-team.js`.

### Botón y modal

- Botón **📱** en la baldosa del stint, junto al botón de mensajes de dirección de carrera (`_enMsgBtnHtml` en `en-grid.js`). Desactivado y con título «sin conexión» si el enlace no está autenticado.
- Modal con estética del panel (`sp-modal`):
  - Cabecera: «Para: **{piloto en pista}** · 📱 conectado / sin móvil» (de `pilot_presence`). Sin piloto marcado → «Marca quién va en pista» y botones desactivados.
  - Rejilla de los 13 mensajes rápidos, coloreados por tono, primera fila Box. Un toque envía.
  - Campo de texto libre (máx. 40) + Enviar.
  - Línea de estado del último envío: «Entregado a {piloto}» o «No entregado: {piloto} no tiene el móvil conectado».

## App del piloto (`~/stintpro_pilot`)

- **Setup**: tras circuito y dorsal, sección «¿Quién eres?» con la lista de `roster_get` como botones. Se guarda el índice en el móvil (`pilot_<slug>_<dorsal>`). Sin lista: aviso «El panel del equipo no ha publicado los pilotos todavía» y se puede entrar igualmente.
- **Pantalla del piloto**:
  - Suscribe `pilot` con el índice guardado; si llega una lista nueva actualiza el nombre mostrado.
  - Si no hay piloto elegido o la lista llega más tarde, se puede elegir desde la propia pantalla (toque en la cabecera) y se reenvía `pilot`.
  - Indicador **«📢 tú en pista»** junto a LIVE cuando `current` es su índice.
  - Aviso de `team_msg`: color de fondo/borde según `tone` (rojo, naranja, azul); **se cierra solo a los 10 s**, sin toque; un mensaje nuevo sustituye al visible y reinicia los 10 s.

## Fallos

- Panel sin conexión al VPS → botón desactivado.
- VPS reiniciado → lista perdida; el panel la republica al reconectar y las apps la reciben al resuscribirse.
- Móvil sin cobertura al enviar → «No entregado»; no se reintenta solo.
- Envío justo en el relevo, antes de que el panel cambie de piloto → va al saliente. Mitigado por la cabecera «Para: X» del modal y por «📢 tú en pista» en la app.
- Índice guardado en la app fuera de rango tras cambiar la lista → se descarta y se vuelve a pedir.

## Pruebas

- **Logger** (`stintpro-logger/__tests__`): validación de `team_roster`; entrega solo al índice en pista; `team_msg` sin `pilot` llega a todo el dorsal; acuse con `delivered` correcto (incluido 0); `pilot_presence` al entrar, salir y cambiar de piloto; resuscripción sin duplicados; límites de tamaño y de ritmo.
- **Panel** (`tests/`): núcleo puro de `en-pilot-link` (construcción de mensajes, cuándo republicar la lista).
- **App**: widget tests del aviso (cierre a los 10 s, sustitución) y de la selección de piloto.
- **Extremo a extremo** con `replay-vps.js` (hay que añadirle el mismo reparto): emulador como móvil del piloto en pista + cliente de prueba como móvil de un piloto en el box; comprobar que BOX solo llega al de pista y que al cambiar `currentPilot` el siguiente llega al otro.

## Despliegue

VPS (scp + reinicio, solo sin carreras en vivo), web (push a `main` → Vercel) y nueva versión de la app. Cada paso con confirmación explícita del usuario.

## Fuera de alcance

- Mensajes a pilotos del box o a todos.
- Confirmación de lectura.
- Cola o reintento automático.
- Detección automática de quién va en pista por velocidad.
- Lista de mensajes rápidos editable.
