# Estética «cristal de instrumento» — criterios para StintPro

Guía para llevar a StintPro el material que ya está en producción en Track
Engineer. **Léela entera antes de tocar CSS.** No es una lista de valores para
copiar: es el conjunto de criterios que hacen que el material se vea como
vidrio y no como un gris distinto, y las cuatro formas en que se rompe.

El origen está en `~/track-engineer` (`ESTETICA-CRISTAL.md`, y el diseño
razonado en `docs/superpowers/specs/2026-08-20-track-engineer-estetica-cristal-design.md`).
Aquello está terminado, verificado y desplegado; esto es el puerto.

Escrita el 2026-08-21. Los hallazgos sobre StintPro son de una lectura del
repo de ese día: si algo no cuadra, gana el código.

---

## 1. Qué es el material, y qué no

**El cristal es material de chrome. En la zona de datos no entra.** Es la única
regla que no se negocia, y todo lo demás sale de ella.

| | Qué es | En StintPro |
|---|---|---|
| **Chrome** | El marco: lo que rodea al dato y te deja navegarlo | Barra superior, pestañas, modales, tarjetas del setup |
| **Dato** | Lo que has venido a leer | La parrilla, el semáforo de parada, tiempos, gaps, banderas |

El porqué no es estético, es de legibilidad. **En la zona de datos el color ya
significa algo**: verde es que vas bien, rojo es que entras, ámbar es tu kart.
Un material translúcido tiñe lo que hay debajo y añade una capa de luz que
compite con esa señal. En una pantalla que miras de reojo con el casco en la
mano, eso no es un detalle de gusto: es una lectura peor.

Dicho de otra forma: el cristal se gana el sitio donde su trabajo es *no
llamar la atención*. Donde el trabajo del píxel es gritarte algo, sobra.

### La capa de profundidad no es opcional

Un vidrio sobre un fondo plano es solo un gris distinto. El material se ve
porque **recoge luz que hay detrás**, así que hay que ponerla: dos manchas
radiales muy tenues en el fondo de la aplicación, fijas y sin animación.

En Track Engineer es una sola regla sobre el contenedor raíz:

```css
background:
  radial-gradient(58% 46% at 20% 6%,  var(--depth-warm), transparent 70%),
  radial-gradient(66% 56% at 90% 94%, var(--depth-cool), transparent 70%),
  var(--bg);
```

**Va una sola vez, en el contenedor de más arriba, y nunca repetida por
componente** — que es exactamente como estas cosas acaban costando fotogramas.

En StintPro el sitio es `.dash-wrap` (y `.setup-root` para la pantalla de
setup). Ojo: `--depth-warm` es ámbar de marca al 11 %, y esa mancha es la que
en Track Engineer hundió el contraste del texto secundario. Ver §5.

---

## 2. Los tokens, y el problema de marca que hay debajo

### 2.1 Los valores del material

Doce tokens. Estos son los de Track Engineer, ya verificados en pantalla:

```css
--glass-a:         rgba(68, 79, 96, 0.50);   /* parada clara del degradado */
--glass-b:         rgba(26, 33, 44, 0.54);   /* parada oscura */
--glass-blur:      28px;
--glass-sat:       200%;
--glass-bright:    122%;
--glass-edge:      rgba(255, 255, 255, 0.34); /* canto especular, 1px arriba */
--glass-edge-low:  rgba(255, 255, 255, 0.07);
--glass-border:    rgba(255, 255, 255, 0.19);
--glass-shadow:    0 16px 38px rgba(0, 0, 0, 0.52);
--glass-solid-a:   rgba(48, 57, 72, 0.80);   /* variante para encima de vídeo */
--glass-solid-b:   rgba(16, 21, 28, 0.84);
--glass-solid-blur: var(--glass-blur);        /* palanca, hoy sin usar */
```

**Son un punto de partida, no una copia.** Están afinados contra el fondo de
Track Engineer (`--bg: #0f1216`). El de StintPro es `#07090F`, **más oscuro**,
así que el mismo vidrio se verá más denso. Espera tener que subir un punto las
paradas claras y vuelve a medir el contraste (§5) antes de darlo por bueno.

**Lo que hace que esto se lea como vidrio no es el desenfoque.** Son otras dos
cosas: el canto especular de un píxel arriba, que simula la luz que recoge un
bisel, y la sombra proyectada, que hace que el panel flote en vez de estar
pegado. Si algún día hay que quitar algo por rendimiento, **se quita el
desenfoque antes que el canto**.

La variante `--glass-solid-*` existe solo para lo que va encima de contenido
que cambia solo. En StintPro hoy no hay vídeo, pero sí hay algo equivalente:
cualquier chrome que flote sobre la parrilla en vivo, que se repinta sola. Si
el texto de un panel depende de lo que haya debajo en ese momento, usa la
variante con suelo de opacidad.

