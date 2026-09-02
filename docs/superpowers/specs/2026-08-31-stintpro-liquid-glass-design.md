# StintPro · estética de cristal — diseño

Fecha: 2026-08-31 · Estado: aprobado en brainstorming, pendiente de plan de implementación

Llevar a StintPro el mismo cambio de material que Track Engineer cerró el 2026-08-21: el
**chrome** de la interfaz pasa a cristal ahumado translúcido sobre una capa de profundidad;
la **zona de datos sigue mate**. No se toca tipografía, escala, espaciado ni disposición.
Es un cambio de material, no un rediseño.

Referencia obligada antes de tocar nada: `~/track-engineer/ESTETICA-CRISTAL.md`, y el
material en `~/track-engineer/frontend/src/styles/glass.module.css`.

---

## 1. Alcance

**Dentro:** `src/index.html` — la pantalla de configuración (`#screen-setup`) y el panel de
carrera (`#screen-dash`), en sus **dos modos**: endurance (`en-grid.js`) y sprint
(`sprint.js`).

**Fuera, para una fase 2:** `landing.html`, `hub.html`, `profile.html`, `logger-stats.html`,
`report.html`, `admin.html`. Cada una tiene su propio CSS y no comparten el sistema con la
app en vivo.

## 2. Lo que se encontró al inventariar (y que cambia el trabajo)

Tres hallazgos del análisis previo. Sin ellos, el plan obvio —"aplicar el material a los
selectores de `styles.css`"— no habría pintado nada.

**2.1 · Media `styles.css` es CSS muerto.** `.perf-cell`, `.timing-table`, `.ola-block`,
`.box-block`, `.stop-light`, `.dash-topbar`, `.dash-nav`, `.dash-content`, `.modal-box`,
`.dialog-box`, `.dcard`… no las usa nadie: son ~90 reglas de una versión anterior del panel.
Verificado por búsqueda de cada nombre en todos los `.js` y `.html`. **Decisión: se borran en
esta entrega**, comprobando una por una antes de quitarla.

**2.2 · El panel real se pinta desde JS.** Lo generan `en-grid.js` y `sprint.js` con clases
`sp-*` / `en-*`, y sus estilos son dos bloques `<style>` inyectados —111 líneas en
`en-state.js` y 53 en `sprint.js` (95 y 52 reglas CSS respectivamente, contadas con
`tools/css-extract.js`: descarta comentarios y cuenta el bloque `@media (max-width:900px)`
como una sola regla)— **casi copia el uno del otro**: `.sp-topbar`,
`.sp-header`, `.sp-clock`, `.sp-session`, `.sp-wdot` son idénticos en ambos.

**2.3 · Ese CSS no usa los tokens.** 209 colores hex escritos a mano (`#0e0f11`, `#13141a`,
`#1e1f25`) contra 36 `var(--…)`. Consecuencia no vista hasta ahora: **el botón ☀ Contraste
hoy apenas afecta al panel de carrera** — solo cambia el texto que sí usa `var(--text-3)`;
los fondos no se enteran.

## 3. Arquitectura

Tres ficheros, y el orden de carga en `index.html` importa:

```
styles.css     (existente)  layout y tokens base; se le borra el CSS muerto
panel.css      (NUEVO)      el chrome compartido de en-state.js + sprint.js, tokenizado
glass.css      (NUEVO)      tokens del material, las clases del cristal, la profundidad
```

`glass.css` va **el último**. Es el único sitio donde se toca el vidrio: si el material
cambia, cambia ahí y en ningún otro fichero. Esa es la regla que hizo barato el mantenimiento
en Track Engineer y es la que justifica el fichero aparte.

`en-state.js` y `sprint.js` conservan sus bloques `<style>` **solo con lo específico de cada
modo** (`.en-kpis` a 5 columnas vs `.sp-kpis` a 4, la vista Equipo, la vista Estrategia, la
simulación de sprint).

**Cascada — cuidado al extraer.** Hoy los bloques inyectados se añaden al `<head>` en tiempo
de ejecución, así que quedan *después* de `styles.css` y le ganan por orden. Al pasar el
chrome compartido a `panel.css` como `<link>`, ese orden hay que reproducirlo a mano:
`styles.css` → `panel.css` → `glass.css`, y lo que siga inyectándose desde JS seguirá
ganando a los tres, que es lo que queremos para las reglas específicas de cada modo.

