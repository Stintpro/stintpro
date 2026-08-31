# Estética de cristal · Entrega 1 (fontanería) — plan de implementación

> **Para agentes:** SUB-SKILL OBLIGATORIA: usa `superpowers:subagent-driven-development`
> (recomendado) o `superpowers:executing-plans` para ejecutar este plan tarea a tarea.
> Los pasos usan casillas (`- [ ]`) para el seguimiento.

**Goal:** dejar el CSS de StintPro listo para recibir el cristal —sin que cambie **ni un
píxel** de lo que se ve hoy.

**Architecture:** el chrome compartido de los dos modos de panel (endurance y sprint) sale de
los `<style>` inyectados desde JS y pasa a un `src/panel.css` real; las superficies que en la
entrega 2 estrenarán cristal pasan a tokens **con sus valores actuales exactos**; `.sp-session`
deja de ser `position:fixed`; y se borra el CSS huérfano de `styles.css`. Todo el trabajo
está protegido por tests que comparan contra una línea base capturada antes de tocar nada.

**Tech Stack:** JavaScript de navegador sin build ni bundler. Tests: `node tests/x.test.js`
con `assert/strict`, sin dependencias. Despliegue: estático en Vercel sirviendo `src/`.

**Spec:** `docs/superpowers/specs/2026-08-31-stintpro-liquid-glass-design.md`

## Global Constraints

- **Criterio de éxito de toda la entrega: que no cambie nada visualmente.** Cualquier
  diferencia visible es un fallo, no una mejora.
- **El cristal NO entra en esta entrega.** Nada de `backdrop-filter`, `glass.css`, capa de
  profundidad ni `--text-3: #9aa5b4`. Eso es la entrega 2.
- **Los overrides de `body.hc` tampoco entran.** Esta entrega solo *habilita* que el modo ☀
  pueda funcionar en el panel; encenderlo es entrega 2. Los tokens que se creen aquí valen
  exactamente lo que valen los hex que sustituyen.
- **Orden de cascada, invariable:** `styles.css` → `panel.css` → los `<style>` inyectados desde
  JS (que se añaden al `<head>` en tiempo de ejecución y siguen ganando).
- **No se toca** el contraste de `.en-thead span` (`#333`) ni el de `.sp-fl` (`#2d2f38`): se
  restauran tal cual. Arreglarlos es una decisión aparte.
- **No se toca** disposición, tipografía, tamaños ni espaciado.
- **Rama `estetica-cristal`.** `main` se queda desplegable en todo momento.
- **Nada se despliega.** El trabajo termina en "verificado en local". El `git push` a `main`
  que dispara Vercel lo decide y lo confirma Javier, y no se da por hecho en ningún paso.
- Todo el texto de código, comentarios y commits, **en español**, como el resto del repo.

## Estructura de ficheros

| Fichero | Responsabilidad |
|---|---|
| `tools/css-extract.js` (nuevo) | Extraer y normalizar reglas CSS, tanto de un `.css` como del `<style>` incrustado en un `.js`. Lo usan los tests y el detector. |
| `tools/find-dead-css.js` (nuevo) | Listar las reglas de `styles.css` que ningún `.js`/`.html` usa. |
| `tools/panel-preview.html` (nuevo) | Banco de pruebas local: monta el panel con la carrera de demo, sin Supabase ni login. **No se despliega** (Vercel sirve solo `src/`). |
| `tests/fixtures/panel-css-baseline.json` (nuevo) | Foto de todas las reglas del chrome antes del refactor. Es la referencia de "no se ha perdido nada". |
| `tests/panel-css.test.js` (nuevo) | Invariantes del refactor: nada perdido, nada duplicado. |
| `tests/dead-css.test.js` (nuevo) | Tests del detector de CSS muerto. |
| `src/panel.css` (nuevo) | Las 39 reglas de chrome compartidas por los dos modos, tokenizadas. |
| `src/index.html` | Añadir el `<link>` a `panel.css` en el orden correcto. |
| `src/en-state.js:140-252` | Su `<style>` se queda solo con lo específico de endurance. |
| `src/sprint.js:26-80` | Su `<style>` se queda solo con lo específico de sprint. |
| `src/styles.css` | Nuevos tokens del panel; borrado del CSS huérfano. |

---

### Task 1: Banco de pruebas local y línea base

Sin esto no se puede afirmar que nada ha cambiado. `src/index.html` no sirve: exige sesión de
Supabase y redirige a `landing.html`. El banco carga los mismos scripts, salta la
autenticación y arranca la carrera de demo que ya existe en el repo.

**Files:**
- Create: `tools/panel-preview.html`
- Create: `tools/css-extract.js`
- Create: `tests/fixtures/panel-css-baseline.json`

**Interfaces:**
- Consumes: nada.
- Produces: `tools/css-extract.js` exporta
  `rulesOf(cssSource) -> Array<{selector: string, body: string}>`,
  `extractInjectedCss(jsSource) -> string` y `selectorsOf(cssSource) -> Array<string>`.
  Las tareas 3, 4 y 5 dependen de estas tres funciones.

- [ ] **Paso 1: crear la rama**

```bash
cd "/Users/javiercoy/Documentos Locales/KARTING STRATEGY/karting-v10"
git switch -c estetica-cristal
```

- [ ] **Paso 2: escribir `tools/css-extract.js`**