### 2.2 El problema de marca (adyacente — puedes saltártelo)

Esto no es cristal, pero sí es «estética uniforme», así que queda dicho:

- **Track Engineer tiene `frontend/src/brand.css` y se declara canónico del
  grupo** — «lo comparten Track Engineer, StintPro y StintPro Pilot». **StintPro
  no lo tiene.** El fichero compartido no está compartido.
- El ámbar de StintPro vive en un token llamado **`--blue`**. El valor
  (`#F5A623`) coincide con el canónico, así que no hay dos ámbares: hay un
  token con el nombre de otro color, más `#F5A623` escrito a mano **8 veces en
  `styles.css` y 3 en el `<style>` de `index.html`**.
- El fondo ya coincide de hecho: `--brand-ink: #07090f` en Track Engineer,
  `--bg: #07090F` en StintPro.
- **Y lo peor: `CLAUDE.md` de este repo dice que la marca es otra.** Su sección
  «Marca» (línea 311) declara «azul `#5b8dee`, dark `#0e0f11`, background
  `#08090a`». Ninguno de esos tres valores está en `styles.css`, y el azul no
  existe en ninguna parte del producto. **Ese fichero es el primero que lee
  cualquier chat nuevo**, así que hoy la fuente de verdad más consultada es la
  única que está equivocada.

Esto explica el nombre del token: `--blue` **fue** azul, se repintó de ámbar y
nadie renombró nada. El rastro quedó en el token y en `CLAUDE.md`.

**Corregir la sección «Marca» de `CLAUDE.md` es lo más barato y lo más rentable
de toda esta guía.** Son tres líneas y evita que el próximo chat diseñe contra
una paleta que no existe.

Si se aborda: traer `brand.css` a StintPro, hacer que `--blue` sea un alias de
`--brand-amber` en vez de un valor, y sustituir los hexadecimales sueltos por
la referencia. Es mecánico y sin riesgo. Pero **es una tarea distinta de esta**,
y mezclarlas hace que un fallo de contraste y un fallo de marca lleguen en el
mismo commit.

---

## 3. Dónde vive el material en StintPro

Aquí está el trabajo de verdad, porque **el mecanismo de Track Engineer no
existe en StintPro** y copiarlo sin darse cuenta es la forma más fácil de
perder una tarde.

En Track Engineer el material vive en un módulo CSS y los componentes lo
consumen con `composes`, que es una función del bundler. StintPro es HTML
plano con CSS global: no hay módulos, no hay `composes`.

### 3.1 La receta: dos clases utilitarias

En `src/styles.css`, junto al `:root`:

```css
.glass {
  background: linear-gradient(158deg, var(--glass-a), var(--glass-b));
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-sat)) brightness(var(--glass-bright));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-sat)) brightness(var(--glass-bright));
  box-shadow:
    inset 0 1px 0 var(--glass-edge),
    inset 0 -1px 0 var(--glass-edge-low),
    var(--glass-shadow);
}
```

Y se aplica añadiendo la clase: `class="dash-topbar glass"`.

**El material NO declara `border`, y es a propósito.** Cada superficie quiere
un borde distinto —solo abajo, solo a un lado, los cuatro— y si `.glass`
también pusiera uno, las dos reglas competirían por la misma propiedad. Cada
consumidor declara el suyo con `var(--glass-border)`.

### 3.2 El obstáculo: solo una página carga la hoja

**`styles.css` lo carga únicamente `index.html`.** Las otras **siete** páginas
—`hub`, `profile`, `report`, `admin`, `landing`, `logger-stats`,
`race-report-ironman2026`— llevan cada una su `<style>` inline, de 24 a 301
líneas, y **no comparten ni los tokens**. Por eso hoy hay hexadecimales
repetidos por página.

Esto es una decisión, no un detalle. Hay dos caminos honestos:

1. **Enlazar `styles.css` desde las siete páginas** y borrar de sus `<style>`
   lo que la hoja ya define. Es más trabajo y arregla de paso la duplicación,
   que es la causa real de que la estética no sea uniforme hoy.
2. **Dejar el cristal solo en `index.html`** (setup + dashboard, que es donde
   se vive la carrera) y aceptar que el resto queda mate.

**El camino 2 es defendible, el camino 1 es el que resuelve lo que pediste.**
Lo que no vale es hacer el 2 creyendo que se está haciendo el 1: si el chat que
lo ejecute no lo dice explícitamente, StintPro acabará con dos estéticas y
nadie sabrá si fue a propósito.

### 3.3 La trampa propia de StintPro: los estilos en línea

**El dashboard se pinta desde JavaScript.** Hay `<style>` inyectado desde
`app.js`, `en-state.js` y `sprint.js`, y unos 112 atributos `style=` repartidos
entre `app.js` y `en-grid.js`.

