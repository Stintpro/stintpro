# Estética de cristal · Entrega 2 (el material) — plan de implementación

> **Para agentes:** SUB-SKILL OBLIGATORIA: usa `superpowers:subagent-driven-development`
> (recomendado) o `superpowers:executing-plans` para ejecutar este plan tarea a tarea.
> Los pasos usan casillas (`- [ ]`) para el seguimiento.

**Goal:** el chrome de StintPro pasa a cristal ahumado translúcido sobre una capa de
profundidad; la zona de datos sigue mate.

**Architecture:** un `src/glass.css` nuevo, cargado el último, contiene **los dos únicos
materiales** —`.sp-glass` para el chrome sobre el fondo y `.sp-glass-denso` para lo que flota
sobre datos— alimentados por tokens del `:root`. La capa de profundidad va **una sola vez** en
`#screen-dash` y `#screen-setup`. Las superficies que ya tienen selector propio lo componen
por CSS; las 11 cajas de modal, que hoy llevan estilo inline, estrenan una clase para poder
componerlo también.

**Tech Stack:** JavaScript de navegador sin build ni bundler. Tests: `node tests/x.test.js`
con `assert/strict`, sin dependencias. Despliegue: estático en Vercel sirviendo `src/`.

**Spec:** `docs/superpowers/specs/2026-08-31-stintpro-liquid-glass-design.md`

## Global Constraints

- **El material vive en `src/glass.css` y en ningún otro sitio.** Si el vidrio cambia, cambia
  ahí. Ninguna otra hoja ni ningún `<style>` inyectado declara `backdrop-filter`.
- **Orden de carga, invariable:** `styles.css` → `panel.css` → `glass.css` → los `<style>`
  inyectados desde JS.
- **`glass.css` NO declara `border`.** Cada superficie quiere el suyo —solo el inferior en
  `.sp-header`, los cuatro en `.sp-kpi`, solo el superior en `.sp-footer`— y si el material
  también pusiera uno, competirían por la misma propiedad. El borde es de cada superficie, con
  `var(--glass-border)`. `background` y `box-shadow` **sí** los declara el material: cualquier
  regla que necesite pisarlos sobre el mismo elemento tiene que ganar por **especificidad**
  (un `.card.abierto` de 0,2,0 le gana siempre a `.sp-glass` de 0,1,0), nunca por orden.
- **La zona de datos no se toca.** Mate e intocable: `.en-row`, `.en-thead`, los 15 colores de
  `.en-kart`, el degradado ámbar de `.en-myrow`, `.sp-lapbar`, los badges PIT/OUT/banderas y
  los números grandes del reloj y los KPI.
- **La capa de profundidad va una sola vez por pantalla**, nunca repetida por componente: así
  es como estas cosas acaban costando fotogramas.
- **Un selector y el `@media` que lo redeclara viven en el mismo fichero.** La entrega 1 se
  llevó una regresión por saltarse esto; `tests/panel-css.test.js` ya lo vigila.
- **Al dar cristal a un contenedor, el grep obligatorio es `position: fixed` dentro de su
  subárbol**, no solo propiedades duplicadas. Un elemento con `backdrop-filter` se convierte
  en bloque contenedor de sus descendientes `fixed`.
- **El umbral de contraste es 4.5:1 y no se toca.** Si el test se pone rojo, se ajusta el
  material, nunca el umbral.
- **Nada se despliega.** El trabajo termina en "verificado en local". El `git push` a `main`
  que dispara Vercel lo decide y lo confirma Javier.
- Todo el texto de código, comentarios y commits, **en español**.

## Lo que cambió bajo los pies del spec durante la entrega 1

Tres cosas que el spec da por buenas y ya no lo son. **Este plan manda sobre el spec en estos
tres puntos:**

1. **`.setup-root` no existe.** El spec (§4) pone ahí la capa de profundidad del setup, pero
   era CSS muerto y la entrega 1 lo borró. El ancla correcta es **`#screen-setup`**, que
   además es simétrica con `#screen-dash`.
2. **"La caja de los 14 modales" no es una superficie, son 11 cajas con estilo inline**
   repartidas por 5 ficheros JS, con fondos y radios distintos. Necesitan una clase antes de
   poder llevar material. La Tarea 3 las nombra una a una.
3. **Hay un cuarto `<style>` inyectado** que el spec no menciona: `#en-col-style`, generado en
   `en-grid.js` con su propio `@media (max-width:900px)`. Hoy solo toca
   `grid-template-columns`, así que no choca, pero está en el mapa.

## Estructura de ficheros

| Fichero | Responsabilidad |
|---|---|
| `src/glass.css` (nuevo) | **Los dos únicos materiales** y los tokens del vidrio. Único sitio con `backdrop-filter`. |
| `src/index.html` | El `<link>` a `glass.css`, después de `panel.css`. |
| `src/styles.css` | Tokens del vidrio y de la profundidad en `:root`; `--text-3` a `#9aa5b4`; overrides de `body.hc` que apagan el cristal. |
| `src/panel.css` | La capa de profundidad en `#screen-dash`; los bordes de las superficies pasan a `var(--glass-border)`. |
| `src/en-state.js` | `.en-col-panel`, `.en-team-card`, `.en-strat-card` componen el material. |
| `src/app.js`, `en-grid.js`, `en-team.js`, `en-advanced.js`, `en-strategy.js` | Las 11 cajas de modal estrenan `class="sp-modal"`. |
| `tools/panel-preview.html` | Monta `#sp-topnav` para poder probar ☀ y el selector de columnas. |
| `tests/contrast.test.js` (nuevo) | Compone las capas y exige 4.5:1 al texto secundario. |
| `tests/glass.test.js` (nuevo) | Invariantes del material: dónde vive, quién lo compone, qué no lo lleva. |

---

### Task 1: el banco monta `#sp-topnav`

Prerrequisito de todo lo demás. Dos de las superficies con cristal —el selector de columnas y
el botón ☀— cuelgan de `#sp-topnav`, y el banco no lo monta: en la entrega 1 hubo que
inyectarlo a mano por consola para poder probarlos. Sin esto, la verificación visual de esta
entrega tiene un agujero justo en su superficie más delicada.

**Files:**
- Modify: `tools/panel-preview.html`

**Interfaces:**
- Consumes: nada.
- Produces: un `#sp-topnav` en el banco con el botón `#sp-hc-btn` y la función global
  `_spToggleHC()`, que las Tareas 5, 6 y 7 usan para verificar el modo ☀.

- [ ] **Paso 1: mirar cómo es el de verdad**