**El material no declara `border`.** Cada superficie quiere el suyo —solo el borde inferior
en `.sp-header`, los cuatro en `.sp-kpi`, solo el superior en `.sp-footer`— y si el material
también pusiera uno, competirían por la misma propiedad. El borde es cosa de cada
superficie, con `var(--glass-border)`. `background` y `box-shadow` sí los declara el
material: cualquier regla que necesite pisarlos sobre el mismo elemento tiene que ganar por
**especificidad**, nunca por orden.

## 4. El material

**Variante A: los mismos tokens que Track Engineer**, elegida sobre una comparativa de tres
materiales. Vidrio gris-azulado frío; el ámbar de StintPro aparece en la luz del fondo y en
el dato marcado, no en el vidrio. Las dos apps se leen como la misma familia.

```css
--glass-a: rgba(31, 36, 43, 0.50);   /* 45 % de rgba(68, 79, 96, …) — ver abajo */
--glass-b: rgba(12, 15, 20, 0.54);   /* 45 % de rgba(26, 33, 44, …) */
--glass-blur: 28px;
--glass-sat: 200%;
--glass-bright: 122%;
--glass-edge: rgba(255,255,255,0.34);      /* el canto especular */
--glass-edge-low: rgba(255,255,255,0.07);
--glass-border: rgba(255,255,255,0.19);
--glass-shadow: 0 16px 38px rgba(0,0,0,0.52);
```

(Corrección: el color base de las dos paradas del material NORMAL también está al 45 % del
original de Track Engineer, por el mismo motivo y con el mismo factor que el denso. Lo forzó
la revisión final: con la cabecera ya mate —ver §5— las baldosas `.sp-kpi` dejan el rojo de
alerta `#ef4444` en 3,49:1 con el base original y en 4,58:1 al 45 %. El resto de tokens —el
desenfoque, la saturación, el brillo, el canto y la sombra— siguen siendo los de Track
Engineer, así que la familia visual se mantiene. Las medidas están en el comentario de
`src/styles.css` junto a los tokens, y las vigila el barrido de literales de
`tests/contrast.test.js`.)

**La capa de profundidad** va **una sola vez**, en `#screen-dash` y en `#screen-setup`
(corrección: la versión anterior de este párrafo decía `.setup-root`, un selector que no
existe en `src/`, `tools/` ni `tests/` — la pantalla de configuración es `#screen-setup`, y
`tests/glass.test.js` congela la lista exacta `['#screen-dash', '#screen-setup']`): dos
manchas de luz radiales, fijas, sin animación. Es lo que el cristal recoge; sin ella el
material no se ve, porque un vidrio sobre un fondo plano es solo un gris distinto. Nunca
repetida por componente — así es como estas cosas acaban costando fotogramas.

```css
--depth-warm: rgba(245,166,35,0.11);   /* el ámbar de StintPro */
--depth-cool: rgba(120,170,255,0.10);
```

**Variante densa**, para lo que flota **sobre** la parrilla (el selector de columnas y las
cajas de modal — ver §5): velo más alto y sin la subida de `brightness` de la variante
normal, porque detrás hay filas de tiempos cambiando y el texto no puede depender de lo que
pase por debajo.

```css
--glass-denso-a:    rgba(22, 26, 32, 0.86);
--glass-denso-b:    rgba(7, 9, 13, 0.90);
--glass-denso-blur: var(--glass-blur);
```

El color base de las dos paradas está al 45 % del original a propósito: es lo que hace falta
para que el rojo de alerta `#ef4444` alcance el suelo de 4,5:1 sobre el material (el
comentario de `src/styles.css` junto a estos tokens trae las medidas — 3,26:1 con el base
original, 4,60:1 al 45 %). (Corrección: la palabra "denso" no aparecía en ninguna parte de
este spec, y §5 hablaba de un solo material — ver ahí.)

Lo que se lee como vidrio no es el desenfoque: es el canto especular de un píxel arriba y la
sombra proyectada. Si algún día hay que quitar algo por rendimiento, **se quita el desenfoque
antes que el canto**.

## 5. Qué superficies lo llevan

**Corrección: son dos materiales, no uno.** La versión anterior de esta sección los listaba
juntos bajo "Cristal (9)". El normal —`--glass-a`/`--glass-b`, con subida de `brightness`
(§4)— es el que lleva el chrome que no tapa datos en movimiento. El denso
—`--glass-denso-a`/`--glass-denso-b`, velo más alto y sin esa subida de brillo (§4)— es el
que llevan `.en-col-panel` y las cajas de modal, porque ambos flotan **sobre** la parrilla:
detrás hay 28 filas de tiempos cambiando varias veces por segundo y el texto no puede
depender de lo que pase por debajo.