Un `style=` en el elemento **le gana a cualquier regla de clase**, siempre, sin
importar el orden ni la especificidad. Así que:

> Antes de añadir `.glass` a una superficie, comprueba si esa superficie recibe
> `background`, `box-shadow` o `border` por atributo `style=` desde JS. Si lo
> recibe, la clase no hará nada y parecerá que el material «no funciona».

El arreglo es quitar esa propiedad del `style=` y dejarla en la hoja, no pelear
con `!important`.

---

## 4. Qué lleva cristal y qué no, con nombre y apellidos

### Lleva cristal

| Selector | Dónde | Nota |
|---|---|---|
| `.dash-topbar` | Barra superior del dashboard | Nombre de carrera, reloj, badge de directo |
| `.dash-nav` | Fila de pestañas | Hoy `background: var(--bg-raised)`: quitarlo, compite con el material |
| `.dialog-box` | Modales de confirmación | El `.dialog-overlay` NO — es el velo, se queda como está |
| `.modal-box` | **Segunda familia de modales** (`.modal-head` / `.modal-body` / `.modal-row`) | Solo la caja. Ojo: `.modal-row.mine` lleva tinte ámbar propio y es DATO — el cristal va detrás de esas filas, no encima |
| `#sp-topnav` | Nav fija de `index.html` | Vive en un `<style>` inline con hexadecimales a pelo; limpiar antes |
| `.card` | Tarjetas del setup | Contenedor de campos, no de dato |

### Se queda mate, y no se discute

| Selector | Por qué |
|---|---|
| `.stop-light`, `.sl-bulb` | **Es un semáforo.** Su trabajo es gritarte si entras o no |
| Filas y KPIs de `en-grid.js` | Dato puro: tiempos, gaps, posiciones. Sus clases **no están en `styles.css`** — se pintan desde JS (§3.3) |
| `.live-badge` | Estado en vivo, con rojo semántico |
| `.f-indicator`, `.cdot` | Indicadores de conexión: verde/rojo/ámbar significan algo |
| Todo lo que use `--green` / `--red` / `--orange` y sus `-dim` | Ahí el color es señal, no decoración |

**Criterio para lo que no esté en la tabla:** ¿esta superficie *contiene* dato,
o *es* dato? Un modal con marco que dentro tiene una tabla es chrome, y lleva
cristal —el marco, no la tabla—. Un semáforo, un badge de estado o una celda
de tiempo es dato, y se queda mate.

Este criterio importa porque en Track Engineer se falló exactamente aquí: el
panel de análisis quedó clasificado junto a las gráficas y el mapa por estar
«en la lista de widgets», cuando en realidad era un modal con marco como los
demás. El resultado fue que un botón abría un modal opaco y el de al lado uno
de cristal. Se corrigió después.

---

## 5. El contraste, y el modo de alto contraste

### 5.1 En `.hc` el cristal se apaga

StintPro tiene un modo de alto contraste (`body.hc`, con el botón «☀ Contraste»
y persistencia en `localStorage`) que reasigna los tokens para subir la
legibilidad.

**Decisión tomada: en `body.hc` el cristal se apaga.** Sin desenfoque, sin
transparencia, fondo sólido.

```css
body.hc .glass {
  background: var(--bg-card);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
```

El porqué: ese modo existe para una necesidad real —sol de frente en el pit
lane, vista cansada a las seis horas de carrera— y el material es decoración.
Cuando las dos cosas chocan, gana la que resuelve un problema. Además es la
única opción que no obliga a mantener dos composiciones distintas por encima
del umbral.

Quitar el desenfoque en `.hc` tiene un segundo efecto que viene bien: es el
camino barato si algún día aparece un problema de rendimiento en un portátil
flojo durante una carrera.

### 5.2 El umbral, y el error que hay que no repetir

**Aclarar el vidrio degrada la legibilidad del texto que va encima.** En Track
Engineer, medido: el texto secundario cayó de 4.75 a **3.40** en el peor píxel
real, por debajo del 4.5:1 que WCAG AA pide para texto normal.

Dos cosas que costaron caro aprender:

1. **No se arregla oscureciendo el cristal.** La parada culpable es la clara,
   y ni al 100 % de opacidad se llega a 4.5.
2. **Se arregla aclarando el token del texto.** En Track Engineer, `--muted`
   pasó de `#7d8694` a `#9aa5b4`. De paso destapó que ese token ya estaba por
   debajo del umbral *antes* del cristal.

En StintPro el candidato equivalente es **`--text-3: #7878a0`**, que es el que
se usa en hints, unidades y subtítulos. Cuenta con tener que subirlo.

### 5.3 El test que lo vigila