```js
// Extrae y normaliza reglas CSS. Lo usan los tests del refactor del panel y el
// detector de CSS muerto. Sin dependencias: este repo no tiene build.
'use strict';

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function squash(s) {
  return s.replace(/\s+/g, ' ').trim();
}

// Devuelve [{selector, body}] en orden de aparición. Las at-rules (@media,
// @keyframes) se devuelven como UNA entrada cuyo body es su bloque entero: no
// necesitamos mirar dentro, solo saber que no se pierde ni se duplica.
function rulesOf(cssSource) {
  const css = stripComments(cssSource);
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open === -1) break;
    const prelude = squash(css.slice(i, open));
    let depth = 1, j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }
    const body = squash(css.slice(open + 1, j - 1));
    if (prelude) out.push({ selector: prelude, body });
    i = j;
  }
  return out;
}

// Saca el contenido de `s.textContent=\`...\`;` de en-state.js / sprint.js.
function extractInjectedCss(jsSource) {
  const start = jsSource.indexOf('s.textContent=`');
  if (start === -1) throw new Error('no se encontró el bloque s.textContent=`…`');
  const from = start + 's.textContent=`'.length;
  const end = jsSource.indexOf('`;', from);
  if (end === -1) throw new Error('el bloque s.textContent=`…` no está cerrado');
  return jsSource.slice(from, end);
}

function selectorsOf(cssSource) {
  return rulesOf(cssSource).map(r => r.selector);
}

module.exports = { rulesOf, extractInjectedCss, selectorsOf, squash, stripComments };
```

- [ ] **Paso 3: generar la línea base ANTES de tocar nada**

```bash
node -e "
const fs=require('fs');
const {rulesOf,extractInjectedCss}=require('./tools/css-extract');
const en=extractInjectedCss(fs.readFileSync('src/en-state.js','utf8'));
const sp=extractInjectedCss(fs.readFileSync('src/sprint.js','utf8'));
fs.mkdirSync('tests/fixtures',{recursive:true});
fs.writeFileSync('tests/fixtures/panel-css-baseline.json',
  JSON.stringify({endurance:rulesOf(en),sprint:rulesOf(sp)},null,2));
console.log('endurance:',rulesOf(en).length,'reglas · sprint:',rulesOf(sp).length,'reglas');
"
```

Esperado: `endurance: 111 reglas · sprint: 53 reglas`. Si los números no salen, **para**: el
extractor no está viendo lo que crees.

- [ ] **Paso 4: escribir `tools/panel-preview.html`**

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>StintPro · banco de pruebas del panel</title>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Inter:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="../src/styles.css">
  <!-- A partir de la tarea 4 se añade aquí: <link rel="stylesheet" href="../src/panel.css"> -->
</head>
<body>
  <div id="screen-setup" class="screen"></div>
  <div id="screen-dash" class="screen"></div>

  <script>
    // Suplantamos lo que index.html obtiene de Supabase. El banco NO se
    // despliega: vercel.json sirve outputDirectory "src", y esto vive en tools/.
    window._spUserRole = 'admin';
    window._spRolePromise = Promise.resolve('admin');
    window.supabaseClient = { auth: { getSession: () => Promise.resolve({ data: { session: null } }) } };
    window.AppState = { config: {} };
  </script>

  <script src="../src/circuits.js"></script>
  <script src="../src/state.js"></script>
  <script src="../src/clock.js"></script>
  <script src="../src/apex-protocol.js"></script>
  <script src="../src/apex-connector.js"></script>
  <script src="../src/logger-connector.js"></script>
  <script src="../src/replay-connector.js"></script>
  <script src="../src/helpers.js"></script>
  <script src="../src/analysis.js"></script>
  <script src="../src/sprint.js"></script>
  <script src="../src/en-state.js"></script>
  <script src="../src/en-stint-machine.js"></script>
  <script src="../src/en-persist.js"></script>
  <script src="../src/en-columns.js"></script>
  <script src="../src/en-grid.js"></script>
  <script src="../src/en-advanced.js"></script>
  <script src="../src/en-team.js"></script>
  <script src="../src/en-strategy.js"></script>
  <script src="../src/en-ai-engineer.js"></script>
  <script src="../src/en-ai-alerts.js"></script>

  <script>
    // ?modo=sprint para el otro panel · ?hc=1 para el modo alto contraste
    const q = new URLSearchParams(location.search);
    if (q.get('hc') === '1') document.body.classList.add('hc');
    const esSprint = q.get('modo') === 'sprint';

    const cfg = {
      name: esSprint ? 'Banco · Sprint' : 'Banco · Endurance',
      raceType: esSprint ? 'sprint' : 'endurance',
      simMode: false, _noPersist: true,
      stintMin: 10, stintMax: 45, stops: 0, pitMinTime: 3,
      myDorsal: '1', nKarts: 4, pitLayout: 'libre',
      slug: 'replay', port: null, trackDirection: null, pilotos: [], duration: 0
    };

    (async () => {
      await window.ReplayConnector.loadUrl('../src/demo/demo-race.ndjson');
      window.ReplayConnector.loopMode = true;
      window.ReplayConnector.speed = 1;
      window.ApexConnector = window.ReplayConnector;
      window.AppState.config = cfg;
      if (esSprint) window.showSprintDashboard(cfg);
      else window.showEnduranceDashboard(cfg);
      window.ReplayConnector.connect('replay', d => window.ApexConnector.onData && window.ApexConnector.onData(d));
    })();
  </script>
</body>
</html>
```

- [ ] **Paso 5: arrancar el banco y comprobar que pinta**

Usa `preview_start` con una entrada de `.claude/launch.json` que sirva la raíz del repo
(`python3 -m http.server 8765`), y abre `http://localhost:8765/tools/panel-preview.html`.
**Nunca** lances el servidor con Bash.

