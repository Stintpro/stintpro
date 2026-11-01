# Paso automático del logger a Apex directo

**Fecha:** 2026-11-01
**Estado:** pendiente de revisión

## Problema

En modo logger, si cae el VPS el panel reintenta cada 5 s y se queda con los últimos datos. No lo avisa: `onStatus` solo llega a `console.log`, y el panel no tiene indicador de conexión. Apex sigue funcionando, pero hay que cambiar de modo a mano y darse cuenta a tiempo.

## Objetivo

- Avisar en pantalla cuando se pierde el logger.
- Pasar solo a Apex directo cuando la caída no es un simple reinicio.
- Quedarse en Apex hasta que acabe la sesión: el panel no vuelve solo al logger.

**Fuera de alcance:** detectar un logger conectado pero congelado; no se distingue con fiabilidad de un circuito callado, y un cambio falso en carrera sería peor que no cambiar. Tampoco cubre grabación, app del piloto ni radio mientras el VPS esté caído.

## Diseño

Sin conector nuevo. `Logger` (`src/logger-connector.js`) guarda los argumentos de `connect()` y, al decidir que el logger ha caído, hace:

1. `Logger.disconnect()`.
2. `window.ApexConnector = _origApex`.
3. `_origApex.connect(...argumentos guardados)`.
4. Muestra el aviso definitivo.

Reasignar `window.ApexConnector` evita envolver los conectores: `en-apex-team.js` y `en-grid.js` ya leen ese global, y el `disconnect()` final de `en-strategy.js` y `sprint.js` llega al conector correcto. Vale para resistencia y sprint. `_connMode` no cambia, así que la siguiente sesión empieza otra vez por el logger.

### Temporización

| Segundos sin logger | Efecto |
|---|---|
| 0 | Sigue reintentando cada 5 s, como hoy |
| 10 | Aviso «Logger caído · reconectando» |
| 20 | Paso a Apex y aviso «Logger caído · datos directos de Apex» |

Un reinicio del VPS tarda ~6 s, así que un despliegue no muestra aviso ni cambia de fuente.

- El temporizador arranca en el primer `onclose` o error de conexión sin temporizador activo, también si el VPS ya estaba caído al conectar.
- Lo cancela el primer **mensaje** del logger, no `onopen`: un socket que abre y se cierra sin datos no demuestra nada.
- `disconnect()`, un `connect()` nuevo y el error `fatal` lo anulan. Un error fatal deja `slug = null` y no provoca el paso a Apex.
- Solo actúa si `window.ApexConnector === Logger`, para no interferir con replay.

### Aviso

Elemento propio `#logger-down-badge`, separado de `#apex-http-badge` y encima de él, porque `_stopHttp()` retira el suyo en cada `connect()`. Se quita con el primer mensaje del logger y con `disconnect()`. Tras el paso a Apex permanece hasta acabar la sesión.

## Qué pasa con el estado del panel

Comprobado en el código y con un snapshot real:

- **Sesión nueva:** un parser recién creado no dispara `onNewSession` en el primer snapshot (medido: 0), así que el cambio no borra el estado de la carrera.
- **Mensajes:** el tablón reenviado llega con `history: true`, sin luces ni franja, y `ingestMessage` descarta duplicados.
- **Historial de vueltas:** el conector directo no manda `lapHistoryTotal`, así que el panel usa la fusión por valor hasta que `request.php` devuelve el historial completo. Esa fusión puede perder una vuelta de tiempo repetido; debe corregirse al llegar el historial.
- **Cola de box y paradas:** viven en el panel y siguen actualizándose con el estado directo. Las paradas ocurridas durante los 20 s de corte son el principal riesgo y deben medirse.
- **Reanudar:** al recargar con `connMode: 'logger'` se empieza por el logger y, si sigue caído, vuelve a cambiar a los 20 s.

## Pruebas

**Tests automáticos** (`tests/logger-failover.test.js`, con los conectores reales y `WebSocket` y temporizadores falsos):

- Sin cambio si el logger vuelve antes de 20 s; sin aviso si vuelve antes de 10 s.
- Aviso a los 10 s y paso a Apex a los 20 s, con los mismos argumentos.
- También si el logger nunca llegó a conectar.
- Un socket que abre y se cierra sin datos no cancela el temporizador.
- Tras el cambio no quedan reintentos al logger.
- `disconnect()`, un error fatal y el modo replay no provocan el cambio.
- El siguiente `connect()` por `selectRaceType` empieza por el logger.

**Validación en vivo con dos paneles:** el raw log solo trae un snapshot al inicio, así que el banco no puede reproducir la parrilla y el historial que Apex da al conectar a mitad de carrera. Se usa una sesión real con dos pestañas en modo logger: una de control y otra a la que se corta el logger. A los 20 min se comparan vueltas por kart, paradas y cola de box. Criterio: sin vueltas duplicadas y ninguna perdida una vez cargado el historial; cualquier parada perdida en el corte se documenta.

## Entrega

1. **Fase 1:** aviso, publicable por separado.
2. **Fase 2:** paso a Apex y validación en vivo.