El fondo real bajo el texto **no está escrito en ningún sitio**: sale de
componer las dos paradas del vidrio sobre la capa de profundidad sobre el
fondo. Eso es una cuenta, y las cuentas las hace mejor una máquina que un ojo.

StintPro ya tiene tests en `node` plano (`node tests.js`, más `tests/*.test.js`
con `assert`), y el test de contraste **es matemática pura: no necesita DOM ni
navegador**, así que se porta tal cual. El original está en
`~/track-engineer/frontend/src/styles/contrast.test.ts`: lee los tokens del CSS,
compone las capas con alfa, y calcula el ratio WCAG.

Lo que debe cubrir:

- Componer **incluyendo la capa de profundidad**. Ignorarla es infravalorar el
  peor caso: es justo la mancha ámbar la que hundió el contraste en Track
  Engineer.
- Exigir **4.5:1** al texto normal y al secundario.
- Medir también el estado `body.hc`, ahora que ahí el material es opaco.

> **Si el test se pone rojo, no bajes el umbral. El material se ajusta al
> umbral, nunca al revés.**

---

## 6. Las trampas del `backdrop-filter`

Un elemento con `backdrop-filter` **afecta a sus descendientes**, y no solo por
la cascada. En Track Engineer apareció cuatro veces, por cuatro mecanismos
distintos:

| Qué pasó | Cómo se resolvió |
|---|---|
| El material ganaba la pelea por `border` | El material dejó de declarar borde; cada superficie declara el suyo |
| Ganaba por `background` contra un estado (arrastre, activo) | Selector compuesto: gana por **especificidad**, que no depende del orden |
| Ganaba por `box-shadow` en paneles flotantes | Se borró la sombra propia; la elevación la pone el material |
| **Capturó un descendiente `position: fixed`** | El modal salió del subárbol con un portal |

Las tres primeras se encuentran preguntando «qué propiedades competen». **La
cuarta no la encuentra ningún barrido de propiedades, porque no compite por
ninguna**: un elemento con `backdrop-filter` se convierte en bloque contenedor
de sus descendientes `position: fixed`, y esos dejan de posicionarse respecto a
la ventana. Fue la única de las cuatro que rompió algo funcional — un modal
saliéndose de la pantalla.

### En StintPro esta trampa está viva

Hay **tres** elementos `position: fixed` en juego, y las dos familias de
modales son fáciles de pasar por alto porque están a 120 líneas de distancia
en el mismo fichero:

- `.dialog-overlay` — `styles.css:136`
- `.modal-overlay` — `styles.css:255`, gemelo del anterior
- `#sp-topnav` — en el `<style>` inline de `index.html`, no en la hoja

**Si el cristal acaba en un contenedor que los envuelva, se rompen.** Como
`#sp-topnav` es hijo directo de `<body>` y los diálogos se montan al vuelo,
merece una comprobación antes de cada añadido, no una sola vez.

**El barrido correcto antes de poner cristal en un contenedor nuevo:**

```bash
grep -rn "position:\s*fixed\|position:\s*absolute" src/
```

No busques propiedades duplicadas. Busca `position`.

---

## 7. Orden sugerido, de menor a mayor riesgo

Cada paso deja StintPro en un estado coherente, así que se puede parar en
cualquiera de ellos.

1. **Los tokens y la capa de profundidad**, sin aplicar cristal a nada. Ya se
   nota (el fondo deja de ser plano) y no puede romper nada.
2. **El test de contraste**, en verde con el estado actual. Antes de tocar
   ninguna superficie: así, si algo lo pone rojo después, se sabe qué fue.
3. **`.dash-nav` y `.dash-topbar`.** Son la superficie más grande y la que
   más cambia la percepción. Acuérdate de quitarle a `.dash-nav` su
   `background: var(--bg-raised)`.
4. **`.dialog-box` y `.modal-box`**, las dos familias, con el barrido de
   `position` hecho antes. Si solo se hace una, los dos tipos de modal dejan de
   parecerse — que es el fallo que Track Engineer ya cometió una vez (§4).
5. **La regla de `body.hc`**, y comprobar el modo a mano.
6. **`.card` del setup y `#sp-topnav`**, que exigen limpiar hexadecimales
   sueltos antes.
7. **Decidir lo de las siete páginas** (§3.2), que es lo caro y lo que de verdad
   cierra «estética uniforme».

---

## 8. Reglas del proyecto que esto no cambia

- **Nada de push, fusión ni despliegue sin OK explícito de Javier**, cada vez.
- El despliegue de StintPro es push a `main` → auto-deploy en Vercel
  (`stintpro.vercel.app`, sirve `src/`). El logger del VPS va aparte.
- **Commits en español**, explicando el PORQUÉ.
- El cristal es material de chrome. En la zona de datos no entra. Si esta guía
  y una decisión puntual se contradicen, gana esta frase.