Esperado: el panel de endurance con la parrilla de la carrera de demo rellenándose, el reloj
corriendo y los 5 KPIs con datos. Si el `connect` final no encaja con la firma real de
`ReplayConnector.connect(slug, onData, onStatus, onComment, port)`, **ajústalo aquí**: lee
`src/replay-connector.js` y pásale los callbacks que espera. Es el único punto del banco que
puede necesitar retoque.

- [ ] **Paso 6: capturar la línea base visual — los cuatro estados**

Con el banco abierto, captura y guarda en el scratchpad de la sesión:

1. `endurance-normal` — `/tools/panel-preview.html`
2. `endurance-hc` — `/tools/panel-preview.html?hc=1`
3. `sprint-normal` — `/tools/panel-preview.html?modo=sprint`
4. `sprint-hc` — `/tools/panel-preview.html?modo=sprint&hc=1`

Estas cuatro capturas son la referencia contra la que se compara al final de cada tarea.

- [ ] **Paso 7: commit**

```bash
git add tools/css-extract.js tools/panel-preview.html tests/fixtures/panel-css-baseline.json
git commit -m "test(panel): banco de pruebas local y línea base del CSS del panel"
```

---

### Task 2: `.sp-session` deja de ser `position: fixed`

El único cambio de comportamiento CSS de la entrega, y el que desactiva la trampa del
`backdrop-filter` antes de que exista el cristal. Va primero porque es pequeño, independiente
y su verificación es puramente visual.

**Files:**
- Modify: `src/en-state.js:146`
- Modify: `src/sprint.js:32`

**Interfaces:**
- Consumes: el banco de la tarea 1.
- Produces: nada que consuman otras tareas.

- [ ] **Paso 1: entender por qué es equivalente**

La regla actual, idéntica en los dos ficheros:

```css
.sp-session{font-size:12.5px;color:var(--text-3);font-family:sans-serif;position:fixed;left:0;right:0;text-align:center;pointer-events:none;}
```

Es hija de `.sp-topbar`, que ya es `position:relative`. No declara `top` ni `bottom`, así que
usa su posición estática, y eso no cambia entre `fixed` y `absolute`. En horizontal,
`left:0;right:0` pasa de abarcar la ventana a abarcar la caja de `.sp-topbar`; como
`.sp-header` tiene `padding:12px 18px` —simétrico— el centro es el mismo, y el texto va
centrado. Resultado visual idéntico; deja de depender de quién sea su bloque contenedor.

- [ ] **Paso 2: cambiar las dos reglas**

En `src/en-state.js:146` y en `src/sprint.js:32`, sustituye `position:fixed` por
`position:absolute` y añade el comentario, dejando el resto de la declaración intacta:

```css
    /* absolute, no fixed: en cuanto .sp-header estrene backdrop-filter (entrega 2)
       se convertiría en bloque contenedor de los fixed que cuelgan de él y este
       cartel dejaría de centrarse contra la ventana. .sp-topbar ya es relative y
       el padding de .sp-header es simétrico, así que el centro no se mueve. */
    .sp-session{font-size:12.5px;color:var(--text-3);font-family:sans-serif;position:absolute;left:0;right:0;text-align:center;pointer-events:none;}
```

- [ ] **Paso 3: verificar en el banco, los dos modos**

Recarga `/tools/panel-preview.html` y `/tools/panel-preview.html?modo=sprint`.

Esperado: el nombre de la sesión sigue **exactamente** donde estaba, centrado en la cabecera,
sin saltos verticales ni horizontales. Compara con las capturas de la tarea 1.

- [ ] **Paso 4: commit**

```bash
git add src/en-state.js src/sprint.js
git commit -m "fix(panel): .sp-session pasa de fixed a absolute

Prepara la llegada del cristal: un ancestro con backdrop-filter se
convierte en bloque contenedor de sus descendientes fixed, y este
cartel dejaría de centrarse contra la ventana. Sin cambio visual:
.sp-topbar ya es relative y el padding de .sp-header es simétrico."
```

---

### Task 3: detector de CSS muerto

Borrar ~95 reglas a ojo es donde se esconde el error. Primero la herramienta, con sus tests;
después el borrado, en su propio commit para poder revertirlo suelto.

**Files:**
- Create: `tools/find-dead-css.js`
- Create: `tests/dead-css.test.js`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `rulesOf` y `selectorsOf` de `tools/css-extract.js` (tarea 1).
- Produces: `tools/find-dead-css.js` exporta
  `classesInSelector(selector) -> Array<string>` y
  `isUsed(className, corpus) -> boolean`, donde `corpus` es un único string con todos los
  `.js` y `.html` concatenados.

- [ ] **Paso 1: escribir el test que falla**

`tests/dead-css.test.js`:

```js
// StintPro — tests del detector de CSS muerto (tools/find-dead-css.js)
// Ejecutar: node tests/dead-css.test.js
'use strict';

const { strictEqual, deepStrictEqual } = require('assert/strict');
const { classesInSelector, isUsed } = require('../tools/find-dead-css');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}
function group(name, fn) { console.log('\n' + name); fn(); }

group('classesInSelector', () => {
  test('saca una clase suelta', () => {
    deepStrictEqual(classesInSelector('.perf-cell'), ['perf-cell']);
  });
  test('saca las dos clases de un selector compuesto', () => {
    deepStrictEqual(classesInSelector('.grid2 .field'), ['grid2', 'field']);
  });
  test('ignora la pseudoclase', () => {
    deepStrictEqual(classesInSelector('.timing-row:nth-child(odd)'), ['timing-row']);
  });
  test('ignora id y etiqueta', () => {
    deepStrictEqual(classesInSelector('#screen-dash .card'), ['card']);
  });
  test('separa una lista de selectores', () => {
    deepStrictEqual(classesInSelector('.a, .b'), ['a', 'b']);
  });
});

group('isUsed', () => {
  test('la encuentra en un class= de comillas dobles', () => {
    strictEqual(isUsed('card', '<div class="card">'), true);
  });
  test('la encuentra junto a otras clases', () => {
    strictEqual(isUsed('card', '<div class="box card active">'), true);
  });
  test('la encuentra en classList', () => {
    strictEqual(isUsed('active', "el.classList.add('active')"), true);
  });
  test('la encuentra en una plantilla de string', () => {
    strictEqual(isUsed('kpi', 'html += `<div class="kpi">`'), true);
  });
  test('NO confunde un prefijo con la clase', () => {
    strictEqual(isUsed('card', '<div class="card-body">'), false);
  });
  test('NO confunde un sufijo con la clase', () => {
    strictEqual(isUsed('body', '<div class="card-body">'), false);
  });
  test('devuelve false si no aparece', () => {
    strictEqual(isUsed('perf-cell', '<div class="otra-cosa">'), false);
  });
});

console.log(`\n${passed} pasados, ${failed} fallidos`);
process.exit(failed ? 1 : 0);
```

