# Riesgo de lluvia en el panel (Open-Meteo) — diseño

Fecha: 2026-10-26 · Aprobado por el usuario en conversación el mismo día.

## Objetivo

Avisar en el panel en vivo de que viene lluvia **antes** de que los tiempos la delaten, para decidir con margen (adelantar o retrasar una parada, elegir piloto). Caso real que lo motiva: 2H de Ariza del 2026-10-04, la lluvia subió los tiempos desde el min ~28 y la carrera se suspendió en el min 52.

Fuera de alcance (entregas posteriores): guardar la meteo por sesión en el logger; aflojar los umbrales de calidad de kart con lluvia; sonido.

## Decisiones tomadas

- **Fuente: Open-Meteo** (`api.open-meteo.com/v1/forecast`, sin clave, uso no comercial). Apex no sirve (`wth1-3` llegan vacías). AEMET descartada (clave + salidas de modelo no abiertas).
- **Precisión medida 2026-10-25:** zona de Madrid → AROME HD de Météo-France ~1,5 km; sur, Portugal y Canarias → ECMWF/ICON-EU ~7-9 km. La lluvia de chubasco puede fallar por km y 30-60 min → se muestra como **riesgo en una ventana**, nunca como minuto exacto.
- **Ubicación:** una línea extra en el KPI **Media pista**, solo cuando hay algo que decir. Con seco no aparece nada. Sin sonido (el roadmap reserva el sonido para 2 eventos).
- **Todos los circuitos son al aire libre** (confirmado por el usuario) → no hay marca de "cubierto".
- **Coordenadas en el código**, no en Supabase.

## Arquitectura

### 1. Coordenadas — `src/circuits.js`

- Nueva tabla `window.CircuitDB.coords = { '<slug>': [lat, lon], … }`, junto a `knownOffsets` y `trackAliases`.
- `window.CircuitDB.coordsOf(slug)` → `coords[slug] || coords[trackSlug(slug)] || null`. Así `cronosystem2` hereda las de Campillos por el alias existente.
- `loadFromSupabase()` no cambia: las coordenadas se buscan por slug, no viajan en el objeto del circuito.
- Valores iniciales: ubicación pública de cada circuito del catálogo (los 14), que el usuario confirma antes de fijarlos.
- `tools/track-from-gps.js` imprime además el centroide `lat, lon` de la vuelta usada, para los circuitos nuevos.

### 2. Motor `src/en-weather.js` (IIFE dual navegador/CommonJS, como `en-pit-windows.js`)

Puro y testeable; la red va aparte.

- `buildUrl(lat, lon)` → `…/v1/forecast?latitude=…&longitude=…&minutely_15=precipitation&hourly=precipitation_probability&forecast_hours=3&past_minutely_15=1&timezone=UTC`.
- `rainRisk(data, nowMs)` → `{ level, etaMin, slots, probNextHour }`:
  - `slots`: tramos de 15 min desde el que contiene `nowMs` hasta +60 min, `{ t, mm }`.
  - `level`:
    - `'raining'` si el tramo actual trae ≥ 0,1 mm.
    - `'high'` si algún tramo que empieza en los próximos 30 min trae ≥ 0,2 mm, o `probNextHour` ≥ 60.
    - `'medium'` si algún tramo entre 30 y 60 min trae ≥ 0,2 mm, o `probNextHour` entre 30 y 59.
    - `null` en otro caso.
  - `etaMin`: minutos hasta el primer tramo ≥ 0,1 mm (redondeado a 5), o `null`.
  - `probNextHour`: probabilidad horaria de la hora que contiene `nowMs`.
  - Datos malformados o vacíos → `{ level: null, … }` sin lanzar.
- `rainByLapTimes(history, nowMs, trackAvgS)` → `{ rising: bool, deltaS }`: misma regla que hoy usa `en-ai-alerts.js` (media de pista sube > 1,5 s frente a una muestra de hace 9-15 min). `history` = `[{ts, avg}]`, lo mantiene quien llama.
- Umbrales como constantes al principio del fichero (`MM_RAIN_NOW = 0.1`, `MM_RISK = 0.2`, `PROB_HIGH = 60`, `PROB_MED = 30`).

### 3. Sondeo y estado — también en `src/en-weather.js` (parte navegador)

