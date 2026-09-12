# Caja negra de diagnóstico — StintPro

**Fecha:** 2026-09-12
**Estado:** diseño aprobado (pendiente plan de implementación)

## Problema

Cuando en una carrera real algo falla en StintPro —datos que llegan mal, la
parrilla que se ve rara, un botón que no responde— no hay forma de saber qué
pasó. Solo existen `console.log` sueltos con "DEBUG" repartidos por los
conectores, que se pierden al recargar y que nadie está mirando en directo.

Se necesita una **caja negra**: un registro que, sin intervención del usuario,
capture cómo entran los datos, cómo se pintan y qué hace el usuario, y que
pueda **exportarse a un fichero** para analizarlo después (el usuario lo abre,
o se lo pasa a Claude).

## Decisiones tomadas

1. **Modo:** caja negra **siempre activa** (no un modo manual). Graba en
   segundo plano toda la carrera; si algo peta, ya está grabado.
2. **Persistencia:** **IndexedDB**. El log sobrevive a recargas y cierres de
   pestaña —que suelen ser justo el síntoma del fallo—.
3. **Nivel de captura:** **semántico**, no crudo. Se registran huellas
   compactas de cada evento, no snapshots completos de payload/DOM. Excepción:
   en errores de parseo sí se guarda el payload que rompió (redactado).

## Arquitectura

Un módulo nuevo y aislado: `src/en-blackbox.js`. No contiene lógica de negocio;
solo recibe eventos, los almacena en un ring buffer, los persiste y los
exporta. Se instrumentan **tres costuras ya existentes** ("grifos") que llaman
a su API. Si el módulo no está cargado, las llamadas son no-op (fail-safe:
la caja negra NUNCA puede romper la carrera).

### API pública (mínima)

```js
window.Blackbox = {
  event(grifo, tipo, datos),   // registra un evento (barato, síncrono, nunca lanza)
  export(),                    // genera y descarga el fichero .json
  recoverLast(),               // devuelve metadatos del log previo del mismo día (o null)
  clear(),                     // borra el store (tras exportar o al empezar sesión nueva)
  _ring, _flush, _scrub, _serialize   // internos, exportados para tests
};
```

`grifo` ∈ `'in' | 'render' | 'user'`. `event()` debe ser barato y a prueba de
fallos: envuelto en try/catch interno, nunca propaga excepciones al llamante.

### Los tres grifos

**1. Entrada de datos (`in`)** — instrumentar los callbacks de los conectores,
que son el único punto por el que entra todo:
- `src/logger-connector.js`: en `onmessage` (líneas ~63-119), tras `JSON.parse`,
  registrar `{ tipo: msg.type, karts: nº, bytes: evt.data.length }`. En
  `onopen`/`onclose`/`onerror` y en las llamadas a `onStatus`, registrar el
  cambio de estado de conexión. En el `catch` del parseo, registrar el error
  **con el payload crudo redactado**.
- `src/apex-connector.js`: equivalente en `onData`/`onStatus`/`onMessage`/
  `onComment`/`onTitle` (líneas ~34-111, 345) y en el `catch` de `parse`
  (línea ~103).

**2. Pintado (`render`)** — instrumentar el único punto de repintado:
- `src/en-grid.js`: en `_enRender()` (línea ~87), al terminar, registrar la
  "huella" del render: `{ filas: nº, lider: dorsal, banderas: [...],
  miStint: estado, destello: bool, vueltaRapida: bool }`. Permite detectar
  desajustes entre lo que entró y lo que se ve.

**3. Acciones de usuario (`user`)** — instrumentar los controles del panel:
- `src/en-grid.js` / `src/app.js`: `_enSetTab`, `_enPin`, `_enShowPilotSelect`,
  selector de columnas, filtros de categoría, entrada de PIN (solo el hecho, no
  el valor), entrar/salir demo, y el propio botón de exportar caja negra.

### Ring buffer

- Tope duro **doble**: ~5.000 eventos **Y** ~30 min de ventana. El que primero
  se llene descarta lo más antiguo (FIFO). Garantiza memoria acotada en 24h.
- Cada evento: `{ ts, grifo, tipo, datos }`. `datos` compacto.

### Persistencia (IndexedDB)

- Un único `object store` (p. ej. `blackbox`), rotación por sesión.
- Flush cada ~5 s y en `visibilitychange` (oculto) y `beforeunload`.
- Al arrancar la app: si hay un log previo **del mismo día**, ofrecer
  recuperarlo/exportarlo antes de iniciar sesión nueva (vía `recoverLast()`).

### Exportación

- Fichero `stintpro-blackbox_<circuito>_<YYYY-MM-DD_HHMM>.json`.
- Dos partes:
  - **Cabecera-resumen legible:** versión de app, circuito/sesión, ventana
    temporal cubierta, nº de eventos por tipo, últimos N errores, estado de
    conexión final.
  - **Eventos** en orden cronológico (JSONL o array), cada uno con `ts`,
    `grifo`, `tipo`, `datos`.
- Botón de exportar en el **panel de admin/diagnóstico** (`src/admin.html` /
  `logger-stats.html`), discreto, fuera de la vista de carrera.

## Privacidad y redacción

- **Nombre del piloto NO se registra** (coherente con el criterio RGPD ya
  aplicado en el informe de carrera y el score). Sí: dorsales, tiempos,
  posiciones, clases —datos de competición, no personales—.
- **API key y URL del logger nunca** se escriben (hoy en `localStorage`).
- El `_scrub()` recorta del payload crudo (solo presente en errores) cualquier
  cadena con pinta de token/key/credencial antes de guardarlo.

## Aislamiento y carga

- Todo el estado y la lógica en `src/en-blackbox.js`. Los grifos solo añaden
  una línea `window.Blackbox?.event(...)`.
- Cargar el `<script>` en `src/index.html` **antes** de los conectores y de
  `en-grid.js` (p. ej. justo después de `state.js`/`clock.js`), para que los
  grifos siempre lo encuentren.
- Patrón de export dual del repo:
  `if(typeof module!=='undefined')module.exports={...}` + `window.Blackbox`.

## Tests (TDD)

Nuevo `tests/blackbox.test.js`, mismo arnés que el resto (`assert` + `test`/
`group`, ejecutable con Node). IndexedDB y descarga mockeados. Casos:

- **Ring buffer:** respeta el tope de eventos; respeta el tope temporal;
  rotación FIFO descarta lo más viejo; nunca crece sin límite.
- **`_scrub`:** elimina tokens/keys/credenciales; deja intactos los datos de
  carrera.
- **`_serialize`:** la cabecera-resumen cuenta bien los eventos por tipo y
  refleja la ventana temporal; el cuerpo va en orden cronológico.
- **`event()` fail-safe:** con datos basura o store caído, no lanza.
- **Redacción:** un evento con nombre de piloto o api key no acaba en el log.

## Fuera de alcance (YAGNI)

- Envío automático al VPS (se descartó; el usuario exporta a mano).
- Snapshots completos de DOM o payload (salvo el payload de un error).
- Panel de visualización del log en la propia app (se analiza fuera).

## Ficheros afectados

- **Nuevo:** `src/en-blackbox.js`, `tests/blackbox.test.js`.
- **Modificados:** `src/logger-connector.js`, `src/apex-connector.js`,
  `src/en-grid.js`, `src/app.js` (una línea por grifo), `src/index.html`
  (carga del script), `src/admin.html` o `src/logger-stats.html` (botón de
  exportar).