- [ ] **Paso 2: ejecutarlo para verificar que falla**

Run: `node tests/dead-css.test.js`
Esperado: FALLA con `Cannot find module '../tools/find-dead-css'`.

- [ ] **Paso 3: escribir `tools/find-dead-css.js`**

```js
// Lista las reglas de un CSS cuyas clases no usa ningún .js/.html del proyecto.
// Es una AYUDA, no una autoridad: su salida se revisa a mano antes de borrar nada.
// Ejecutar: node tools/find-dead-css.js
'use strict';

const fs = require('fs');
const path = require('path');
const { rulesOf } = require('./css-extract');

// Las clases de un selector, sin pseudoclases, ids ni etiquetas.
function classesInSelector(selector) {
  const out = [];
  const re = /\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)/g;
  let m;
  while ((m = re.exec(selector)) !== null) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

// ¿Aparece la clase como palabra completa dentro de un class=/classList/plantilla?
// El corpus es todo el JS y HTML concatenado. Delimitamos por caracteres que no
// pueden formar parte de un nombre de clase, para que 'card' no case con
// 'card-body'.
function isUsed(className, corpus) {
  const esc = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^-_a-zA-Z0-9])${esc}([^-_a-zA-Z0-9]|$)`).test(corpus);
}

function main() {
  const root = path.join(__dirname, '..');
  const cssPath = path.join(root, 'src', 'styles.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  const dirs = [path.join(root, 'src')];
  let corpus = '';
  for (const dir of dirs) {
    for (const f of fs.readdirSync(dir)) {
      if (!/\.(js|html)$/.test(f)) continue;
      corpus += fs.readFileSync(path.join(dir, f), 'utf8') + '\n';
    }
  }

  const muertas = [];
  for (const rule of rulesOf(css)) {
    const clases = classesInSelector(rule.selector);
    if (clases.length === 0) continue;               // @media, html/body, ::-webkit-…
    if (clases.every(c => !isUsed(c, corpus))) muertas.push(rule.selector);
  }

  console.log(`${muertas.length} reglas sin uso en src/styles.css:\n`);
  muertas.forEach(s => console.log('  ' + s));
  console.log('\nRevísalas a mano antes de borrar. El detector no ve nombres construidos');
  console.log("en tiempo de ejecución (p. ej. 'b-' + tipo).");
}

if (require.main === module) main();

module.exports = { classesInSelector, isUsed };
```

- [ ] **Paso 4: ejecutar el test y verificar que pasa**

Run: `node tests/dead-css.test.js`
Esperado: `12 pasados, 0 fallidos`.

- [ ] **Paso 5: commit de la herramienta**

```bash
git add tools/find-dead-css.js tests/dead-css.test.js
git commit -m "test(css): detector de reglas huérfanas en styles.css"
```

- [ ] **Paso 6: revisar la lista a mano — el paso que no se salta**

Run: `node tools/find-dead-css.js`

Antes de borrar cada regla, busca la clase por si el nombre se construye en tiempo de
ejecución, que es lo único que el detector no ve:

```bash
grep -rn "b-' *+\|'sl-' *+\|className *= *\`" src/*.js | head
```

Sospechosos conocidos que **hay que mirar uno a uno**: `.b-blue`, `.b-bueno`, `.b-neutral`,
`.b-malo`, `.b-gray` (candidatas a construirse como `'b-' + calidad`), `.sinDatos`,
`.recommended`, `.mine`, `.mono`, `.fast`, `.slow`. Si una clase se construye, **no se borra**.

- [ ] **Paso 7: borrar las reglas confirmadas**

Borra de `src/styles.css` solo las reglas que hayas confirmado muertas en el paso 6, y con
ellas los comentarios de sección que se queden vacíos. Deja intacta la sección SETUP viva:
`.card`, `.field`, `.btn`, `.sec-label`, `.f-*`, `.conn-*`, `.dorsal-*`, `.pit-*`,
`.circuit-select`, `.url-in`, `.app-title`, `.app-ver`, `.titlebar-drag`, `.ps-slot`,
`.cdot`, `.btn-cta` — todas las usa `setup.js`.

- [ ] **Paso 8: verificar que no se ha llevado nada por delante**

```bash
node tests/dead-css.test.js && for t in tests/*.test.js; do node "$t" >/dev/null || echo "FALLA $t"; done; echo "suite terminada"
```

Y en el banco: recarga los cuatro estados de la tarea 1 y compáralos con las capturas.

La pantalla de **setup** no está en el banco (el banco arranca directo en el panel), y es la
que más CSS vivo tiene en `styles.css`. Como no se puede mirar a ojo sin login, se comprueba
por grep que ninguna de las clases que usa `setup.js` ha desaparecido:

```bash
for c in card field btn sec-label f-input f-label conn-row dorsal-input circuit-select url-in app-title titlebar-drag ps-slot cdot btn-cta pit-stats; do grep -q "\.$c[ ,{:]" src/styles.css || echo "BORRADA POR ERROR: .$c"; done; echo "comprobación del setup terminada"
```

Esperado: ninguna línea `BORRADA POR ERROR`.

- [ ] **Paso 9: commit del borrado, aparte**

```bash
git add src/styles.css
git commit -m "refactor(css): borra las reglas huérfanas de styles.css

Restos del panel anterior: ni una sola la usa ningún .js/.html.
Listadas por tools/find-dead-css.js y revisadas a mano una a una.
Va en su propio commit para poder revertirlo suelto."
```

---

### Task 4: extraer el chrome compartido a `panel.css`

39 de las 111 reglas de `en-state.js` son idénticas a 39 de las 53 de `sprint.js`. Salen a un
fichero real; cada bloque inyectado se queda con lo suyo.

**Files:**
- Create: `src/panel.css`
- Modify: `src/index.html`
- Modify: `src/en-state.js:140-252`
- Modify: `src/sprint.js:26-80`
- Modify: `tools/panel-preview.html`
- Create: `tests/panel-css.test.js`

**Interfaces:**
- Consumes: `rulesOf` y `extractInjectedCss` de `tools/css-extract.js`, y
  `tests/fixtures/panel-css-baseline.json` (tarea 1).
- Produces: `src/panel.css` con las 39 reglas compartidas.

- [ ] **Paso 1: escribir el test que falla**

Este test es el corazón de la entrega: dice, mecánicamente, que no se ha perdido ni duplicado
ninguna regla.

`tests/panel-css.test.js`:

```js
// StintPro — invariantes del refactor del CSS del panel
// Ejecutar: node tests/panel-css.test.js
'use strict';

const fs = require('fs');
const path = require('path');
const { strictEqual, deepStrictEqual } = require('assert/strict');
const { rulesOf, extractInjectedCss } = require('../tools/css-extract');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}
function group(name, fn) { console.log('\n' + name); fn(); }

const raiz = path.join(__dirname, '..');
const leer = p => fs.readFileSync(path.join(raiz, p), 'utf8');

const base     = JSON.parse(leer('tests/fixtures/panel-css-baseline.json'));
const panel    = rulesOf(leer('src/panel.css'));
const endur    = rulesOf(extractInjectedCss(leer('src/en-state.js')));
const sprint   = rulesOf(extractInjectedCss(leer('src/sprint.js')));

const sel = rs => rs.map(r => r.selector);
const dups = xs => xs.filter((x, i) => xs.indexOf(x) !== i);

group('nada se ha perdido', () => {
  test('endurance conserva todos sus selectores (panel.css + su bloque)', () => {
    deepStrictEqual(
      [...sel(panel), ...sel(endur)].sort(),
      sel(base.endurance).sort()
    );
  });
  test('sprint conserva todos sus selectores (panel.css + su bloque)', () => {
    deepStrictEqual(
      [...sel(panel), ...sel(sprint)].sort(),
      sel(base.sprint).sort()
    );
  });
});

group('nada está duplicado', () => {
  test('ningún selector está a la vez en panel.css y en el bloque de endurance', () => {
    const cruce = sel(panel).filter(s => sel(endur).includes(s));
    deepStrictEqual(cruce, []);
  });
  test('ningún selector está a la vez en panel.css y en el bloque de sprint', () => {
    const cruce = sel(panel).filter(s => sel(sprint).includes(s));
    deepStrictEqual(cruce, []);
  });
  test('panel.css no repite ningún selector', () => {
    deepStrictEqual(dups(sel(panel)), []);
  });
});

group('lo compartido es lo que se ha extraído', () => {
  test('panel.css contiene exactamente las reglas que estaban en los dos bloques', () => {
    const compartidos = sel(base.endurance).filter(s => sel(base.sprint).includes(s));
    deepStrictEqual(sel(panel).sort(), compartidos.sort());
  });
  test('cada regla de panel.css conserva su cuerpo original', () => {
    for (const regla of panel) {
      const orig = base.endurance.find(r => r.selector === regla.selector);
      strictEqual(regla.body, orig.body, `cambió el cuerpo de ${regla.selector}`);
    }
  });
});

group('el orden de carga es el correcto', () => {
  test('index.html carga styles.css y luego panel.css', () => {
    const html = leer('src/index.html');
    const iStyles = html.indexOf('href="styles.css"');
    const iPanel  = html.indexOf('href="panel.css"');
    strictEqual(iStyles > -1, true, 'no se encuentra el link a styles.css');
    strictEqual(iPanel > -1, true, 'no se encuentra el link a panel.css');
    strictEqual(iStyles < iPanel, true, 'panel.css debe ir DESPUÉS de styles.css');
  });
});

console.log(`\n${passed} pasados, ${failed} fallidos`);
process.exit(failed ? 1 : 0);
```

- [ ] **Paso 2: ejecutarlo para verificar que falla**

Run: `node tests/panel-css.test.js`
Esperado: FALLA con `ENOENT ... src/panel.css`.

- [ ] **Paso 3: generar `src/panel.css` a partir de la línea base**

No lo escribas a mano: el test compara los cuerpos carácter a carácter.

```bash
node -e "
const fs=require('fs');
const base=JSON.parse(fs.readFileSync('tests/fixtures/panel-css-baseline.json','utf8'));
const comunes=base.sprint.filter(r=>{
  const e=base.endurance.find(x=>x.selector===r.selector);
  return e && e.body===r.body;
});
const cab=\`/* Chrome compartido por los dos modos de panel (endurance y sprint).
 *
 * Salió de los <style> que inyectaban en-state.js y sprint.js, donde vivía
 * DUPLICADO: 39 reglas idénticas en los dos ficheros. Cada bloque inyectado se
 * queda solo con lo específico de su modo.
 *
 * ORDEN DE CARGA, no lo cambies: styles.css → panel.css → los <style> que se
 * inyectan desde JS en tiempo de ejecución. Los inyectados van al final del
 * <head> y por eso siguen ganando: es lo que queremos para las reglas propias
 * de cada modo.
 *
 * tests/panel-css.test.js vigila que ninguna regla se pierda ni quede duplicada
 * entre este fichero y los dos bloques.
 */
\`;
fs.writeFileSync('src/panel.css', cab + comunes.map(r=>r.selector+'{'+r.body+'}').join('\n') + '\n');
console.log(comunes.length,'reglas extraídas a src/panel.css');
"
```

Esperado: `39 reglas extraídas a src/panel.css`.

- [ ] **Paso 4: quitar esas 39 reglas de los dos bloques inyectados**

En `src/en-state.js` (bloque de las líneas 140-252) y en `src/sprint.js` (bloque de las
líneas 26-80), borra las reglas que ahora están en `panel.css`. **Ojo con las que se parecen
pero NO son iguales**: estas cuatro tienen valores distintos en cada modo y **se quedan donde
están**, cada una en su fichero:

| Selector | endurance | sprint |
|---|---|---|
| `.sp-body` | `overflow-y:auto;overflow-x:auto;flex:1;` | `overflow-y:auto;flex:1;` |
| `.sp-vtas` | `color:var(--text-2)` | `color:var(--text-3)` |
| `.sp-pitc` | `font-size:13.5px;color:var(--text-2)` | `font-size:12.5px;color:#333` |
| `.sp-kpis` / `.en-kpis` | 5 columnas, selector `.en-kpis` | 4 columnas, selector `.sp-kpis` |

Deja en cada bloque un comentario de una línea diciendo dónde vive ahora lo compartido:

```js
    /* El chrome compartido con el otro modo vive en src/panel.css.
       Aquí solo lo específico de endurance. */
```

- [ ] **Paso 5: añadir el `<link>` en `index.html`**

En `src/index.html`, justo después de la línea de `styles.css`:

```html
  <link rel="stylesheet" href="styles.css">
  <link rel="stylesheet" href="panel.css">
```

Y la misma línea en `tools/panel-preview.html`, sustituyendo el comentario que dejaste en la
tarea 1:

```html
  <link rel="stylesheet" href="../src/panel.css">
```

- [ ] **Paso 6: ejecutar el test y verificar que pasa**

Run: `node tests/panel-css.test.js`
Esperado: `8 pasados, 0 fallidos`.

- [ ] **Paso 7: verificar en el banco los cuatro estados**

Recarga `/tools/panel-preview.html` en sus cuatro variantes (normal/hc × endurance/sprint) y
compara con las capturas de la tarea 1. Esperado: idénticas. Revisa además la consola del
navegador: no debe haber ningún 404 de `panel.css`.

- [ ] **Paso 8: commit**

```bash
git add src/panel.css src/index.html src/en-state.js src/sprint.js tools/panel-preview.html tests/panel-css.test.js
git commit -m "refactor(panel): extrae a panel.css el chrome duplicado entre los dos modos

39 reglas idénticas vivían copiadas en los <style> de en-state.js y
sprint.js. Ahora viven una sola vez. Los tests comparan contra la
línea base: ninguna regla se pierde ni queda duplicada."
```

---

### Task 5: tokenizar las superficies que estrenarán cristal

Solo esas, y **con los valores exactos de hoy**: es lo que permite que la entrega 2 cambie el
material tocando tokens, y lo que hará que el modo ☀ pueda llegar al panel. Aquí no cambia
ningún color.

**Files:**
- Modify: `src/styles.css` (bloque `:root`)
- Modify: `src/panel.css`
- Modify: `src/en-state.js` (las reglas `.en-col-panel`, `.en-team-card`, `.en-strat-card`)
- Create: `tests/panel-tokens.test.js`

**Interfaces:**
- Consumes: `rulesOf` de `tools/css-extract.js`.
- Produces: los ocho tokens `--panel-*` en `:root`, que la entrega 2 redefinirá.

- [ ] **Paso 1: escribir el test que falla**

`tests/panel-tokens.test.js`:

```js
// StintPro — los tokens del panel valen EXACTAMENTE lo que valían los hex que
// sustituyen. Este test es lo que garantiza que la entrega 1 no cambia nada.
// Ejecutar: node tests/panel-tokens.test.js
'use strict';

const fs = require('fs');
const path = require('path');
const { strictEqual } = require('assert/strict');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

const raiz = path.join(__dirname, '..');
const styles = fs.readFileSync(path.join(raiz, 'src', 'styles.css'), 'utf8');
const panel  = fs.readFileSync(path.join(raiz, 'src', 'panel.css'), 'utf8');
const enSt   = fs.readFileSync(path.join(raiz, 'src', 'en-state.js'), 'utf8');

// Valor exacto que tenía cada superficie ANTES de tokenizar. Si alguno de estos
// cambia, la entrega 1 ha dejado de ser invisible y el test tiene que fallar.
const ESPERADOS = {
  '--panel-bg':        '#0e0f11',
  '--panel-surface':   '#13141a',
  '--panel-inset':     '#0e0f11',
  '--panel-line':      '#252630',
  '--panel-line-soft': '#1e1f25',
  '--panel-line-dim':  '#181920',
  '--panel-btn':       '#1a1b22',
  '--panel-btn-line':  '#2a2b2e',
};

console.log('\nlos tokens del panel conservan su valor original');
for (const [token, valor] of Object.entries(ESPERADOS)) {
  test(`${token} vale ${valor}`, () => {
    const m = styles.match(new RegExp(`${token}\\s*:\\s*([^;]+);`));
    strictEqual(m !== null, true, `${token} no está declarado en :root`);
    strictEqual(m[1].trim().toLowerCase(), valor);
  });
}

console.log('\nlas superficies usan el token, no el hex');
const SUPERFICIES = [
  ['panel.css', panel, '.sp-header',     '--panel-surface'],
  ['panel.css', panel, '.sp-kpi',        '--panel-inset'],
  ['panel.css', panel, '.sp-footer',     '--panel-line-dim'],
  ['panel.css', panel, '.sp-back',       '--panel-btn'],
  ['en-state.js', enSt, '.en-col-panel',  '--panel-surface'],
  ['en-state.js', enSt, '.en-team-card',  '--panel-surface'],
  ['en-state.js', enSt, '.en-strat-card', '--panel-surface'],
];
for (const [donde, fuente, selector, token] of SUPERFICIES) {
  test(`${selector} (${donde}) usa var(${token})`, () => {
    const esc = selector.replace('.', '\\.');
    const m = fuente.match(new RegExp(`${esc}\\s*\\{([^}]*)\\}`));
    strictEqual(m !== null, true, `no se encuentra la regla ${selector}`);
    strictEqual(m[1].includes(`var(${token})`), true, `${selector} no usa var(${token})`);
  });
}

test('ninguna superficie tokenizada conserva un hex crudo', () => {
  for (const [donde, fuente, selector] of SUPERFICIES) {
    const esc = selector.replace('.', '\\.');
    const m = fuente.match(new RegExp(`${esc}\\s*\\{([^}]*)\\}`));
    const hex = m[1].match(/#[0-9a-fA-F]{3,6}/g);
    strictEqual(hex, null, `${selector} (${donde}) todavía tiene ${hex}`);
  }
});

console.log(`\n${passed} pasados, ${failed} fallidos`);
process.exit(failed ? 1 : 0);
```

