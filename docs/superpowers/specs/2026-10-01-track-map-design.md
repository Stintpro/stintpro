# Track Map — pestaña 🗺️ Pista (diseño)

Fecha: 2026-10-01 · Estado: aprobado por el usuario, pendiente de plan de implementación.

## Objetivo

Ver la carrera **en pista**: dónde está cada kart, quién va justo delante y detrás de
mi kart (en pista, no en clasificación) y quién está en box y cuándo sale.

Inspiración: el Track Map de LevelAp Pit Watcher (análisis en la memoria del
competidor). Les superamos en tres puntos: trazado y perfil de velocidad **medidos
por GPS** (ellos: un solo circuito dibujado a mano + modelo físico), duración de
parada **medida** (ellos: escrita a mano) y offset de túnel por circuito.

### Alcance v1

- Todos los karts en pista.
- Mi kart destacado + huecos en pista con el de delante y el de detrás.
- Karts en box con cuenta atrás de salida.

### Fuera de alcance (v2+)

- "Si paro ahora" (fantasma en la salida + tráfico al reincorporarse).
- Color por clase / por ritmo; marcar trenes de rebufo.
- Corrección a media vuelta con sectores en vivo (`s1/s2/s3` ya están en el estado;
  el formato y el motor quedan preparados, no se usan en v1).
- **Enfoque B:** subir el GPS desde el admin y guardarlo en Supabase por circuito.
  El formato JSON de este documento es el que B debe reutilizar sin cambios.

## Piezas

| Pieza | Tipo | Responsabilidad |
|---|---|---|
| `tools/track-from-gps.js` | Node, manual | GPS → `src/tracks/<slug>.json` |
| `src/tracks/<slug>.json` | datos | trazado, meta, box, perfil de tiempo por sentido |
| `src/en-track-pos.js` | lógica pura (browser + Node, patrón `en-traffic.js`) | estado + reloj → posiciones, huecos, box |
| `src/en-track.js` | UI | pestaña 🗺️ Pista en `en-grid.js`, SVG |

### 1. Herramienta `tools/track-from-gps.js`

- Entrada: CSV de RaceChrono, CSV de RaceBox o VBO de Dragy (los mismos dialectos que
  ya resuelve Track Engineer; reutilizar su lógica de parseo y de detección de vueltas
  como referencia, sin acoplar los repos).
- Elige la **vuelta limpia más rápida** (o la indicada con `--lap N`).
- Remuestrea el trazado por distancia a ~400 puntos, proyecta lat/lon a metros
  (equirectangular local) y normaliza a un viewBox 1000×N conservando la proporción.
- Perfil de tiempo: para cada punto, la fracción de tiempo de vuelta acumulada
  (monótona 0→1) frente a la fracción de distancia.
- Box: con `--pit-lap N` (vuelta que pasa por box) deriva la entrada y salida
  (fracciones de distancia donde la traza se separa y se reúne con la de pista)
  y la geometría del pit lane. Sin vuelta de box: `--pit-in F --pit-out F` a mano.
  **v1 (ajuste 2026-10-01): solo `--pit-in/--pit-out` a mano**, eligiéndolos sobre una
  vista previa SVG numerada que genera la herramienta; derivar de `--pit-lap` queda
  para v2. El pit lane se dibuja paralelo a la pista entre esas dos fracciones.
- `--direction normal|inverso`: sentido en que se grabó la vuelta. **v1: un fichero
  por grabación**; añadir el segundo sentido a un fichero existente queda para v2.
- Dragy: se convierte antes con `tools/dragy_to_csv.py` de Track Engineer (sale en
  formato RaceBox); la herramienta lee CSV de RaceBox y de RaceChrono.
- El fichero NO guarda lat/lon: solo la geometría normalizada.

### 2. Formato `src/tracks/<slug>.json`

```json
// ejemplo ilustrativo: los valores reales los genera la herramienta
{
  "version": 1,
  "slug": "henakart",
  "name": "Henakart (Torrejón)",
  "lengthM": 1100,
  "viewBox": { "w": 1000, "h": 640 },
  "widthUnits": 14,
  "points": [[x, y], ...],
  "pitLane": { "points": [[x, y], ...], "inFrac": 0.93, "outFrac": 0.04 },
  "profiles": {
    "normal":  { "timeFrac": [0, 0.004, ...], "source": "racechrono 2026-07-22 V3 1:02.341" },
    "inverso": null
  }
}
```

- `points` y `timeFrac` tienen la misma longitud; `timeFrac[i]` es la fracción de
  tiempo de vuelta al llegar al punto `i` (la distancia es uniforme por el remuestreo).
- `points[0]` es la meta; el orden es el del sentido `normal`.
- Sentido sin perfil propio: se invierte el trazado y se usa el perfil del otro sentido
  espejado (aproximado). La UI lo indica.

### 3. Motor `src/en-track-pos.js` (lógica pura)