Lee `src/index.html` líneas 12-38: el `<div id="sp-topnav">` con su `<style>`, el botón
`#sp-hc-btn` y la función `_spToggleHC()`. El banco debe reproducir **lo mínimo para que el
panel se comporte igual**, no la barra entera: no hace falta el nombre de usuario ni el enlace
al perfil ni el botón de salir, que dependen de Supabase.

- [ ] **Paso 2: añadirlo al banco**

En `tools/panel-preview.html`, justo después del `<div id="screen-dash">`, añade:

```html
  <!-- Réplica mínima de #sp-topnav (src/index.html:12-38). El panel inyecta aquí dentro
       el botón del selector de columnas (_enInjectColumnsBtn, en-strategy.js), así que sin
       este nodo esa superficie sencillamente no existe en el banco. Solo se replica lo que
       no depende de Supabase: el contenedor y el botón de contraste. -->
  <style>
    #sp-topnav { position:fixed;top:0;left:0;z-index:9999;display:flex;align-items:center;gap:10px;padding:12px 18px; }
    #sp-topnav .sp-nav-btn { font-size:11px;color:#8A9AAE;background:none;border:1px solid #2A3848;border-radius:3px;padding:5px 12px;cursor:pointer;font-family:'Inter',sans-serif;text-decoration:none; }
    #sp-topnav .sp-nav-hc { color:#F5A623;border-color:#F5A623; }
  </style>
  <div id="sp-topnav">
    <button class="sp-nav-btn" id="sp-hc-btn" onclick="_spToggleHC()">☀ Contraste</button>
  </div>
  <script>
    function _spToggleHC() {
      var on = document.body.classList.toggle('hc');
      document.getElementById('sp-hc-btn').classList.toggle('sp-nav-hc', on);
    }
  </script>
```

Y en el bloque que ya lee los parámetros de la URL, haz que `?hc=1` deje también el botón en
su estado activo, para que las dos vías coincidan:

```js
    if (q.get('hc') === '1') {
      document.body.classList.add('hc');
      document.getElementById('sp-hc-btn').classList.add('sp-nav-hc');
    }
```

- [ ] **Paso 3: verificar que aparecen las dos cosas**

Levanta el banco con `preview_start` (entrada `stintpro-banco`, sirve la raíz del repo en el
puerto 8765) y abre `http://localhost:8765/tools/panel-preview.html`. **Nunca arranques un
servidor con Bash.** En la barra de replay pulsa `10×` y espera un minuto para que la parrilla
se llene.

Esperado: arriba a la izquierda aparecen **el botón ☀ Contraste y el botón del selector de
columnas**. Pulsa el de columnas: se abre `.en-col-panel` con la lista de columnas y sus
casillas. Pulsa ☀: el texto secundario se aclara. Ambos existían ya, pero hasta ahora no en
el banco.

**Aviso heredado de la entrega 1:** el Browser pane cachea agresivamente los `<script src>`.
Si un cambio "no se aplica", sospecha de esto antes que de tu código; el apaño que funcionó
fue un `fetch` con cache-busting.

- [ ] **Paso 4: commit**

```bash
git add tools/panel-preview.html
git commit -m "test(banco): monta #sp-topnav para poder probar ☀ y el selector de columnas"
```

---

### Task 2: el material y la capa de profundidad

El corazón de la entrega. Tras esta tarea el cristal **ya se ve**.

**Files:**
- Create: `src/glass.css`
- Create: `tests/glass.test.js`
- Modify: `src/styles.css` (bloque `:root`)
- Modify: `src/index.html`
- Modify: `src/panel.css`
- Modify: `tools/panel-preview.html`

**Interfaces:**
- Consumes: los tokens `--panel-*` de la entrega 1 y el `#sp-topnav` de la Tarea 1.
- Produces: las clases `.sp-glass` y `.sp-glass-denso` en `src/glass.css`, y los tokens
  `--glass-*` y `--depth-*` en `:root`. Las Tareas 3, 5 y 6 los consumen.

- [ ] **Paso 1: escribir el test que falla**

`tests/glass.test.js`:

```js
// StintPro — invariantes del material de cristal.
// Ejecutar: node tests/glass.test.js
'use strict';

const fs = require('fs');
const path = require('path');
const { strictEqual, deepStrictEqual } = require('assert/strict');
const { rulesOf } = require('../tools/css-extract');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}
function group(name, fn) { console.log('\n' + name); fn(); }

const raiz = path.join(__dirname, '..');
const leer = p => fs.readFileSync(path.join(raiz, p), 'utf8');

const glass  = leer('src/glass.css');
const styles = leer('src/styles.css');
const panel  = leer('src/panel.css');
const index  = leer('src/index.html');

group('el material vive en un solo sitio', () => {
  test('glass.css declara backdrop-filter', () => {
    strictEqual(/backdrop-filter/.test(glass), true);
  });
  test('ningún otro fichero servido declara backdrop-filter', () => {
    const otros = fs.readdirSync(path.join(raiz, 'src'))
      .filter(f => /\.(css|js)$/.test(f) && f !== 'glass.css')
      .filter(f => /backdrop-filter/.test(leer('src/' + f)));
    deepStrictEqual(otros, []);
  });
  test('glass.css declara el material exactamente dos veces', () => {
    const conMaterial = rulesOf(glass).filter(r => /backdrop-filter/.test(r.body));
    strictEqual(conMaterial.length, 2,
      `el material se declara ${conMaterial.length} veces; debe declararse 2 (normal y denso)`);
  });
  test('una declaración es la normal y la otra la densa', () => {
    const sel = rulesOf(glass).filter(r => /backdrop-filter/.test(r.body)).map(r => r.selector);
    strictEqual(sel.some(s => /(^|,\s*)\.sp-glass(,|\s|$)/.test(s)), true, 'falta .sp-glass');
    strictEqual(sel.some(s => /\.sp-glass-denso/.test(s)), true, 'falta .sp-glass-denso');
  });
});

group('el material no declara borde', () => {
  test('ni .sp-glass ni .sp-glass-denso declaran border', () => {
    for (const r of rulesOf(glass)) {
      if (!r.selector.startsWith('.sp-glass')) continue;
      strictEqual(/(^|;)\s*border\s*:/.test(r.body), false,
        `${r.selector} declara border y competiría con cada superficie`);
    }
  });
});

group('la capa de profundidad va una sola vez por pantalla', () => {
  test('solo #screen-dash y #screen-setup la declaran', () => {
    const conProfundidad = [...rulesOf(panel), ...rulesOf(glass), ...rulesOf(styles)]
      .filter(r => /var\(--depth-(warm|cool)\)/.test(r.body))
      .map(r => r.selector);
    deepStrictEqual(conProfundidad.sort(), ['#screen-dash', '#screen-setup']);
  });
});

group('el orden de carga', () => {
  test('index.html carga styles.css → panel.css → glass.css', () => {
    const i1 = index.indexOf('href="styles.css"');
    const i2 = index.indexOf('href="panel.css"');
    const i3 = index.indexOf('href="glass.css"');
    strictEqual(i1 > -1 && i2 > -1 && i3 > -1, true, 'falta algún <link>');
    strictEqual(i1 < i2 && i2 < i3, true, 'el orden de carga es incorrecto');
  });
});

group('la zona de datos sigue mate', () => {
  const PROHIBIDAS = ['.en-row', '.en-thead', '.en-kart', '.en-myrow', '.sp-lapbar'];
  test('ninguna regla de datos compone el material', () => {
    const todo = glass + panel + leer('src/en-state.js') + leer('src/sprint.js');
    for (const sel of PROHIBIDAS) {
      const esc = sel.replace('.', '\\.');
      const m = todo.match(new RegExp(`${esc}\\s*\\{([^}]*)\\}`, 'g')) || [];
      for (const regla of m) {
        strictEqual(/backdrop-filter/.test(regla), false, `${sel} lleva material y debe seguir mate`);
      }
    }
  });
});

console.log(`\n${passed} pasados, ${failed} fallidos`);
process.exit(failed ? 1 : 0);
```

