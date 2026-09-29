# Rebufo en vivo (tráfico por vuelta) — diseño

Fecha: 2026-09-29 · Origen: idea del chunk `rebufo` de LevelAp Pit Watcher, validada con datos propios.

## Objetivo

En vivo, etiquetar cada vuelta de cada kart como **en tren** (rebufo), **bloqueada** o **limpia**, y:

1. **Corregir**: excluir las vueltas en tren/bloqueadas de la calidad automática del kart y de la media de pista.
2. **Enseñar**: glifo junto a la última vuelta + tooltip, y "Rebufo hoy" (cuánto regala ir en tren en esta sesión).

## Evidencia (spike 2026-09-29, 7 carreras reales del logger, solo lectura)

Δ = vuelta − mediana del piloto en ese stint. Hueco = tiempo desde que cruzó meta el kart inmediatamente delante EN PISTA.

| Situación | n | Δ mediana |
|---|---|---|
| Tren sostenido (mismo kart delante, 0,2–1,2 s al empezar y al acabar) | 5069 | −0,10 s |
| En solitario (>4 s libres) | 4461 | 0,00 s |
| Alcanza y queda bloqueado (>1,5 s → <0,6 s) | 1546 | +0,22 s |

Consistente en las 7 carreras (tren −0,07 a −0,35 s; mayor en pistas largas). Un 5 % de cruces llegan casi a la vez (<0,02 s, mismo mensaje Apex) → artefacto. Limitación: observacional; el Δ de tren mezcla rebufo y "apretar en la pelea".

## Arquitectura

### Motor puro `src/en-traffic.js` (IIFE dual navegador/CommonJS, como `en-pit-windows.js`)

No toca `lapHistory` (lo escriben 4 sitios). Mantiene su propio estado por dorsal.

- `createTraffic(opts?)` → instancia; `window.EnTraffic` = instancia global.
- `onCrossing(dorsal, lapMs, ts)`:
  - `ahead` = último cruce de OTRO dorsal con `ts' ≤ ts` (el de delante en pista, no en clasificación).
  - `gapEnd = (ts − ahead.ts)/1000`; `gapStart`/`aheadStart` = los guardados en el cruce anterior de este dorsal.
  - Etiqueta:
    - `train`: `aheadStart === ahead.dorsal` y `gapStart, gapEnd ∈ [0,2 ; 1,2]`.
    - `blocked`: `gapStart > 1,5` y `gapEnd ∈ [0,2 ; 0,6)`.
    - `clean`: resto. Hueco `< 0,2` = artefacto → nunca `train`/`blocked`.
    - Sin cruce previo del dorsal (1ª vuelta o tras reset) → `clean` (sin info de inicio).
  - Guarda `{lapMs, ts, tag, aheadDorsal, gapStart, gapEnd}` (buffer por dorsal, tope 60) y lo añade al muestreo del regalo.
- `tagOf(dorsal, lapMs)` → registro cuyo `lapMs` coincide ±1 ms (el más reciente), o `null`.
- `isTraffic(dorsal, lapSec)` → `train|blocked` para el tiempo en segundos de `lapHistory`.
- `giftToday()` → `{giftSec, nTrain, nClean}`; `giftSec = mediana(Δ train) − mediana(Δ clean)`, con Δ = vuelta − mediana móvil de las últimas 15 vueltas del mismo dorsal (entre 0,92× y 1,08× de esa mediana). `giftSec = null` hasta `nTrain ≥ 100 && nClean ≥ 100`.
- `reset()` en nueva sesión.

Umbrales como constantes exportadas (`GAP_MIN=0.2, TRAIN_MAX=1.2, BLOCK_FROM=1.5, BLOCK_TO=0.6, MIN_GIFT_N=100`).

### Enganche

- `apex-connector.js`: callback `onLap(dorsal, …, lapMs, n, ts)` del parser → `EnTraffic.onCrossing(dorsal, lapMs, Date.now())`; `onNewSession` → `EnTraffic.reset()`.
- `replay-connector.js`: igual, pero `ts` = tiempo del log (`entry.t` de la línea en curso), no reloj de pared (a velocidad ×N los huecos se encogerían N veces). `reset()` al cargar/reiniciar el replay y en nueva sesión.
- `index.html`: cargar `en-traffic.js` antes de los conectores y de `en-state.js`.

### Corrección

- Helper `_enTrafficFilter(dorsal, laps)` en `en-state.js`: quita las vueltas con `isTraffic`; **si quedan < 3 devuelve `laps` intacto** (red de seguridad).
- `_enAutoKartQuality`: aplica el filtro a `stintLaps` antes de `_enCleanLaps`. La clave de caché (`evalKey`) no cambia: el etiquetado ocurre en el mismo cruce que añade la vuelta.
- `_enTrackAvgLive`: usa el `lapHistory` filtrado para su `_enAvg5`.
- No se tocan tendencia, consistencia, M5 mostrada, mejor vuelta ni tiempos oficiales.

### Visual

- Celda "Última" (`en-grid.js`): tras el tiempo, glifo gris tenue `≋` (train) o `▮` (blocked) si la última vuelta está etiquetada. No cambia el color existente (morado/verde/ámbar/rojo).
- Tooltip (`title`):
  - `≋`: "En tren tras #9 a 0,4 s · Rebufo hoy: −0,21 s/vuelta · Vuelta limpia est.: ~1:06.42 (fuera de calidad y media)". Sin regalo aún → "Rebufo hoy: midiendo…" y sin vuelta estimada. La coletilla "(fuera de calidad y media)" solo si la red de seguridad no la reincorporó.
  - `▮`: "Bloqueado: alcanzó a #9 (de 2,1 s a 0,3 s) (fuera de calidad y media)".
  - Tiempos en formato m:ss.sss.
- Popup de Media pista: línea "Rebufo hoy: −0,21 s/vuelta (n tren / n limpias)" o "midiendo…".

## Tests (TDD) — `tests/traffic.test.js`

- Reglas: tren, bloqueo, limpia, artefacto <0,2 s, cambio de kart delante (no es tren), 1ª vuelta.
- `isTraffic` empareja por valor; `reset` limpia.
- `giftToday`: puerta de 100/100 y signo correcto con datos sintéticos.
- Filtro de calidad: excluye etiquetadas; con <3 limpias usa todas.
- Integración: fixture recortado de una carrera real (7H Los Santos, sesión 2314) → regalo entre −0,15 y −0,05 s.

## Fuera de alcance

Chip de estado "ahora en tren"; histórico/Score de pilotos; medir cuánto pierde un bloqueo; logger.

## Despliegue

Solo cliente (Vercel vía push a main), **con confirmación explícita del usuario** antes de push.
