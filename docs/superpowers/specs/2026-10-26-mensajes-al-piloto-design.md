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

- Si se rechaza (validación o `slug` desconocido), el error lleva `about:'team_roster'`: `{type:'error', msg, about:'team_roster'}`. El panel lo muestra en la cabecera del modal y reintenta en la siguiente comprobación; un `pilot_presence` posterior (el VPS lo manda tras aceptar la lista) lo limpia.

App → VPS, para la pantalla «¿Quién eres?»: `{type:'roster_get', slug, dorsal}` → `{type:'team_roster', pilotos, current}` o `{type:'team_roster', pilotos:null}` si ningún panel la ha publicado.

### Suscripción del piloto — `pilot` (ampliado)

```json
{ "type": "pilot", "slug": "campillos", "dorsal": "17", "pilot": 0 }
```

- `pilot` es opcional (índice en la lista). Sin él, el móvil recibe datos de carrera pero no mensajes dirigidos.
- Volver a enviar `pilot` desde la misma conexión **sustituye** la suscripción anterior (el piloto puede elegirse desde la pantalla del piloto sin reconectar). Hoy `subscribePilot` solo añade: hay que quitar el `ws` de su dorsal anterior.
- Tras suscribirse, el VPS le manda la lista actual si existe.
- La app **reenvía** `pilot` cada vez que su identidad cambia al llegar una lista nueva (ver «App del piloto»); si se ha quedado sin piloto lo manda sin el campo `pilot` y el VPS la deja en `null` (no recibe mensajes dirigidos).
- **Latido**: el VPS hace `ping` cada 10 s solo a las conexiones registradas con `pilot` (no a paneles ni admin); si una no contestó `pong` desde el ping anterior se corta (`terminate`) y sale de la presencia. Así un socket medio abierto (móvil sin cobertura que no llegó a cerrar) deja de contar en ≤ ~20 s.

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
- **«Entregado»** (`delivered ≥ 1`) = enviado a al menos un móvil del piloto con conexión viva (latido ≤ ~20 s). No es un acuse de lectura del móvil.
- Si se rechaza (validación, `slug` desconocido o límite de ritmo) el error lleva el `id` del mensaje: `{type:'error', msg, id}`. El panel rechaza ese envío pendiente y muestra «No enviado: {msg}».

## Panel (navegador)

### Módulo nuevo `src/en-pilot-link.js`

Conexión propia al WebSocket del VPS, **independiente del modo de datos** del panel (Logger, directo a Apex o replay): los mensajes deben funcionar aunque los datos vengan directos de Apex.

- URL: la misma que usa `logger-connector.js` (`AppState.loggerUrl` → `localStorage.stintpro_logger_url`), en `wss://`. Auth con `SPAuth.idToken()`; reconexión cada 5 s con token renovado.
- Con `cfg.myDorsal` y circuito activo, publica `team_roster` al conectar y cuando cambian `cfg.pilotos` o `EnSession.currentPilot` (comparando con lo último enviado, sin depender de quién lo cambió).
- Guarda `connected` de `pilot_presence` y los acuses por `id`.
- Expone `EnPilotLink.send(text, tone)` → promesa con el acuse (o error «sin conexión» / tiempo agotado a los 5 s).
- Núcleo puro testeable (validar y construir mensajes, decidir cuándo republicar) separado de la parte con `WebSocket`, como `en-apex-team.js`.

### Botón y modal

- Botón **📻 RADIO** en la pestaña **Mi equipo**, en la tarjeta «Piloto en pista», junto a «🔄 Cambio» (`_enRenderTeam` en `en-team.js`). Desactivado y con título «sin conexión» si el enlace no está autenticado. (Cambio pedido por el usuario el 2026-10-26: antes iba como 📱 en la baldosa del stint.)
- Modal con estética del panel (`sp-modal`):
  - Cabecera: «Para: **{piloto en pista}** · 📱 conectado / sin móvil» (de `pilot_presence`). Sin piloto marcado → «Marca quién va en pista» y botones desactivados. Si el VPS rechazó la lista (`about:'team_roster'`), en su lugar «El servidor rechazó la lista de pilotos: {msg}».
  - Rejilla de los 13 mensajes rápidos, coloreados por tono, primera fila Box. Un toque envía.
  - Campo de texto libre (máx. 40) + Enviar.
  - Línea de estado del último envío: «Entregado a {piloto}» o «No entregado: {piloto} no tiene el móvil conectado»; si el VPS lo rechaza, «No enviado: {motivo}».