**Cristal normal (6):**

| Superficie | Qué es |
|---|---|
| `.sp-kpi` | las celdas de indicador (5 en endurance, 4 en sprint) |
| `.sp-footer` | pie de banderas |
| `.en-team-card` | tarjetas de la vista Equipo |
| `.en-strat-card` | tarjetas de la vista Estrategia |
| `#screen-setup .card` | tarjetas de la pantalla de configuración |
| `.sp-glass` | clase genérica del normal, para cualquier caja futura sin selector propio — hoy ningún marcado la usa directamente |

**Cristal denso (2 selectores, 12 superficies):**

| Superficie | Qué es |
|---|---|
| `.en-col-panel` | selector de columnas, abierto sobre la parrilla |
| `.sp-modal` | **las 11 cajas de modal** (corrección: no son 14 — ver §6), con estilo inline en 5 ficheros (`app.js` 1, `en-advanced.js` 1, `en-grid.js` 3, `en-team.js` 5, `en-strategy.js` 1), ahora unificadas bajo `class="sp-modal"`. **La caja, no el velo negro de fondo.** |

**Corrección de la revisión final: `.sp-header` salió de esta tabla y la cabecera es MATE.**
Figuraba aquí como superficie de cristal, y era un error de arquitectura, no de redacción: la
cabecera **contiene** a `.sp-kpi`, así que el velo se componía **dos veces** sobre el mismo
píxel y la baldosa acababa siendo la superficie más clara de la app —más clara que la
cabecera que la contiene: rgb(55,66,83) contra rgb(32,38,47), medido sobre píxeles reales—.
Con eso, los siete colores de
los KPI caían por debajo del suelo de 4,5:1, incluido el `#ef4444` con el que se llama a
boxes (2,41:1). `.sp-header` pinta ahora su propio fondo opaco con `var(--panel-bg)` en
`panel.css`; las baldosas siguen siendo de cristal, pero sobre un plano. La regla general que
deja esto: **dos superficies del mismo material no pueden anidarse** — si una contiene a la
otra, la de fuera va mate.

`.sp-back` figuraba antes en esta tabla como superficie con cristal, y su CSS existe en
`panel.css`/`glass.css`, pero `class="sp-back"` no aparece en ningún `.js` ni `.html` del
repo: es CSS muerto desde la entrega 1, sin marcado que lo lleve hoy. Se anota aquí y no se
toca — ese triaje es de la revisión final de rama, no de este spec.

**Mate, intocable:** `.en-row`, `.en-thead`, los 15 colores de `.en-kart`, el degradado ámbar
de `.en-myrow`, `.sp-lapbar`, los badges PIT/OUT/banderas y los números grandes del reloj y
los KPI.

El motivo de la segunda lista no es estético: son 28 filas que repintan varias veces por
segundo durante cuatro horas, y son el dato por el que se llama a boxes. Ni el rendimiento ni
la lectura pueden depender de lo que haya detrás.

**Criterio para clasificar una superficie nueva:** ¿es un *marco* (chrome, panel flotante,
tarjeta contenedora) o es un *widget de dato*? Los marcos llevan cristal. En Track Engineer
esta distinción se equivocó una vez —`LapAnalysisPanel` se agrupó con los widgets de dato
cuando era un modal con marco— y hubo que corregir el spec.

## 6. La trampa del `backdrop-filter`

Un elemento con `backdrop-filter` afecta a sus descendientes por cuatro mecanismos. Tres son
de cascada (`border`, `background`, `box-shadow`) y se resuelven como dice §3. El cuarto no
compite por ninguna propiedad: **convierte al elemento en bloque contenedor de los
descendientes `position: fixed`**. En Track Engineer dejó un modal saliéndose de la pantalla y
ningún barrido de propiedades podía encontrarlo.

**En StintPro ya está localizado.** Los 11 overlays modales se cuelgan de `document.body`
(corrección: la versión anterior decía 14 modales — ese número contaba también 3
`body.appendChild` que no son cajas de modal: el mensaje de error de `app.js:69`, el banner
de demo de `app.js:105` y el de reconciliación de `en-persist.js:131`; descontados esos tres
quedan los mismos 11 de §5, verificado: no hay ni un `appendChild(overlay)` de modal que no
sea a `body`), así que quedan fuera de cualquier subárbol con cristal y no les afecta. **El
caso real es uno**:

> `.sp-session` es `position: fixed` y vive dentro de `.sp-topbar` → `.sp-header`. En cuanto
> `.sp-header` lleve `backdrop-filter`, dejará de posicionarse contra la ventana y pasará a
> hacerlo contra la cabecera.

(Corrección de la revisión final: `.sp-header` acabó **sin** material — ver §5 —, así que ese
disparador concreto ya no existe. El arreglo se queda igual y ese es justo su mérito: con
`absolute` el bloque contenedor es el antecesor posicionado más cercano —`.sp-topbar`, que ya
es `relative`— lleve o no material la cabecera, y el cartel sigue centrado contra la ventana
porque `left:0/right:0` se miden contra la **caja de relleno** de `.sp-topbar`, dentro de la
cual queda su `padding-left:270px`. Verificado en el banco tras quitarle el material a la
cabecera.)

**Solución elegida:** `.sp-session` pasa de `position: fixed` a `position: absolute` dentro de
`.sp-topbar`, que ya es `position: relative`. El `fixed` solo estaba ahí para centrar el
nombre de la sesión en la ventana ignorando el `padding-left: 270px` de la topbar; como
`.sp-header` ocupa el ancho completo, un absoluto centrado dentro da el mismo resultado
visual y deja de depender de quién sea su bloque contenedor. Es además el arreglo que sigue
siendo correcto si mañana otra superficie estrena cristal por encima.

A revisar también, aunque a priori no le afecta: `.titlebar-drag` en `setup.js:267` es
`fixed` pero cuelga de la raíz del setup, no de una `.card`.

**Regla permanente: al dar cristal a un contenedor nuevo, el grep correcto es por
`position: fixed` dentro de su subárbol**, no solo por propiedades duplicadas.

## 7. Contraste y modo ☀

`--text-3` es `#7878a0`. Medido:

| Fondo | Contraste |
|---|---|
| `--bg-card` (hoy) | **4,52:1** — pasa el 4.5 por los pelos |
| compuesto sobre el material A | **3,30:1** — se cae |
| ídem, con `--text-3: #9aa5b4` | **5,56:1** |

**Decisión: `--text-3` sube a `#9aa5b4`.** No se corrige oscureciendo el vidrio: la parada
culpable es la clara, y en Track Engineer se comprobó que ni al 100 % de opacidad se alcanza
el umbral. Es además el mismo valor al que llegó Track Engineer, así que las dos apps
comparten también el gris del texto secundario.

(Los números de esta tabla son una primera estimación compuesta a mano. El test de §9 es la
autoridad.)

**No se toca** `.en-thead span` (`#333`). Su contraste es bajísimo, pero ya lo era antes de
esta rama y es decorativo: **se restaura al valor que tiene, no se mejora**. Arreglarlo es
una decisión aparte.

(Corrección: este párrafo decía también `.sp-fl` (`#2d2f38`), y la rama **sí** lo tocó —
`panel.css:51` lo pasó a `var(--text-3)` en el commit `5c22022`, ruling R6—. Estuvo bien
hecho y por eso se corrige el spec y no el código: al llevar cristal el pie, su fondo se
aclara y `#2d2f38` caía a **~1,1:1** (1,10 medido en la Tarea 2, 1,13 en la revisión final,
1,17 recalculado con el modelo del test sobre el material de entonces), es decir,
desaparecía. No es "bajo pero igual que antes": es una regresión que introduce esta rama.
Apuntarlo a `var(--text-3)` lo pone bajo la vigilancia permanente del test de §9 —hoy
**6,09:1** sobre el peor caso que ese test modela— en vez de dejarlo como un color suelto que
nadie mide. `.en-thead span` sí sigue intacto: vive en la
zona de datos, que se queda mate.)

**`body.hc` apaga el cristal**: superficies opacas y `--glass-blur: 0`. El modo contraste
sigue siendo el refugio garantizado para sol directo, y así no hay que demostrar que el
vidrio aguanta el peor caso. Se implementa como override de tokens, no como reglas nuevas.

**Cambio de comportamiento a declarar:** al tokenizar el panel (§2.3), el botón ☀ Contraste
empezará a afectar de verdad al panel de carrera, cosa que hoy no hace. Es una mejora, pero
es visible y no debe sorprender a nadie en una carrera.

## 8. Rendimiento

El reparto de §5 deja fuera del cristal lo que más repinta: las 28 filas y `.sp-lapbar`, que
va a 100 ms.