- [ ] **Paso 2: ejecutarlo para verificar que falla**

Run: `node tests/glass.test.js`
Esperado: FALLA con `ENOENT ... src/glass.css`.

- [ ] **Paso 3: declarar los tokens en `:root`**

En `src/styles.css`, dentro de `:root`, justo después del bloque `--panel-*`:

```css
  /* ── El material de cristal ────────────────────────────────────────────
   * Los mismos valores que Track Engineer (frontend/src/styles/glass.module.css),
   * elegidos sobre una comparativa de tres materiales: las dos apps se leen como
   * la misma familia. Lo que hace que esto parezca vidrio NO es el desenfoque,
   * son el canto especular de un píxel arriba y la sombra proyectada. Si algún
   * día hay que quitar algo por rendimiento, se quita el desenfoque antes que
   * el canto. */
  --glass-a:        rgba(68, 79, 96, 0.50);
  --glass-b:        rgba(26, 33, 44, 0.54);
  --glass-blur:     28px;
  --glass-sat:      200%;
  --glass-bright:   122%;
  --glass-edge:     rgba(255,255,255,0.34);   /* el canto especular */
  --glass-edge-low: rgba(255,255,255,0.07);
  --glass-border:   rgba(255,255,255,0.19);
  --glass-shadow:   0 16px 38px rgba(0,0,0,0.52);

  /* Variante densa, para lo que flota SOBRE la parrilla: detrás hay filas de
   * tiempos cambiando, y el texto no puede depender de eso. Velo más alto y
   * sin subida de brillo. */
  --glass-denso-a:    rgba(48, 57, 72, 0.86);
  --glass-denso-b:    rgba(16, 21, 28, 0.90);
  --glass-denso-blur: var(--glass-blur);

  /* La luz que el cristal recoge. Sin ella el material no se ve: un vidrio
   * sobre un fondo plano es solo un gris distinto. */
  --depth-warm: rgba(245,166,35,0.11);   /* el ámbar de StintPro */
  --depth-cool: rgba(120,170,255,0.10);
```

- [ ] **Paso 4: escribir `src/glass.css`**

```css
/* Las DOS únicas definiciones del cristal de StintPro. Todo el chrome compone
 * desde aquí: si el material cambia, cambia en este fichero y en ningún otro.
 *
 * ESTE FICHERO NO DECLARA `border` A PROPÓSITO. Cada superficie quiere un borde
 * distinto —solo el inferior en .sp-header, los cuatro en .sp-kpi, solo el
 * superior en .sp-footer— y si el material también pusiera uno, ambas reglas
 * competirían por la misma propiedad y ganaría la que quedase después en el CSS
 * final. Por eso el borde es cosa de cada consumidor, con var(--glass-border).
 *
 * `background` y `box-shadow` SÍ los declara el material —son el material— y
 * por tanto SIGUEN compitiendo con cualquier regla que quiera pisarlos. Si una
 * regla necesita pisarlos sobre el MISMO elemento (un estado "abierto", un
 * "activo"), tiene que ganar por ESPECIFICIDAD: un selector compuesto como
 * .card.abierto (0,2,0) le gana siempre a .sp-glass (0,1,0), pase lo que pase
 * con el orden del fichero.
 *
 * ORDEN DE CARGA: styles.css → panel.css → glass.css → los <style> inyectados.
 */

.sp-glass {
  background: linear-gradient(158deg, var(--glass-a), var(--glass-b));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-sat)) brightness(var(--glass-bright));
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-sat)) brightness(var(--glass-bright));
  box-shadow:
    inset 0 1px 0 var(--glass-edge),
    inset 0 -1px 0 var(--glass-edge-low),
    var(--glass-shadow);
}

/* Para lo que va ENCIMA DE LA PARRILLA: el selector de columnas y la caja de
 * los modales. Detrás hay 28 filas de tiempos cambiando varias veces por
 * segundo, así que el velo sube y se quita la subida de brillo: el texto no
 * puede depender de lo que pase por debajo. */
.sp-glass-denso {
  background: linear-gradient(158deg, var(--glass-denso-a), var(--glass-denso-b));
  -webkit-backdrop-filter: blur(var(--glass-denso-blur)) saturate(var(--glass-sat));
  backdrop-filter: blur(var(--glass-denso-blur)) saturate(var(--glass-sat));
  box-shadow:
    inset 0 1px 0 var(--glass-edge),
    var(--glass-shadow);
}
```

- [ ] **Paso 5: enlazarlo, después de `panel.css`**

En `src/index.html`, tras la línea de `panel.css`:

```html
  <link rel="stylesheet" href="glass.css">
```

Y lo mismo en `tools/panel-preview.html`:

```html
  <link rel="stylesheet" href="../src/glass.css">
```

- [ ] **Paso 6: la capa de profundidad y las superficies de chrome**

En `src/panel.css`, sustituye la regla de `#screen-dash` por:

```css
/* La luz que el cristal recoge. Fija y sin animación: es un fondo, no un efecto.
   Va aquí UNA sola vez y NUNCA repetida por componente, que es como estas cosas
   acaban costando fotogramas. */
#screen-dash{background:radial-gradient(58% 46% at 20% 6%, var(--depth-warm), transparent 70%),radial-gradient(66% 56% at 90% 94%, var(--depth-cool), transparent 70%),var(--panel-bg);display:flex;flex-direction:column;height:100vh;overflow:hidden;}
```

Y compón el material en las cuatro superficies de chrome que viven en este fichero,
cambiando su borde a `var(--glass-border)` y quitando el `background` propio, que ahora lo
pone el material:

```css
.sp-header{border-bottom:0.5px solid var(--glass-border);padding:12px 18px;flex-shrink:0;-webkit-app-region:drag;}
.sp-kpi{border-radius:8px;padding:10px 14px;border:0.5px solid var(--glass-border);}
.sp-footer{padding:7px 14px;display:flex;gap:16px;border-top:0.5px solid var(--glass-border);flex-shrink:0;}
.sp-back{font-size:12.5px;padding:4px 12px;border-radius:6px;border:0.5px solid var(--glass-border);color:var(--text-2);cursor:pointer;}
```

**No añadas `class="sp-glass"` al marcado.** Todas estas superficies tienen ya selector
propio, así que el material se les aplica **sin tocar una sola línea de los ficheros que
generan HTML**. Y para que el cuerpo del material no se escriba dos veces, va **una única
declaración** con la lista de selectores delante. Sustituye el bloque `.sp-glass` que
escribiste en el Paso 4 por este:

```css
/* La clase .sp-glass encabeza la lista porque la Tarea 3 la necesita para las
 * cajas de modal, que llevan estilo inline y no tienen selector propio. Las
 * demás se componen aquí, por selector, sin tocar el marcado. */
.sp-glass,
.sp-header, .sp-kpi, .sp-footer, .sp-back,
.en-team-card, .en-strat-card,
#screen-setup .card {
  background: linear-gradient(158deg, var(--glass-a), var(--glass-b));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-sat)) brightness(var(--glass-bright));
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-sat)) brightness(var(--glass-bright));
  box-shadow:
    inset 0 1px 0 var(--glass-edge),
    inset 0 -1px 0 var(--glass-edge-low),
    var(--glass-shadow);
}
```

`.sp-glass-denso` se queda como está: la Tarea 3 le añadirá sus selectores.

- [ ] **Paso 7: la profundidad del setup**

En `src/styles.css`, añade:

```css
/* La misma capa de profundidad que #screen-dash. El spec la ponía en .setup-root,
   pero esa clase era CSS muerto y la entrega 1 la borró: el ancla real es la
   pantalla, igual que en el panel. */
#screen-setup.active { background:radial-gradient(58% 46% at 20% 6%, var(--depth-warm), transparent 70%),radial-gradient(66% 56% at 90% 94%, var(--depth-cool), transparent 70%),var(--bg); }
```

- [ ] **Paso 8: reconciliar los dos tests de la entrega 1 que este cambio rompe**

Al quitarle el `background` a `.sp-header`, `.sp-kpi`, `.sp-back` y compañía —ahora lo pone el
material— **dos tests que la entrega 1 dejó verdes se ponen rojos**, y es correcto que lo
hagan:

- **`tests/panel-tokens.test.js`** afirma que cada una de esas superficies usa su token
  `var(--panel-*)`. Ya no lo usan.
- **`tests/panel-css.test.js`** compara los cuerpos de `panel.css` contra
  `tests/fixtures/panel-css-baseline.json`. Los cuerpos han cambiado a propósito.

**Los tokens `--panel-*` NO se borran.** Cambian de papel: dejan de pintar las superficies y
pasan a ser **el aspecto del modo ☀**, que es donde el cristal se apaga y hace falta un color
sólido (Tarea 5). Reescribe `tests/panel-tokens.test.js` para que afirme lo que ahora es
verdad — que los ocho tokens siguen declarados con sus valores exactos y que `#screen-dash`
sigue usando `var(--panel-bg)` como color de base bajo la capa de profundidad — y **borra del
array `SUPERFICIES` las entradas cuyas superficies ya no llevan token**, dejando el porqué en
un comentario:

```js
// El resto de superficies dejó de usar estos tokens al llegar el cristal: su
// fondo lo pone ahora el material (src/glass.css). Los tokens siguen vivos
// porque body.hc los usa para apagar el vidrio — ver el bloque body.hc de
// styles.css y tests/glass.test.js.
```

Y regenera la línea base, que es lo que devuelve `panel-css.test.js` al verde:

```bash
node -e "
const fs=require('fs');
const {rulesOf,extractInjectedCss}=require('./tools/css-extract');
const panel=rulesOf(fs.readFileSync('src/panel.css','utf8'));
const en=[...panel,...rulesOf(extractInjectedCss(fs.readFileSync('src/en-state.js','utf8')))];
const sp=[...panel,...rulesOf(extractInjectedCss(fs.readFileSync('src/sprint.js','utf8')))];
fs.writeFileSync('tests/fixtures/panel-css-baseline.json',JSON.stringify({endurance:en,sprint:sp},null,2)+'\n');
console.log('endurance:',en.length,'reglas · sprint:',sp.length,'reglas');
"
```

Esperado: `endurance: 95 reglas · sprint: 52 reglas`, igual que antes — esta entrega cambia
cuerpos, no añade ni quita reglas del panel. **Si el número baja, para**: has perdido una regla
por el camino.

- [ ] **Paso 9: el barrido obligatorio de `position:fixed`**

```bash
grep -rn "position:fixed\|position: fixed" src/*.js src/*.html src/*.css
```

Para **cada** superficie que acabas de dar material (`.sp-header`, `.sp-kpi`, `.sp-footer`,
`.sp-back`, `.en-team-card`, `.en-strat-card`, `.card` del setup), comprueba que ningún
`fixed` cuelga de su subárbol. Sabemos ya que `.titlebar-drag` (`setup.js:267`) es `fixed` y
está **dentro** de la raíz del setup: comprueba si cae dentro de alguna `.card` o fuera. Si
cae dentro, pásalo a `absolute` como se hizo con `.sp-session`, con su comentario.

- [ ] **Paso 10: ejecutar el test y la suite**

```bash
node tests/glass.test.js
for t in tests/*.test.js; do node "$t" >/dev/null 2>&1 && echo "✓ $(basename $t)" || echo "✗ FALLA $(basename $t)"; done
```

Esperado: `glass.test.js` en verde y ningún `FALLA`. Ojo: varios ficheros de test no imprimen
resumen en la última línea, por eso se comprueba por código de salida.

