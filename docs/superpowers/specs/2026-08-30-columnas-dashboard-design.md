# Columnas del dashboard: catálogo, selector manual y fin de los datos inventados

Fecha: 2026-08-30
Estado: diseño aprobado, pendiente de plan de implementación

## Problema

El dashboard de clasificación tiene 14 columnas fijas, cableadas en tres
sitios distintos: el `grid-template-columns` de `src/en-state.js:154` (y su
gemelo de `:160`, más la media query de `:167`), la cabecera `_enTheadHtml()`
y la fila `_enRenderRow()` de `src/en-grid.js`.

De esas 14, ocho pintan un dato de Apex tal cual (`rk`, `no`, `dr`, `lc`/`tlp`,
`llp`, `blp`, `gap`, `int`), cuatro las calculamos nosotros (Equipo, M5v,
Δ Pista, Score) y dos son mixtas: el punto de estado y el contador de paradas
los derivamos nosotros, pero de columnas que tiene que mandar Apex (`grp`/`sta`
y `pit`). Esa distinción importa: el agrupado del panel (`source`) va por quién
calcula el valor, y la disponibilidad (`requires`) por qué necesita de Apex.

Esto produce dos defectos:

1. **Datos inventados.** Cuando Apex no manda una columna, el dashboard
   rellena el hueco en vez de callarse. El caso confirmado en carrera real es
   Vueltas: en `src/apex-protocol.js:645`,

   ```js
   tours: (k.tours || 0) > 0 ? k.tours : (k.lapHistory || []).length
   ```

   Sin la columna oficial de Apex se muestran las vueltas que *nosotros* hemos
   contado desde que conectamos. Si te enganchas en el minuto 40, la tabla dice
   12 cuando llevan 87. No es un error de cálculo: es un fallback que rellena.

2. **Rigidez.** Apex manda cosas que nunca pintamos (la categoría/cilindrada,
   entre otras) y pintamos columnas que en algunos circuitos no aportan nada.
   El usuario no puede decidir qué ve.

## Decisiones tomadas

| Decisión | Elegido |
|---|---|
| Alcance | Selector manual de columnas |
| Reordenar | No: solo mostrar/ocultar |
| Persistencia | Global, en `localStorage`, por dispositivo |
| Columnas nuevas en catálogo | Solo Clase/categoría (fuera sectores S1-3, `otr`, nacionalidad) |
| Vueltas sin columna oficial | Ocultar la columna entera |
| Pantalla estrecha | Una sola selección; anchos reducidos y scroll horizontal si no cabe |
| Columnas fijas | Pos, Kart y Piloto no se pueden desmarcar |

Descartado explícitamente:

- **Persistencia por circuito.** El motivo real por el que las columnas
  cambian entre circuitos no es el gusto del usuario, es qué manda Apex, y eso
  ya lo cubre la regla de disponibilidad. Quedarían 18 configuraciones
  envejeciendo en silencio y un circuito nuevo arrancando sin configurar.
- **Persistencia en Supabase.** `supabase/schema.sql:17` deja `profiles` con
  RLS y sin política de UPDATE para el cliente, a propósito: se escribe solo
  con service role vía Vercel Function. Guardar ahí una preferencia visual
  obliga a reabrir el bloque de seguridad y, además, a implementar igualmente
  el fallback local para el caso sin red.
- **Reordenar columnas.** Drag & drop, persistencia del orden y superficie de
  bugs a cambio de poco.

## Arquitectura

### 1. `colMap` llega hasta la UI

El parser ya publica `colMap` (qué `dtype` de Apex vive en cada columna) en
`getState()`, `src/apex-protocol.js:655`. El logger lo reenvía intacto en los
dos mensajes que le importan a la app, porque ambos hacen `...state`:
el `history` inicial (`stintpro-logger/circuit-monitor.js:753`) y cada `live`
(`:564`).

Lo único que falta: `src/en-strategy.js:1102` copia el snapshot campo a campo y
se deja `colMap` fuera. Se añade `EnSession.data.colMap = data.colMap || {}`.

**No hay que tocar el VPS para esta feature.**

### 2. Registro de columnas: `src/en-columns.js` (módulo nuevo)

Una lista ordenada de definiciones, una por columna:

```js
{
  id:        'tours',
  label:     'Vtas',
  width:     '44px',      // ≥900px
  widthNarrow: '30px',    // ≤900px
  align:     'right',
  fixed:     false,       // true → no se puede desmarcar
  source:    'apex',      // 'apex' | 'stintpro' → agrupa el panel
  requires:  cm => !!(cm.lc || cm.tlp),   // null si siempre disponible
  render:    (e, d) => `...`,             // devuelve el HTML de la celda
}
```

15 entradas: las 14 actuales más Clase.

`requires` por columna (las de StintPro llevan `null`):

| id | label | requires |
|---|---|---|
| `dot` | — | null (ver nota) |
| `pos` | Pos | `rk` |
| `kart` | Kart | `no` |
| `driver` | Piloto | `dr` |
| `team` | Equipo | null |
| `tours` | Vtas | `lc \|\| tlp` |
| `last` | Última | `llp` |
| `best` | Mejor | `blp` |
| `m5v` | M5v | null |
| `delta` | Δ Pista | null |
| `gap` | Gap | `gap` |
| `int` | Int | `int` |
| `score` | Score | null |
| `pit` | Pit | `pit` |
| `class` | Clase | `class` |

`dot`, `pos`, `kart` y `driver` van marcadas como `fixed`.

Nota sobre `dot`: aunque el color sale sobre todo de `grp`/`sta`, el parser
también deduce el estado sin esa columna, a partir de los códigos sueltos y de
la secuencia `si`→`so` (`src/apex-protocol.js:208`). Por eso su `requires` es
`null`: sin `grp`/`sta` el punto sigue distinguiendo el pit, y además es una
columna fija — hacerla desaparecer descuadraría la rejilla por un dato
secundario.

### 3. Cabecera y fila generadas desde el registro

- `_enTheadHtml()` pasa de HTML cableado a recorrer las columnas visibles.
- `_enRenderRow()` igual: itera y llama al `render` de cada definición.
- `_enDeriveRow()` **no se toca**. Todos los cálculos derivados (colores,
  M5v, tendencia, calidad, gap, badges) siguen exactamente igual; lo único que
  cambia es quién pinta y en qué orden. Los `render` reciben `(e, d)` como hoy.
- El `grid-template-columns` deja de vivir en las dos reglas fijas de
  `src/en-state.js:154` y `:160` y en la media query de `:167`. Se genera en
  runtime desde los anchos del registro y se inyecta en un `<style>` propio
  que se reescribe cuando cambia la selección o la disponibilidad.
- La cabecera hoy solo se re-renderiza al cambiar el orden
  (`_enToggleSort`, `src/en-grid.js:637`). Tendrá que re-renderizarse también
  cuando cambie `colMap` — es decir, al cambiar de sesión o de circuito.

### 4. Regla de visibilidad

```
visible = seleccionada por el usuario  ∧  disponible en esta sesión
```

Disponible = `requires === null` o `requires(colMap)` es cierto.

Consecuencia directa: sin `lc` ni `tlp`, Vueltas desaparece. No hay celda que
rellenar, así que no hay nada que inventar.

### 5. Vueltas: arreglar la UI sin romper la estrategia

`tours` no alimenta solo la celda. De él dependen las vueltas del stint
(`src/en-state.js:257`), la estrategia y la ventana de paradas. Vaciarlo
rompería esas tres cosas.

Por eso **el fallback de `apex-protocol.js:645` se queda como está**. Por dentro
seguimos contando; lo que cambia es que la columna solo se pinta cuando el dato
es oficial.

Y no hace falta ninguna bandera nueva para saberlo: `k.tours` únicamente se
rellena desde los `dtype` `tlp`/`lc` (`src/apex-protocol.js:398`), así que
`colMap.lc || colMap.tlp` es exactamente equivalente a "el número es oficial".

Esto importa más de lo que parece: una bandera en el snapshot habría que
calcularla también en el parser del logger, y eso obliga a desplegar el VPS.
Usando `colMap` —que el logger ya reenvía— **la feature entera se queda en el
cliente**.

Riesgo asociado: `colMap` se vacía en el `_reset()` del parser, y una
reconexión a mitad de carrera dejaría la columna desaparecida hasta que Apex
reenvíe el grid. Para evitar ese parpadeo, la disponibilidad se calcula sobre
la **unión de los `colMap` vistos en la sesión** (`EnSession.colMapSeen`), que
se limpia solo al empezar sesión nueva.

### 6. Panel de selección

