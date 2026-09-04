# Prompt — Auditoría del punto ciego del guardián de contraste (StintPro)

> Pégalo tal cual en una conversación nueva. Es autocontenido.

---

Trabaja en el repo de StintPro: `/Users/javiercoy/Documentos Locales/KARTING STRATEGY/karting-v10`. Todo en **español** (código, comentarios, commits). La rama de producción es `main` (cada push a `main` despliega a Vercel — **no** empujes ni despliegues sin que yo lo autorice explícitamente; trabaja en una rama aparte).

## Contexto: la estética de cristal y su invariante

StintPro es un panel de estrategia de karting endurance que se usa en el muro de boxes. Tiene una **estética de "cristal"**: el chrome (cabecera, KPIs, pie, tarjetas, panel de columnas, los 12 modales, las pestañas, tarjetas del setup) se pinta con material de vidrio traslúcido (`backdrop-filter`), y la **zona de datos** (las 28 filas de la parrilla, dorsales, barra de vueltas) se queda **MATE** a propósito.

El material se declara UNA sola vez, en `src/glass.css`, en dos variantes: **normal** (`.sp-glass` y compañía) y **denso** (`.sp-glass-denso`, `.sp-modal`, `.en-col-panel` — lo que flota sobre la parrilla).

**Invariante innegociable: todo texto sobre una superficie de cristal debe tener contraste ≥ 4,5:1 (WCAG), en modo normal Y en modo ☀ (alto contraste, `body.hc`, el refugio para sol directo).** Si un test se pone rojo, se ajusta el material o el color, **nunca el umbral**. Hay una batería de tests que lo vigila: `tests/contrast.test.js` (compone las capas del cristal a mano y exige 4,5) y `tests/glass.test.js`. Los tests corren sin dependencias: `node tests/<fichero>.test.js`. Suite completa: `for f in tests/*.test.js; do node "$f" >/dev/null 2>&1 && echo "OK $f" || echo "FALLO $f"; done` (16 ficheros hoy).

Los colores de estado van por **tokens** que el modo ☀ aclara para que pasen el contraste: `--state-alert` (rojo, `#ef4444` normal / `#FCA5A5` en ☀), `--state-warn` (ámbar), `--state-ok` (verde), definidos en `:root` y redefinidos en `body.hc` (`src/styles.css`). El texto secundario usa `--text-3`. `EXCEPCIONES` en `contrast.test.js` está **vacía** y debe seguir así.

## El problema a auditar

`tests/contrast.test.js` escanea los colores de texto que viven sobre el cristal buscando literales `#hex` o tokens, y comprueba que pasan 4,5:1. **Pero tiene un punto ciego estructural**, descubierto al integrar una feature reciente: el escáner solo ve con fiabilidad los colores escritos **dentro** de la plantilla del `innerHTML=\`...\``. Y casi toda la app **no** se pinta así: se pinta **acumulando con `html+=` / `rows+=`** en un bucle, fuera de una única plantilla. Ejemplos confirmados de este patrón: `src/en-team.js`, `src/en-grid.js`, `src/en-advanced.js`, `src/en-strategy.js` (busca `html+=` y `rows+=`).

Cuando un color de texto sobre cristal se construye por esa vía, **puede quedar sin vigilar**: un cambio futuro podría meter un contraste malo sobre el cristal y la suite seguiría en verde. Ya pasó una vez —el modal de mensajes construía sus filas con `rows+=` fuera del backtick y un `#555555` inyectado no lo cazaba nadie— y se cerró puntualmente con un guardián dedicado, pero **no se auditó el resto**.

**Importante: esto NO es un bug de hoy.** Los colores actuales pasan (se calibraron a mano). El riesgo es que la red de seguridad tiene agujeros y no sabemos cuántos. El objetivo es cerrarlos.

## La tarea