API: `createTrackPos()` → `{ update(state, nowMs), positions(nowMs), gapsFor(dorsal), pitList(nowMs) }`;
helpers puros exportados para tests: `pointAt(track, timeFrac)`, `ovalTrack()`.

- **Ritmo de referencia por kart:** mediana de sus últimas 5 vueltas limpias
  (sin vuelta de salida de box, sin vueltas > 1,5× su mediana). Sin historial:
  mediana de la pista.
- **Fracción de vuelta:** `(now − lastLapAt) / ritmo`, **topada a 0,98** si se pasa
  (espera en la meta; no da vueltas fantasma).
- **Paso por meta real:** cuando cambia `lastLapAt`, el kart se desliza a la meta
  en ~0,4 s (sin salto).
- **Box:** con `pit` activo, aparcado en el pit lane con "Sale en m:ss" =
  duración esperada − `pitS`. Duración esperada: mediana de las duraciones reales de
  parada del circuito en la sesión (`lastPitDuration`, crono oficial de Apex), con
  la duración de parada configurada en Estrategia como respaldo. Si se pasa: "+m:ss" en rojo.
- **Salida de box:** se guarda el instante en que `pit` pasa a falso; el kart arranca
  en `pitLane.outFrac` y avanza a su ritmo, sumando el offset de túnel de
  `circuits.js` hasta su siguiente paso por meta.
- **Sin datos:** > 3 vueltas de ritmo sin pase → congelado y atenuado.
- **Huecos de mi kart:** primer kart con fracción mayor (delante) y menor (detrás),
  con la diferencia cruzando meta correctamente, en segundos con mi ritmo. Se excluyen
  los karts en box y los karts sin datos.
- **Sin fichero de circuito** o fichero inválido → `ovalTrack()` (perfil lineal).

### 4. UI `src/en-track.js` — pestaña 🗺️ Pista

- Nueva pestaña en `en-grid.js` junto a 🌊 Olas.
- Composición: iPad horizontal con el mapa a la izquierda y la columna "En box" a la
  derecha; en móvil, apilado.
- SVG: trazado con estética de cristal, meta a cuadros, pit lane con "PIT IN" y
  "PIT OUT", flecha de sentido.
- Dorsales: chip oscuro como en la clasificación; **mi kart ámbar `#F5A623`, mayor y con
  halo**; los karts sin datos atenuados.
- Tira de huecos sobre el mapa: `▲ #12 Equipo +1,8 s · MI KART · ▼ #7 Equipo −3,4 s`.
- Columna "En box": dorsal, equipo, tiempo parado, "Sale en m:ss"; ordenada por
  salida más próxima.
- Etiqueta honesta: "Trazado genérico · posición aproximada" (óvalo) o
  "Trazado GPS · error medio ±x s". **Ajuste 2026-10-01:** el error se mide EN VIVO
  (en cada pase por meta, |previsto − real|, mediana de los últimos 200) → sale por
  circuito y con datos del día; con < 20 pases muestra "midiendo…".
- Duración esperada de parada = `EnBox.pitDuration` (la app ya la aprende del crono
  oficial de Apex salvo que el usuario la fije a mano).
- Tocar un kart → ficha mínima (última vuelta, ritmo).
- Rendimiento: solo con la pestaña visible; `requestAnimationFrame` (~10 Hz);
  el SVG se crea una vez y solo se mueven los `transform` de los dorsales (lección
  del destello reiniciado por `innerHTML`).
- Usar la skill frontend-design en la implementación (preferencia del usuario).

## Pruebas

- **TDD de `en-track-pos.js`** (`tests/track-pos.test.js`): fracción, tope 0,98,
  karts sin datos, box y salida, huecos que cruzan la meta, óvalo frente a perfil,
  deslizamiento en el pase.
- **Herramienta:** con los GPS reales (Cabanillas con el Dragy, Torrejón con RaceChrono
  y RaceBox): longitud cercana a la oficial, `timeFrac` monótono 0→1, bucle cerrado.
- **Validación con carrera real** (`tests/fixtures/traffic-2314.json`, 7H Los Santos):
  para cada pase por meta, error = |instante previsto − real|. Medido el 2026-10-01:
  **mediana 0,20 s · p90 0,66 s · p99 1,83 s** (8.090 pases). Umbrales del test:
  mediana ≤ 0,35 s y p90 ≤ 1,0 s.
- Verificación visual en el banco con el replay real (`tools/_replays/`).
- La pestaña no rompe con un fichero corrupto o ausente (prueba de caída al óvalo).

## Riesgos

- El GPS de un día y kart concretos no es el ritmo de todos: el perfil es de **forma**
  (dónde se va lento y dónde rápido), no absoluto; la escala la pone el ritmo de cada
  kart.
- Circuitos sin `lastLapAt` fiable (reconexiones): quedan sin datos, no se inventan.
- Henakart cambia de sentido a mitad de carrera: el sentido activo sale del toggle
  existente de `circuits.js`.