- [ ] **Paso 11: mirarlo, que es de lo que va esto**

En el banco, con la parrilla llena a `10×`: la cabecera, los KPIs y el pie deben **flotar**
sobre el fondo, con un canto claro de un píxel arriba y sombra debajo. Las filas de la
parrilla deben seguir **exactamente igual que antes**. Mira también la pestaña Equipo y la de
Estrategia, cuyas tarjetas estrenan material.

Haz una captura de los cuatro estados en
`.superpowers/sdd/2026-08-31-cristal-entrega-2-material/capturas/` y compáralas con las de la
entrega 1: **todo lo mate debe seguir idéntico**.

- [ ] **Paso 12: commit**

```bash
git add src/glass.css src/styles.css src/panel.css src/index.html tools/panel-preview.html tests/glass.test.js tests/panel-tokens.test.js tests/fixtures/panel-css-baseline.json
git commit -m "feat(cristal): el material y la capa de profundidad

El chrome del panel y del setup pasa a cristal ahumado sobre dos manchas
de luz fijas. La zona de datos sigue mate. El material vive en glass.css
y en ningún otro sitio."
```

---

### Task 3: el material denso — selector de columnas y cajas de modal

Lo que flota **sobre la parrilla**, no sobre el fondo. El selector de columnas ya tiene
selector propio; las 11 cajas de modal llevan estilo inline y estrenan clase.

**Files:**
- Modify: `src/en-state.js` (`.en-col-panel`)
- Modify: `src/app.js:31`, `src/en-advanced.js:429`, `src/en-grid.js:551,587,655`,
  `src/en-team.js:12,64,134,204,313`, `src/en-strategy.js:814`
- Modify: `tests/glass.test.js`

**Interfaces:**
- Consumes: `.sp-glass-denso` de la Tarea 2.
- Produces: la clase `sp-modal` en las 11 cajas de modal.

- [ ] **Paso 1: el selector de columnas**

En el `<style>` de `src/en-state.js`, `.en-col-panel` pierde su fondo y su sombra propios —los
pone el material— y su borde pasa a `var(--glass-border)`:

```css
    .en-col-panel{position:absolute;z-index:50;top:30px;left:0;border:0.5px solid var(--glass-border);border-radius:10px;padding:10px 12px;display:flex;gap:18px;}
```

Y en `src/glass.css`, añade `.en-col-panel` a la lista de selectores de `.sp-glass-denso`.

**Por qué el denso y no el normal:** este panel se abre encima de la parrilla de tiempos. Con
el material normal, detrás habría filas cambiando varias veces por segundo y los nombres de
columna competirían con ellas.

- [ ] **Paso 2: las 11 cajas de modal**

Cada una de estas líneas contiene un `<div style="background:…;border:…;border-radius:…px;…">`
que es la caja del modal. **Añade `class="sp-modal"` y quita de su `style` inline el
`background`, el `border` y el `box-shadow` si lo tiene** — el resto (anchos, padding,
`text-align`) se queda:

| Fichero:línea | Fondo que tenía hoy |
|---|---|
| `src/app.js:31` | `#13141a`, radio 16px |
| `src/en-advanced.js:429` | `#1a1b22`, radio 12px |
| `src/en-grid.js:551` | `#1a1b22`, radio 12px |
| `src/en-grid.js:587` | `#1a1b22`, radio 12px |
| `src/en-grid.js:655` | `#0e0f11`, radio 10px |
| `src/en-team.js:12` | `#1a1b22`, radio 12px |
| `src/en-team.js:64` | `#13141a`, radio 12px |
| `src/en-team.js:134` | `#1a1b22`, radio 12px |
| `src/en-team.js:204` | `#1a1b22`, radio 12px |
| `src/en-team.js:313` | `#1a1b22`, radio 12px |
| `src/en-strategy.js:814` | `#13141a`, radio 12px |

Los números de línea son de cuando se escribió este plan: **verifica cada uno** antes de
editar, porque tus propias ediciones los desplazan. El patrón fiable es buscar el
`overlay.innerHTML` que sigue a cada `overlay.style.cssText='position:fixed;inset:0…`.

**No toques el velo negro** (`rgba(0,0,0,0.7)` del propio `overlay`): el spec es explícito en
que el material va en la caja, no en el velo.

En `src/glass.css`, añade `.sp-modal` a la lista de `.sp-glass-denso`, y dale el borde y el
radio que el inline ya no pone:

```css
.sp-modal { border:0.5px solid var(--glass-border); border-radius:12px; }
```

`src/app.js:31` tenía radio 16px y `src/en-grid.js:655` radio 10px: si quieres conservarlos,
déjalos en su `style` inline, que gana al `.sp-modal` por ser inline.

- [ ] **Paso 3: ampliar el test**

Añade a `tests/glass.test.js` un grupo nuevo:

```js
group('lo que flota sobre datos lleva el material denso', () => {
  test('las 11 cajas de modal llevan class="sp-modal"', () => {
    const ficheros = ['app.js','en-advanced.js','en-grid.js','en-team.js','en-strategy.js'];
    let cajas = 0;
    for (const f of ficheros) cajas += (leer('src/' + f).match(/class="sp-modal"/g) || []).length;
    strictEqual(cajas, 11, `esperaba 11 cajas con sp-modal, encontré ${cajas}`);
  });
  test('ninguna caja de modal conserva un fondo sólido inline', () => {
    const ficheros = ['app.js','en-advanced.js','en-grid.js','en-team.js','en-strategy.js'];
    for (const f of ficheros) {
      const src = leer('src/' + f);
      const m = src.match(/class="sp-modal"[^>]*style="[^"]*background:#[0-9a-fA-F]{3,6}/);
      strictEqual(m, null, `${f} tiene una caja sp-modal con background inline: ${m && m[0]}`);
    }
  });
  test('.sp-glass-denso lo componen el selector de columnas y las cajas de modal', () => {
    const regla = rulesOf(glass).find(r => r.selector.includes('.sp-glass-denso'));
    strictEqual(/\.en-col-panel/.test(regla.selector), true);
    strictEqual(/\.sp-modal/.test(regla.selector), true);
  });
});
```

- [ ] **Paso 4: ejecutar los tests**

```bash
node tests/glass.test.js
for t in tests/*.test.js; do node "$t" >/dev/null 2>&1 && echo "✓ $(basename $t)" || echo "✗ FALLA $(basename $t)"; done
```

- [ ] **Paso 5: abrir los 11 modales a mano**