1. **Auditar** sistemáticamente qué superficies de cristal pintan texto de color y por qué vía, y **cuáles de esos colores están de verdad cubiertos** por `contrast.test.js` y cuáles no. Superficies de cristal a cubrir (mira la lista real en `src/glass.css`): `.sp-header` (hoy mate, pero sus hijos `.sp-kpi` sí son cristal), `.sp-kpi`, `.sp-footer`, `.en-team-card`, `.en-strat-card`, `.en-col-panel`, los **12** `.sp-modal`, `.en-tab.active`, `#screen-setup .card`. La zona de datos MATE queda fuera (no se toca).

   El método fiable es **empírico, no por lectura**: por cada color de texto que sospeches sobre cristal, **inyecta un color malo** (p. ej. `#555555`, que sobre el cristal da ~2:1) en ese sitio del código, corre `node tests/contrast.test.js`, y mira si se pone ROJO. Si sigue VERDE, ese color está en un punto ciego. Restaura siempre y comprueba `git status` limpio. Haz esto de forma organizada (una lista de sitios y su veredicto), no a ojo.

2. **Cerrar los agujeros que encuentres.** Para cada color sin vigilar:
   - Si es un color de **estado** (rojo/ámbar/verde de alerta/aviso/ok): tokenízalo a `var(--state-*)` — así hereda la garantía que ya tienen los tokens en ambos modos — y añade/extiende el guardián para que lo cubra.
   - Si es texto secundario apagado que debe leerse: `var(--text-3)`.
   - Si es un **separador/marcador deliberadamente tenue** que no es texto legible (hay algunos: `#555`, `#333`, `#2a2b2e`), NO lo cambies, pero el guardián debe distinguirlo explícitamente y con su razón, no dejarlo pasar por accidente.
   - **Nunca** metas nada en `EXCEPCIONES`, ni bajes el umbral, ni cambies un color de marca para salir del paso. Si algo no llega a 4,5 por ninguna vía razonable, **para y repórtalo con los números**.

3. **Cada guardián nuevo o extendido debe demostrar que MUERDE**: inyecta el fallo que dice vigilar → rojo nombrando el problema; restaura → verde. Y que **no pasa en vacío**: si se renombra la función/variable/selector que ancla la extracción, el test debe FALLAR explícitamente, no saltarse la comprobación en silencio (ese es el modo de fallo que esta base ha cazado repetidamente). Pega la evidencia.

## Cómo verificar en el navegador

Hay un banco de pruebas: se levanta con la herramienta de preview del proyecto (entrada `stintpro-banco` en `.claude/launch.json`, puerto 8765) — **no arranques servidores con Bash**. Se abre en `http://localhost:8765/tools/panel-preview.html`. Para llenar la parrilla: `window.ReplayConnector.speed = 10` en la consola y espera a que las filas tengan tiempos, o sale vacía. `_spToggleHC()` alterna el modo ☀. `app.js` NO se carga en el banco. **Ojo con la caché**: el banco cachea los `<script src>`; si un cambio «no se aplica», recarga forzando sin caché. Mide el contraste sobre **píxeles renderizados** cuando lo juzgues, no sobre el CSS.

## Reglas

- Trabaja en una rama desde `main` (`git checkout -b <rama>`). NO empujes ni fusiones a `main` sin que yo lo autorice — el push a `main` despliega a producción.
- Suite 16/16 verde antes de dar nada por hecho.
- El material se declara una vez en `glass.css`; hay dos materiales, no tres; sus reglas no declaran `border`.
- La zona de datos (`.en-row`, `.en-thead`, `.en-kart`, `.en-myrow`, `.sp-lapbar`) es MATE e intocable.
- Commits en español, terminando con: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Entregable

Un informe claro de: qué superficies pintan texto sobre cristal y por qué vía, cuáles estaban en un punto ciego (con la demostración de que un color malo pasaba), qué cerraste y cómo, y qué queda (si algo). Más los commits en la rama, listos para que yo decida el despliegue.

Empieza por un brainstorming corto conmigo si algo del alcance no está claro; si lo ves claro, arranca por la auditoría empírica (el barrido de inyecciones) antes de tocar nada.