## App del piloto (`~/stintpro_pilot`)

- **Setup**: tras circuito y dorsal, sección «¿Quién eres?» con la lista de `roster_get` como botones. Se guarda en el móvil el índice (`pilot_<slug>_<dorsal>`) **y el nombre elegido** (`pilotName_<slug>_<dorsal>`). Sin lista: aviso «El panel del equipo no ha publicado los pilotos todavía» y se puede entrar igualmente. Al cambiar de dorsal se descartan la lista y el piloto del anterior; «Empezar» pasa a la pantalla del piloto el índice guardado del circuito+dorsal actuales.
- **Identidad** (`resolvePilot` en `lib/team_link.dart`): el panel rellena los huecos («Piloto 2», «Yo») con los nombres de Apex en orden, así que el índice solo no identifica al piloto. Con cada lista: sin lista → se conserva el índice; sin nombre guardado (instalaciones previas) → solo se comprueba el rango; mismo nombre en el mismo índice → se mantiene; el nombre está en otra posición → esa; ya no está → sin piloto (hay que volver a elegir). Si cambia, se actualizan (o borran) las prefs y se reenvía `pilot`. Los nombres de relleno se pueden elegir igualmente en el selector.
- **Pantalla del piloto**:
  - Suscribe `pilot` con el índice guardado (si no llega de la pantalla anterior, p. ej. tras el login, lo lee de prefs); si llega una lista nueva recalcula la identidad y actualiza el nombre mostrado.
  - Si no hay piloto elegido o la lista llega más tarde, se puede elegir desde la propia pantalla (toque en la cabecera) y se reenvía `pilot`.
  - Indicador **«📢 tú en pista»** junto a LIVE cuando `current` es su índice.
  - Aviso de `team_msg`: color de fondo/borde según `tone` (rojo, naranja, azul); **se cierra solo a los 10 s**, sin toque; un mensaje nuevo sustituye al visible y reinicia los 10 s.

## Fallos

- Panel sin conexión al VPS → botón desactivado.
- VPS reiniciado → lista perdida; el panel la republica al reconectar y las apps la reciben al resuscribirse.
- Móvil sin cobertura al enviar → «No entregado»; no se reintenta solo.
- Envío justo en el relevo, antes de que el panel cambie de piloto → va al saliente. Mitigado por la cabecera «Para: X» del modal y por «📢 tú en pista» en la app.
- Lista cambiada en el panel (nombres de Apex sobre los de relleno, pilotos reordenados) → la app sigue al nombre guardado; si ya no está, se queda sin piloto, lo dice al VPS y se vuelve a pedir.
- Móvil que pierde cobertura sin cerrar el socket → el latido lo corta en ≤ ~20 s; hasta entonces un envío aún puede contar como «Entregado».
- Error del VPS al enviar o al publicar la lista → visible en el modal (no se queda en «Sin respuesta del servidor»).

## Pruebas

- **Logger** (`stintpro-logger/__tests__`): validación de `team_roster`; entrega solo al índice en pista; `team_msg` sin `pilot` llega a todo el dorsal; acuse con `delivered` correcto (incluido 0); `pilot_presence` al entrar, salir, cambiar de piloto y de dorsal; resuscripción sin duplicados; límites de tamaño y de ritmo; latido (ping, corte sin pong, paneles excluidos) con timers falsos; errores de `team_msg` con `id` y de `team_roster` con `about`.
- **Panel** (`tests/`): núcleo puro de `en-pilot-link` (construcción de mensajes, cuándo republicar la lista) y manejo de errores del VPS en `_onMsg`.
- **App**: `resolvePilot` (todos los casos, incluidos «Piloto 2» → «Ana» → sin piloto y «Javi» movido de 0 a 2) y `storePilot`/`loadPilot`.
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