Este es el paso que no se puede saltar: **cada uno de los 11 modales hay que abrirlo y
mirarlo**. En el banco, con la parrilla llena: clic en un piloto (ficha), clic en un dorsal,
el selector de columnas, la pestaña Equipo (cambio de piloto, historial de stints, borrar
stint), la pestaña Estrategia y la pestaña Avanzado.

Lo que buscas: que el texto se lea **sobre las filas de tiempos que hay detrás**, que la caja
tenga su canto claro arriba, y que no se salga de la pantalla. Si alguno no se lee, **sube
`--glass-denso-a`/`-b`, nunca bajes el umbral de nada.**

Si algún modal no consigues abrirlo desde el banco, dilo en el informe en vez de darlo por
bueno.

- [ ] **Paso 6: barrido de `position:fixed` en los subárboles nuevos**

Los overlays cuelgan de `document.body`, pero ahora la **caja** lleva `backdrop-filter`: si
alguna caja contiene un descendiente `fixed`, se romperá. Compruébalo.

- [ ] **Paso 7: commit**

```bash
git add src/glass.css src/en-state.js src/app.js src/en-advanced.js src/en-grid.js src/en-team.js src/en-strategy.js tests/glass.test.js
git commit -m "feat(cristal): material denso para lo que flota sobre la parrilla

El selector de columnas y las 11 cajas de modal estrenan la variante
densa: detrás hay filas de tiempos cambiando y el texto no puede
depender de eso."
```

---

### Task 4: el contraste, con el test que lo vigila

El material sube el brillo del fondo, y eso **baja** el contraste del texto secundario.
Medido: `--text-3` pasa de 4,52:1 sobre `--bg-card` a **3,30:1** compuesto sobre el cristal.

**Files:**
- Create: `tests/contrast.test.js`
- Modify: `src/styles.css` (`--text-3`)

**Interfaces:**
- Consumes: los tokens `--glass-*` y `--depth-*` de la Tarea 2.
- Produces: `--text-3: #9aa5b4`.

- [ ] **Paso 1: escribir el test que falla**

`tests/contrast.test.js`:

```js
// StintPro — contraste del texto secundario compuesto sobre el cristal.
// Compone la capa de profundidad y el material sobre el fondo, y exige 4.5:1.
// SI ESTE TEST SE PONE ROJO, SE AJUSTA EL MATERIAL — EL UMBRAL NO SE TOCA.
// Ejecutar: node tests/contrast.test.js
'use strict';

const fs = require('fs');
const path = require('path');
const { ok } = require('assert/strict');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');

// Lee un token del :root tal cual está escrito.
function token(nombre) {
  const m = styles.match(new RegExp(`${nombre}\\s*:\\s*([^;]+);`));
  if (!m) throw new Error(`el token ${nombre} no está declarado en :root`);
  return m[1].trim();
}

function hex(c) {
  const s = c.replace('#', '');
  const n = s.length === 3 ? s.split('').map(x => x + x).join('') : s;
  return [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16));
}
function rgba(c) {
  const m = c.match(/rgba?\(([^)]+)\)/);
  const p = m[1].split(',').map(x => parseFloat(x.trim()));
  return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 };
}
// Composición alfa estándar: `sobre` con opacidad `a` encima de `debajo`.
function componer(debajo, sobre, a) {
  return debajo.map((c, i) => c * (1 - a) + sobre[i] * a);
}
function brillo(rgb, f) { return rgb.map(c => Math.min(255, c * f)); }
function saturar(rgb, f) {
  const L = 0.213 * rgb[0] + 0.715 * rgb[1] + 0.072 * rgb[2];
  return rgb.map(c => Math.max(0, Math.min(255, L + (c - L) * f)));
}
function luminancia(rgb) {
  const l = rgb.map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
}
function contraste(a, b) {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// El peor píxel real: el punto más claro de la capa de profundidad (la mancha
// ámbar), que es donde el cristal recoge más luz y el texto menos contraste.
function superficieDelCristal({ densa }) {
  const fondo = hex(token('--bg'));
  const calida = rgba(token('--depth-warm'));
  let detras = componer(fondo, calida.rgb, calida.a);

  // backdrop-filter se aplica al FONDO, antes de pintar el velo encima.
  detras = saturar(detras, parseFloat(token('--glass-sat')) / 100);
  if (!densa) detras = brillo(detras, parseFloat(token('--glass-bright')) / 100);

  // El velo: se toma la parada MÁS CLARA del degradado, que es la peor.
  const velo = rgba(token(densa ? '--glass-denso-a' : '--glass-a'));
  return componer(detras, velo.rgb, velo.a);
}

console.log('\ncontraste del texto secundario sobre el material');
for (const densa of [false, true]) {
  const nombre = densa ? 'material denso' : 'material normal';
  test(`--text-3 alcanza 4.5:1 sobre el ${nombre}`, () => {
    const c = contraste(hex(token('--text-3')), superficieDelCristal({ densa }));
    ok(c >= 4.5, `${c.toFixed(2)}:1 sobre el ${nombre} — ajusta el MATERIAL, no el umbral`);
  });
}

console.log('\nel texto principal no puede estar peor que el secundario');
test('--text-1 supera a --text-3', () => {
  const s = superficieDelCristal({ densa: false });
  const c1 = contraste(hex(token('--text-1')), s);
  const c3 = contraste(hex(token('--text-3')), s);
  ok(c1 > c3, `--text-1 da ${c1.toFixed(2)} y --text-3 da ${c3.toFixed(2)}`);
});

console.log(`\n${passed} pasados, ${failed} fallidos`);
process.exit(failed ? 1 : 0);
```

- [ ] **Paso 2: ejecutarlo para verificar que falla**

Run: `node tests/contrast.test.js`
Esperado: FALLA en el material normal con un valor **alrededor de 3,3:1** y el mensaje
`ajusta el MATERIAL, no el umbral`. Si falla por otra razón (un token que no encuentra), es un
fallo del test, no del material: arréglalo.

- [ ] **Paso 3: aclarar el token**

En `src/styles.css`, dentro de `:root`:

```css
  --text-3:     #9aa5b4;
```

Y deja el porqué escrito justo encima:

```css
  /* Aclarado de #7878a0 a #9aa5b4 al llegar el cristal: el material sube el
   * brillo del fondo y el texto secundario caía a 3,30:1. NO se arregla
   * oscureciendo el vidrio —la parada culpable es la clara, y ni al 100 % de
   * opacidad se alcanza el umbral—, se arregla aclarando el texto. Es el mismo
   * valor al que llegó Track Engineer. Lo vigila tests/contrast.test.js. */
```