**El punto a vigilar:** el reloj y los KPIs viven dentro de `.sp-header`, que sí lleva
cristal. En sprint se reescriben 1 vez por segundo (`_spClockTimer`); en endurance, en cada
`_enRender()`, o sea con cada actualización de Apex. Cada escritura obliga a recalcular el
desenfoque de esa franja.

En Track Engineer, 28px de blur aguantaron sobre vídeo a 30 fps sin tirones, así que el
riesgo era bajo — y ya está medido, no solo estimado (Tarea 6): banco con la parrilla llena
a `10×`, GPU Apple M4, 5 s de `requestAnimationFrame` × 2 pasadas por modo → **60,0 FPS,
16,67 ms de frame medio, 0 tareas largas**, y el modo ☀ (sin cristal) da lo mismo hasta la
décima. Con esto, este spec deja de pedir una medición que ya está hecha.

Dos palancas puestas por si acaso: el token `--glass-blur`, y una regla que baja el
desenfoque en pantallas pequeñas, que es donde más cuesta — implementada en `src/glass.css`
(`--glass-blur` a 14px bajo esa media query).

(Corrección de la revisión final: esa regla se escribió dentro del `@media (max-width:900px)`
que ya existía "para iPad", y con 900px **no se disparaba en ningún iPad en apaisado**, que
es como se mira un panel de tiempos: mini 1024, 10.2" 1080, Air 1180, Pro 12.9" 1366. La
palanca existía y estaba apagada para su caso de uso declarado. El corte de `glass.css` sube
a **1200px**, que cubre mini, 10.2" y Air; el Pro 12.9" queda fuera a propósito, porque
subirlo a 1400 arrastraría también a los portátiles de 1366 de ancho. Los otros dos
`@media (max-width:900px)` del proyecto —`en-grid.js:44` y `en-state.js:167`— estrechan las
columnas de la parrilla y **no** se tocan: coincidían en el número, no en el motivo.)

## 9. Verificación

Sin build ni CI. Los tests son `node tests/x.test.js` con `assert` (corrección: la versión
anterior decía "como los ocho que ya hay" — son **14 ficheros** de test, `ls tests/*.test.js
| wc -l`).

1. **`tests/contrast.test.js`** (nuevo, sin dependencias): compone la capa de profundidad y el
   cristal sobre el fondo y exige **4.5:1** a `--text-3`. **Si se pone rojo, se ajusta el
   material — el umbral no se toca.** (Corrección: hoy hace más que eso — también barre los
   colores de texto **literales** escritos a mano en las 11 cajas de modal, y su lista de
   excepciones está vacía a propósito (`EXCEPCIONES = {}`), es decir que hoy ningún color
   queda dispensado del 4,5:1.)
2. **La suite completa en verde: 14/14** (corrección, ruling R32: la ronda anterior decía
   "Los 14 tests existentes", pero "existentes" ya no es un conjunto bien definido — esta
   misma entrega añadió dos ficheros de test, `glass.test.js` y `contrast.test.js`, que el
   punto 1 ya cuenta aparte; sumar "14 totales" + "1 nuevo aparte" + "14 existentes" no
   cuadra. La cifra estable y verificable con un solo comando es la suite entera en verde).
   Este trabajo toca `en-state.js` y `sprint.js`, que están cubiertos indirectamente.
3. **Verificación visual con `replay-connector.js`**, reproduciendo una sesión ya grabada:
   es lo que permite ver el panel lleno de datos sin esperar a una carrera.
4. **Los dos modos, obligatorio**: endurance y sprint son ficheros distintos y esto toca los
   dos. Y en los dos: modo normal y modo ☀.
5. **Barrido final de `position:fixed`** en cada subárbol que estrene cristal (§6).
6. **Nada se despliega sin confirmación explícita.** El trabajo llega hasta "verificado en
   local con replay". El `git push` a `main` que dispara Vercel lo decide y lo confirma
   Javier, y no se da por hecho en ningún momento.

## 10. Fuera de alcance

- Las seis páginas satélite (§1).
- Arreglar el contraste de `.en-thead span` (§7). (Corrección: aquí figuraba también `.sp-fl`,
  que la rama sí arregló porque el cristal lo hundía a 1,13:1 — ver §7.)
- Tokenizar los 209 hex: **solo** se tokenizan las superficies que estrenan cristal y las que
  el modo ☀ necesita. El resto se queda como está.
- Cualquier cambio de disposición, tipografía o tamaño. Esto es un cambio de material.