- [ ] **Paso 2: ejecutarlo para verificar que falla**

Run: `node tests/panel-tokens.test.js`
Esperado: FALLA con `--panel-bg no está declarado en :root`.

- [ ] **Paso 3: declarar los tokens en `:root`**

En `src/styles.css`, dentro del bloque `:root`, justo después de la línea de `--gold`:

```css
  /* Superficies del panel de carrera. Valores idénticos a los hex que había
   * escritos a mano en los <style> de en-state.js y sprint.js: tokenizarlos NO
   * cambia ningún color. Existen para que la entrega 2 (cristal) pueda cambiar
   * el material desde un solo sitio, y para que body.hc llegue por fin al panel.
   * Ver docs/superpowers/specs/2026-08-31-stintpro-liquid-glass-design.md */
  --panel-bg:        #0e0f11;   /* fondo de #screen-dash */
  --panel-surface:   #13141a;   /* .sp-header, .en-col-panel, tarjetas */
  --panel-inset:     #0e0f11;   /* .sp-kpi */
  --panel-line:      #252630;   /* borde de la cabecera y del panel de columnas */
  --panel-line-soft: #1e1f25;   /* bordes de .sp-kpi y de las tarjetas */
  --panel-line-dim:  #181920;   /* borde superior del pie */
  --panel-btn:       #1a1b22;   /* fondo de .sp-back */
  --panel-btn-line:  #2a2b2e;   /* borde de .sp-back */
```