- [ ] **Paso 4: ejecutar y verificar que pasa**

Run: `node tests/contrast.test.js`
Esperado: `3 pasados, 0 fallidos`, con el material normal alrededor de **5,5:1**.

Si el material **denso** no llega a 4.5, sube `--glass-denso-a` y `--glass-denso-b` hasta que
llegue. **No bajes el umbral y no aclares más `--text-3` de lo necesario**: aclararlo de más
apaga la jerarquía entre texto principal y secundario.

- [ ] **Paso 5: mirar que el número se corresponde con la realidad**

Un test que compone capas a mano puede estar de acuerdo consigo mismo y equivocado. En el
banco, mira el texto secundario real: las etiquetas de los KPI, el `tiempo restante` bajo el
reloj, los textos del pie. Deben leerse con holgura sobre el cristal.

- [ ] **Paso 6: commit**

```bash
git add src/styles.css tests/contrast.test.js
git commit -m "feat(cristal): aclara --text-3 y añade el test de contraste

El material sube el brillo del fondo y el texto secundario caía a
3,30:1. Se arregla aclarando el token, no oscureciendo el vidrio.
El test compone las capas y exige 4.5:1; si se pone rojo se ajusta
el material, nunca el umbral."
```

---

### Task 5: `body.hc` apaga el cristal

El modo ☀ Contraste es el refugio para sol directo. Con el cristal encendido tiran en
direcciones opuestas, así que en `hc` el material se apaga: superficies opacas, sin desenfoque.

**Files:**
- Modify: `src/styles.css` (bloque `body.hc`)
- Modify: `tests/glass.test.js`

**Interfaces:**
- Consumes: los tokens `--glass-*` y `--depth-*` de la Tarea 2.
- Produces: nada que consuman otras tareas.

- [ ] **Paso 1: escribir el test que falla**

Añade a `tests/glass.test.js`:

```js
group('el modo ☀ apaga el cristal', () => {
  const hc = (styles.match(/body\.hc\s*\{([^}]*)\}/) || [])[1] || '';
  test('body.hc pone el desenfoque a 0', () => {
    strictEqual(/--glass-blur\s*:\s*0/.test(hc), true, 'body.hc no anula --glass-blur');
  });
  test('body.hc apunta las cuatro paradas del material a un color sólido', () => {
    // En hc el material se apaga apuntando sus paradas a los tokens --panel-*,
    // que son hex opacos. Así el modo contraste reutiliza el trabajo de la
    // entrega 1 en vez de traer colores nuevos.
    for (const t of ['--glass-a', '--glass-b', '--glass-denso-a', '--glass-denso-b']) {
      const m = hc.match(new RegExp(`${t}\\s*:\\s*([^;]+);`));
      strictEqual(m !== null, true, `body.hc no redefine ${t}`);
      strictEqual(/var\(--panel-/.test(m[1]), true,
        `${t} en hc vale ${m[1]}, debería apuntar a un token --panel-*`);
    }
  });
  test('los tokens --panel-* que usa hc son hex opacos en el propio bloque hc', () => {
    for (const t of ['--panel-surface', '--panel-inset', '--panel-line']) {
      strictEqual(new RegExp(`${t}\\s*:\\s*#[0-9a-fA-F]{3,6}`).test(hc), true,
        `body.hc no redefine ${t} con un hex opaco`);
    }
  });
  test('body.hc apaga también la capa de profundidad', () => {
    for (const t of ['--depth-warm', '--depth-cool']) {
      strictEqual(new RegExp(`${t}\\s*:\\s*transparent`).test(hc), true,
        `body.hc no apaga ${t}`);
    }
  });
});
```

- [ ] **Paso 2: ejecutarlo para verificar que falla**

Run: `node tests/glass.test.js`
Esperado: FALLA en los tres tests del grupo nuevo.

- [ ] **Paso 3: los overrides**

En `src/styles.css`, dentro del bloque `body.hc` que ya existe:

```css
  /* El cristal se APAGA en modo contraste. El vidrio y el alto contraste tiran
   * en direcciones opuestas, y este modo es el refugio garantizado para sol
   * directo en el circuito: no se le pide al material que aguante el peor caso,
   * se le quita de en medio. Superficies opacas, sin desenfoque, sin luz de
   * fondo que recoger. */
  --glass-blur:     0px;
  --glass-a:        var(--panel-surface);
  --glass-b:        var(--panel-surface);
  --glass-denso-a:  var(--panel-inset);
  --glass-denso-b:  var(--panel-inset);
  --glass-edge:     rgba(255,255,255,0.10);
  --glass-edge-low: transparent;
  --glass-border:   var(--panel-line);
  --glass-shadow:   none;
  --depth-warm:     transparent;
  --depth-cool:     transparent;
  /* Y los propios --panel-* suben a los valores de alto contraste. Este es el
   * papel que les queda tras el cristal: ya no pintan el panel en modo normal,
   * pintan el refugio de sol directo. */
  --panel-surface:  #1A1E2E;
  --panel-inset:    #111420;
  --panel-line:     #3A4460;
```

Los valores opacos son los `--bg-raised` y `--bg-card` que el propio `body.hc` ya define, para
que el modo contraste siga viéndose como se veía antes del cristal.

- [ ] **Paso 4: ejecutar y verificar que pasa**

```bash
node tests/glass.test.js && node tests/contrast.test.js
```

- [ ] **Paso 5: verlo, que es el punto**

En el banco, pulsa **☀ Contraste** (el botón que montó la Tarea 1) y luego vuelve a pulsarlo.

Esperado: con ☀ activo, **el cristal desaparece por completo** —fondos sólidos, sin
desenfoque, sin manchas de luz— y el panel se parece al de antes de esta entrega pero con los
textos más claros. Al desactivarlo, vuelve el vidrio. Hazlo en los dos modos, endurance y
sprint.

**Esto es un cambio de comportamiento visible y deliberado:** antes de la entrega 1 el botón
☀ apenas afectaba al panel. Ahora sí.

- [ ] **Paso 6: commit**

```bash
git add src/styles.css tests/glass.test.js
git commit -m "feat(cristal): el modo ☀ Contraste apaga el material