- Botón en la cabecera de la pestaña Clasificación.
- Casillas agrupadas en **De Apex** y **De StintPro** (campo `source`).
- Las columnas no disponibles salen deshabilitadas y con el motivo visible
  ("este circuito no la manda"), para que la ausencia no parezca un bug.
- Las `fixed` salen marcadas y deshabilitadas.
- Persistencia: `localStorage`, clave global, con versión:

  ```json
  { "v": 1, "cols": ["pos", "kart", "driver", "tours", "..."] }
  ```

  La versión permite migrar cuando el catálogo cambie sin dejar al usuario con
  una tabla vacía. Migración por defecto: los ids desconocidos se descartan y
  las columnas nuevas del catálogo entran visibles.

### 7. Clase/categoría

El parser **del logger** ya resuelve esto: detecta la columna
(`stintpro-logger/apex-parser.js:66`, por `dtype === 'class'` o por cabecera) y
publica `category` por kart (`stintpro-logger/apex-protocol.js:665`). En modo
logger la columna es casi gratis.

El parser **de la app** (`src/apex-protocol.js`) no tiene `catCol`: las dos
copias han divergido. Hay que portar la detección de columna y el
`_applyCell` correspondiente (~10 líneas) para que el modo directo funcione
igual.

No se unifican los dos parsers en este trabajo. Se porta lo mínimo y se deja
constancia de la divergencia.

### 8. Ancho y scroll

El contenedor de la tabla pasa a `overflow-x: auto` con `min-width` calculado
como la suma de los anchos visibles. En ≤900px se usan los `widthNarrow` del
registro, sustituyendo a la media query cableada. Si la selección no cabe, hay
scroll horizontal; el usuario decide qué quitar.

## Testing

Sobre la suite existente (222 tests verdes):

- Disponibilidad derivada de `colMap`, incluyendo `lc` y `tlp` como
  alternativas para Vueltas.
- La regla `seleccionada ∧ disponible`, en sus cuatro combinaciones.
- Sin `lc` ni `tlp`, la cabecera no contiene "Vtas" y la fila no tiene celda de
  vueltas — el caso del bug original.
- Con el fallback en juego (sin `lc` ni `tlp`), las vueltas del stint
  (`en-state.js:257`) siguen funcionando aunque la columna no se pinte.
- `colMapSeen` es la unión de los `colMap` de la sesión: una reconexión con
  `colMap` vacío no hace desaparecer columnas.
- Persistencia: guardar, releer, y migrar desde una versión con ids que ya no
  existen.
- El `grid-template-columns` generado tiene tantos tramos como columnas
  visibles.

## Riesgos

- **Los dos parsers divergen.** La categoría es la prueba. Portar a mano
  arregla este caso y no el patrón; queda como deuda anotada.
- **Cabecera y fila deben ir siempre en el mismo orden.** Al generarse ambas
  del mismo array el riesgo baja, pero un `render` que devuelva dos elementos
  o ninguno descuadra la rejilla en silencio. Los tests del punto anterior
  cubren el recuento.
- **Regresión visual.** Con la selección por defecto (las 14 de hoy) la tabla
  debe quedar idéntica. Es la primera comprobación antes de tocar nada más.

## Reversión

Requisito explícito del usuario: si en carrera real esto no funciona bien, se
vuelve a las columnas fijas de hoy.

Cómo se garantiza:

- Todo el trabajo va en una rama (`feat/columnas-dashboard`). `main` conserva
  el comportamiento actual hasta que la feature se valide en una carrera real,
  y hasta ese momento volver atrás es no fusionar.
- El fallback de `tours` (`src/apex-protocol.js:645`) **no se toca**. Nada del
  resto de la app pierde su fuente de datos, así que revertir la UI no arrastra
  a la estrategia.
- No se despliega nada al VPS: todo el cambio vive en el cliente.
- `_enDeriveRow()` no se toca. La reversión afecta a cómo se pinta, nunca a
  qué se calcula.
- La selección por defecto reproduce exactamente las 14 columnas actuales. Si
  el selector nunca se usa, la tabla es la de hoy.

## Fuera de alcance

- Reordenar columnas.
- Sectores S1/S2/S3, `otr` como columna y nacionalidad. Antes de los sectores
  habría que auditar en los raw logs del VPS que llegan con valor, igual que se
  hizo con la meteo (que resultó estar vacía).
- Sincronizar la preferencia entre dispositivos.
- Unificar `src/apex-protocol.js` con `stintpro-logger/apex-protocol.js`.