- `EnWeather.start(slug)` / `stop()`. Arranca con el dashboard endurance si `coordsOf(slug)` existe y la conexión es en directo (`window.ApexConnector !== window.ReplayConnector`); en repetición y banco no consulta.
- Consulta al arrancar y cada **10 min**; timeout 10 s; un error no reintenta antes del siguiente ciclo.
- Estado: `{ data, fetchedAt, error }`. `EnWeather.current(nowMs)` devuelve `rainRisk(...)` + `stale` (sin datos buenos en > 30 min).
- `en-ai-alerts.js` pasa a usar `rainByLapTimes` para su alerta de lluvia (mismo comportamiento), en vez de su copia de la lógica.

### 4. Pintado — `src/en-grid.js`, KPI Media pista

`_enKpisHtml` añade una línea bajo "click para filtrar equipos" a partir de `EnWeather.current()` y de `rainByLapTimes` (con su propio histórico, independiente del interruptor de alertas de IA):

| Situación | Línea |
|---|---|
| `level = null` y sin subida de tiempos | (nada) |
| `medium` | `🌦 Riesgo medio · 30-60 min` |
| `high` | `🌧 Riesgo alto · ~20 min` (usa `etaMin`; sin `etaMin` → `· próx. 30 min`) |
| `raining` | `🌧 Lloviendo` |
| subida de tiempos (con o sin previsión) | `🌧 Lloviendo · tiempos +1,8 s` |
| `stale` (había coordenadas pero no hay datos buenos en 30 min) | `meteo sin datos`, en gris |

- Colores: medio ámbar, alto y lloviendo azul lluvia, sin datos gris.
- `title` (tooltip): mm por tramo de 15 min, probabilidad de la hora, hora de la última actualización y "Open-Meteo, ~1,5-9 km".
- El clic del KPI sigue abriendo el filtro de media (no cambia).

### 5. Seguridad

- `vercel.json`: añadir `https://api.open-meteo.com` a `connect-src` de la CSP.
- Solo se envían las coordenadas del circuito; ningún dato del usuario.

## Pruebas

- `tests/weather.test.js` (estilo de `tests/*.test.js`, `node tests/weather.test.js`): `rainRisk` con casos fijos — seco; lluvia en 20 min; lluvia a 45 min; lloviendo ahora; solo probabilidad alta; solo probabilidad media; datos vacíos/malformados; `etaMin` redondeado. `rainByLapTimes`: sin muestra de 9 min, subida 1,2 s (no), subida 1,8 s (sí). `coordsOf` con alias.
- **Validación con un caso real:** pedir a la API de previsiones históricas de Open-Meteo (`historical-forecast-api.open-meteo.com`) lo que daba el modelo en Ariza el 2026-10-04 entre 16:00 y 18:00 locales, pasarlo por `rainRisk` cada 10 min y comprobar en qué minuto habría salido "riesgo alto" frente al inicio real de la subida de tiempos (~min 28, 17:32). Si no avisa antes, ajustar umbrales y documentarlo aquí. Si esa API no devuelve `minutely_15` para la fecha, repartir la `precipitation` horaria en 4 tramos iguales y anotarlo como limitación de la validación.
- Navegador: panel con conexión en directo a un circuito con coordenadas → línea correcta según el estado; sin red → "meteo sin datos" tras 30 min; repetición → no consulta (sin peticiones a open-meteo en la pestaña de red).

**Resultado de la validación (2026-10-26):** con la previsión histórica de Open-Meteo para Ariza el 2026-10-04 (15 min: 0,1 mm de 17:15 a 18:00; probabilidad 28 % a las 16 h y 35 % a las 17 h) y los umbrales de esta spec, el panel habría mostrado «Riesgo medio» desde las 17:00 y «Lloviendo» desde las 17:15; la subida de tiempos empezó hacia las 17:32 → ~30 min de margen. Con `MM_RISK = 0.1` habría salido «Riesgo alto · ~30 min» ya a las 16:45. Se mantienen los umbrales de la spec salvo que el usuario decida bajar `MM_RISK`. Límite: la API histórica junta los primeros pasos de cada pasada del modelo; no es exactamente lo que se veía en vivo.

## Riesgos y límites

- Chubascos: el aviso puede llegar tarde o no llegar; por eso existe la confirmación por tiempos.
- Resolución de 7-9 km fuera de la zona de AROME.
- Si Open-Meteo cambia o limita su API gratuita, el panel muestra "meteo sin datos" y nada más se rompe.
- La confirmación por tiempos se suprime con bandera amarilla/roja o carrera parada y ~9-15 min después (el historial se vacía y necesita ≥ 9 min de base), y se reinicia al cambiar el filtro de la media (dorsales/categorías excluidos). La previsión no se suprime.