Superficies opacas, sin desenfoque y sin capa de profundidad. El modo
contraste sigue siendo el refugio garantizado para sol directo, así que
no se le pide al vidrio que aguante el peor caso."
```

---

### Task 6: la palanca de rendimiento

El reparto deja fuera del cristal lo que más repinta —las 28 filas y `.sp-lapbar`, que va a
100 ms—, pero el reloj y los KPIs viven dentro de `.sp-header`, que sí lo lleva: cada
escritura obliga a recalcular el desenfoque de esa franja. En Track Engineer 28px aguantaron
sobre vídeo a 30 fps, así que el riesgo es bajo — pero *bajo* no es *medido*.

**Files:**
- Modify: `src/glass.css`
- Modify: `tests/glass.test.js`

**Interfaces:**
- Consumes: el material de la Tarea 2.
- Produces: nada que consuman otras tareas.

- [ ] **Paso 1: medirlo antes de decidir nada**

En el banco, con la parrilla llena y el replay a `10×` (que es el caso más exigente: más
mensajes por segundo que una carrera real), abre las herramientas de rendimiento del navegador
y graba unos segundos. Anota en el informe: **fotogramas por segundo y tiempo de pintado**.
Repite con el modo ☀ activo, que apaga el desenfoque, para tener la referencia sin cristal.

Si la diferencia es imperceptible, dilo y **no cambies nada más que el paso 2**. Si hay
tirones, dilo con los números.

- [ ] **Paso 2: la palanca para pantallas pequeñas**

Es donde más cuesta el desenfoque y donde ya existe una media query. En `src/glass.css`, al
final:

```css
/* Pantallas pequeñas (el iPad que a veces se lleva al muro). El desenfoque es
 * lo que más cuesta de este material y es lo primero que se quita si hace falta:
 * lo que hace que esto se lea como vidrio son el canto y la sombra, no el blur.
 * Este @media vive en el MISMO fichero que las reglas que redeclara — la entrega 1
 * se llevó una regresión por saltarse esa norma, y tests/panel-css.test.js la vigila. */
@media (max-width:900px) {
  :root { --glass-blur: 14px; }
}
```

- [ ] **Paso 3: el test de la palanca**

Añade a `tests/glass.test.js`:

```js
group('la palanca de rendimiento', () => {
  test('glass.css baja el desenfoque en pantallas pequeñas', () => {
    const m = glass.match(/@media\s*\(max-width:\s*900px\)\s*\{([\s\S]*?)\}\s*\}/);
    strictEqual(m !== null, true, 'no hay @media (max-width:900px) en glass.css');
    strictEqual(/--glass-blur\s*:/.test(m[1]), true, 'el @media no toca --glass-blur');
  });
});
```

- [ ] **Paso 4: ejecutar los tests y mirar a 834 px**

```bash
node tests/glass.test.js
```

Y en el banco, con `resize_window` a **834 px** de ancho (iPad vertical): el cristal debe
seguir viéndose como vidrio —canto y sombra intactos— solo que con menos desenfoque. Comprueba
además que las columnas de la parrilla siguen exactamente como las dejó la entrega 1.

- [ ] **Paso 5: commit**

```bash
git add src/glass.css tests/glass.test.js
git commit -m "perf(cristal): baja el desenfoque en pantallas pequeñas

El blur es lo que más cuesta del material y lo primero que se quita:
lo que lo hace parecer vidrio son el canto y la sombra."
```

---

### Task 7: verificación final y cierre

**Files:**
- Modify: `docs/superpowers/specs/2026-08-31-stintpro-liquid-glass-design.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: la entrega lista para que Javier decida.

- [ ] **Paso 1: corregir el spec con lo que se aprendió**

Tres puntos donde el spec quedó desfasado; corrígelos citando el porqué:

1. **§4** pone la capa de profundidad en `.setup-root`, que no existe: es `#screen-setup`.
2. **§5** habla de "la caja de los 14 modales" como una superficie: son **11 cajas** con
   estilo inline en 5 ficheros, que ahora llevan `class="sp-modal"`.
3. **§5** lista 9 superficies con un solo material: son **dos materiales**, y `.en-col-panel`
   y las cajas de modal llevan el denso porque flotan sobre la parrilla.

- [ ] **Paso 2: la suite completa**

```bash
for t in tests/*.test.js; do node "$t" >/dev/null 2>&1 && echo "✓ $(basename $t)" || echo "✗ FALLA $(basename $t)"; done
```

Esperado: ningún `FALLA` en los 14 ficheros. Si alguno falla, **no sigas**.

- [ ] **Paso 3: barrido final de `position:fixed`**

```bash
grep -rn "position:fixed\|position: fixed" src/*.js src/*.html src/*.css
```

Ninguno puede colgar del subárbol de una superficie con material. Anota el resultado en el
mensaje del commit.

- [ ] **Paso 4: la verificación visual completa**

En el banco, los cuatro estados (endurance/sprint × normal/☀), con la parrilla llena a `10×`.
Y estas ocho comprobaciones:

1. Cabecera, KPIs y pie flotan con canto y sombra.
2. Las filas de la parrilla, los colores de dorsal y el degradado ámbar de tu fila: **idénticos
   a antes**.
3. Las pestañas Equipo y Estrategia, con sus tarjetas.
4. El selector de columnas abierto sobre la parrilla: se lee.
5. Al menos cuatro de los 11 modales, abiertos y cerrados.
6. El nombre de la sesión sigue centrado en la cabecera.
7. ☀ apaga el cristal por completo, y al volver a pulsarlo vuelve.
8. A 834 px de ancho: menos desenfoque, mismo aspecto de vidrio, columnas intactas.

- [ ] **Paso 5: commit de cierre**

```bash
git add docs/superpowers/specs/2026-08-31-stintpro-liquid-glass-design.md
git commit -m "docs(spec): corrige el spec del cristal con lo aprendido al aplicarlo"
```

- [ ] **Paso 6: informar, y NO desplegar**

Resume para Javier: los commits, el resultado de la suite, los números de rendimiento, qué se
verificó a ojo y qué no. Di explícitamente que **no se ha hecho push**, y recuérdale que en
este repo el push a `main` **es** el despliegue. Recuérdale también que esto no debería salir
a producción en semana de carrera.

---

## Notas para quien ejecute esto

- **El material se declara UNA vez.** Si te ves copiando el bloque de `backdrop-filter` a un
  segundo sitio, para: añade el selector a la lista que ya existe en `glass.css`.
- **Si algo no se lee, el material se ajusta al umbral, nunca al revés.** Ni bajes el 4.5 del
  test de contraste ni aclares `--text-3` más de lo que haga falta.
- **La zona de datos no se toca.** Son 28 filas repintando durante cuatro horas y son el dato
  por el que se llama a boxes.
- **El banco no es la app.** `src/index.html` exige sesión de Supabase; solo Javier puede
  abrirlo. Que el banco esté bien no demuestra que la app lo esté.