**No añadas overrides en `body.hc`.** Eso es entrega 2.

- [ ] **Paso 4: sustituir los hex por los tokens**

En `src/panel.css`:

```css
#screen-dash{background:var(--panel-bg);display:flex;flex-direction:column;height:100vh;overflow:hidden;}
.sp-header{background:var(--panel-surface);border-bottom:0.5px solid var(--panel-line);padding:12px 18px;flex-shrink:0;-webkit-app-region:drag;}
.sp-kpi{background:var(--panel-inset);border-radius:8px;padding:10px 14px;border:0.5px solid var(--panel-line-soft);}
.sp-footer{padding:7px 14px;display:flex;gap:16px;border-top:0.5px solid var(--panel-line-dim);flex-shrink:0;}
.sp-back{font-size:12.5px;padding:4px 12px;border-radius:6px;border:0.5px solid var(--panel-btn-line);background:var(--panel-btn);color:var(--text-2);cursor:pointer;}
```

En `src/en-state.js`, dentro de su bloque:

```css
    .en-col-panel{position:absolute;z-index:50;top:30px;left:0;background:var(--panel-surface);border:0.5px solid var(--panel-line);border-radius:10px;padding:10px 12px;display:flex;gap:18px;box-shadow:0 8px 24px rgba(0,0,0,.5);}
    .en-team-card{background:var(--panel-surface);border:0.5px solid var(--panel-line-soft);border-radius:8px;padding:14px;margin-bottom:12px;}
    .en-strat-card{background:var(--panel-surface);border:0.5px solid var(--panel-line-soft);border-radius:8px;padding:14px;margin-bottom:12px;}
```

**No toques ninguna otra regla.** Los otros ~190 hex se quedan como están: tokenizarlos no
sirve a esta entrega (spec §10).

- [ ] **Paso 5: regenerar la línea base del CSS**

`panel.css` ha cambiado de cuerpo a propósito, así que el test de la tarea 4 que compara
cuerpos carácter a carácter va a fallar. Es correcto que falle: hay que reconocer el cambio
actualizando la referencia, y solo después de que los tokens estén verificados.

```bash
node tests/panel-tokens.test.js && node -e "
const fs=require('fs');
const {rulesOf,extractInjectedCss}=require('./tools/css-extract');
const base=JSON.parse(fs.readFileSync('tests/fixtures/panel-css-baseline.json','utf8'));
const panel=rulesOf(fs.readFileSync('src/panel.css','utf8'));
// Solo se actualizan los cuerpos de las reglas que hemos tokenizado a propósito.
for(const r of panel){
  for(const modo of ['endurance','sprint']){
    const o=base[modo].find(x=>x.selector===r.selector);
    if(o) o.body=r.body;
  }
}
fs.writeFileSync('tests/fixtures/panel-css-baseline.json',JSON.stringify(base,null,2));
console.log('línea base actualizada con los cuerpos tokenizados');
"
```

- [ ] **Paso 6: ejecutar toda la suite**

```bash
for t in tests/*.test.js; do echo "── $t"; node "$t" | tail -1; done
```

Esperado: `0 fallidos` en los once ficheros (los 8 que ya había más los 3 nuevos).

- [ ] **Paso 7: verificar en el banco los cuatro estados**

Recarga las cuatro variantes y compara con las capturas de la tarea 1. **Aquí es donde se
demuestra la entrega**: si algún color se ha movido, el token no vale lo que valía el hex.

- [ ] **Paso 8: commit**

```bash
git add src/styles.css src/panel.css src/en-state.js tests/panel-tokens.test.js tests/fixtures/panel-css-baseline.json
git commit -m "refactor(panel): tokeniza las superficies que estrenarán cristal

Ocho tokens --panel-* con los MISMOS valores que los hex que
sustituyen: ni un color cambia. Es lo que permitirá a la entrega 2
cambiar el material desde un solo sitio, y lo que hará que body.hc
llegue por fin al panel de carrera."
```

---

### Task 6: verificación final y cierre de la entrega

**Files:**
- Modify: `docs/superpowers/specs/2026-08-31-stintpro-liquid-glass-design.md` (corregir §2.2)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: la entrega lista para que Javier decida si se fusiona.

- [ ] **Paso 1: corregir el dato equivocado del spec**

El spec §2.2 dice "387 líneas en `en-state.js` y 455 en `sprint.js`". Es falso: son **111 y
53**, con **39 reglas idénticas**. Corrígelo, y con él la frase de §2.2 que hable del tamaño.

- [ ] **Paso 2: barrido de `position:fixed`**

```bash
grep -rn "position:fixed\|position: fixed" src/*.js src/*.html src/*.css
```

Esperado: ni un solo `fixed` dentro de `.sp-header`, `.sp-kpi`, `.sp-footer`,
`.en-col-panel`, `.en-team-card`, `.en-strat-card` ni `.card`. Los 14 overlays modales sí
pueden seguir siendo `fixed`: cuelgan de `document.body`. Anota el resultado del barrido en el
mensaje del commit de cierre.

- [ ] **Paso 3: suite completa**

```bash
for t in tests/*.test.js; do echo "── $t"; node "$t" | tail -1; done
```

Esperado: `0 fallidos` en todos. Si alguno falla, **no sigas**: arréglalo.

- [ ] **Paso 4: verificación visual de los cuatro estados, comparada**

Recarga las cuatro variantes del banco y compáralas con las capturas de la tarea 1. Además,
en el panel de endurance, ejercita a mano lo que las capturas estáticas no cubren:

1. Cambia de pestaña: Clasificación → Equipo → Estrategia (tarjetas `.en-team-card` y
   `.en-strat-card`).
2. Abre el selector de columnas (`.en-col-panel`) y marca y desmarca una columna.
3. Abre un modal cualquiera (clic en un piloto) y ciérralo.
4. Comprueba que el nombre de la sesión sigue centrado en la cabecera.
5. Pulsa ☀ Contraste y vuelve a pulsarlo.

- [ ] **Paso 5: commit de cierre**

```bash
git add docs/superpowers/specs/2026-08-31-stintpro-liquid-glass-design.md
git commit -m "docs(spec): corrige el tamaño de los bloques de estilo del panel

Eran 111 y 53 líneas con 39 reglas idénticas, no 387 y 455: el
primer awk cogió de más. El reparto del refactor no cambia."
```

- [ ] **Paso 6: informar, y NO desplegar**

Resume para Javier: qué commits han salido, el resultado de la suite, qué se ha verificado a
ojo en el banco y qué no. Di explícitamente que **no se ha hecho push ni se ha fusionado a
`main`**, y pregúntale si quiere que la entrega 2 (el cristal) empiece ya o prefiere fusionar
esta primero.

---

## Notas para quien ejecute esto

- **Los `<style>` inyectados siguen ganando** a `panel.css` porque se añaden al `<head>` en
  tiempo de ejecución. Eso es intencionado: las reglas propias de cada modo deben poder pisar
  las compartidas.
- **Si los dos modos se inyectan en la misma sesión** (endurance y luego sprint sin recargar),
  sus bloques conviven y las cuatro reglas de la tabla de la tarea 4 chocan entre sí. Eso ya
  pasa hoy, antes de este trabajo: **no lo arregles aquí**. Anótalo si lo ves.
- **El banco de pruebas no se despliega.** `vercel.json` tiene `outputDirectory: "src"` y el
  banco vive en `tools/`. No lo muevas a `src/`.
- **Si el test de contraste te tienta**, no: es de la entrega 2.
