# CLAUDE.md — StintPro: Estrategia de Karting en Tiempo Real

## Visión general

StintPro es una aplicación de escritorio (Electron) para estrategia en carreras de karting endurance. Se conecta al sistema de cronometraje **Apex Timing** (livetiming WebSocket) y transforma los datos brutos en decisiones estratégicas: calidad de karts, probabilidad de box, clasificación estimada, plan de paradas y proyección de tráfico.

**Claim:** "Decisión informada en 2 segundos"

## Arquitectura

```
┌──────────────────────────────────────────────────────┐
│  StintPro App (Electron)                              │
│  ├── Setup → configura circuito, pilotos, dorsal     │
│  ├── Sprint Dashboard → sesiones cortas              │
│  └── Endurance Dashboard → carreras largas           │
│       ├── Clasificación (grid 13 columnas)           │
│       ├── Mi equipo (stints, pilotos, paradas)       │
│       ├── Estrategia (pool box, probabilidad, reco.) │
│       └── Avanzado (túnel salida, plan paradas)      │
└────────┬─────────────────────────┬───────────────────┘
         │ WebSocket directo       │ WebSocket vía Logger
         ▼                         ▼
   Apex Timing Server      StintPro Logger (NAS)
   (circuito)              (Docker, node, sql.js)
                           └── Graba 10 circuitos 24/7
                           └── API REST + WS relay
```

### Modos de conexión

1. **Directo a Apex** — WebSocket al servidor del circuito. Funciona desde cualquier sitio con internet. Pierdes historial previo.
2. **Vía Logger** — WebSocket al NAS propio (192.168.1.79:3000 local, 100.71.53.12:3000 via Tailscale). El logger graba desde el inicio; conectando tarde tienes todo el historial.

## Estructura de archivos

### App Electron (`karting-v10/`)

| Archivo | Función |
|---|---|
| `main.js` | Proceso principal Electron, crea ventana frameless |
| `package.json` | Dependencias (electron, ws) |
| `src/index.html` | HTML base, carga todos los scripts |
| `src/styles.css` | Estilos globales (tema oscuro) |
| `src/app.js` | Orquestador: carga circuitos, decide sprint/endurance |
| `src/state.js` | Estado global (AppState) |
| `src/setup.js` | Pantalla de configuración (circuito, pilotos, dorsal) |
| `src/circuits.js` | Lista de circuitos guardados (localStorage) |
| `src/clock.js` | ApexClock: reloj sincronizado con countdown de Apex |
| `src/helpers.js` | Utilidades (formateo, parseo) |
| `src/apex-connector.js` | Conector WebSocket a Apex Timing (parser del protocolo) |
| `src/logger-connector.js` | Conector WebSocket al Logger del NAS |
| `src/sprint.js` | Dashboard Sprint completo |
| `src/endurance.js` | Dashboard Endurance completo (~2700 líneas) |

### Logger NAS (`stintpro-logger/`)

| Archivo | Función |
|---|---|
| `server.js` | Express + WebSocket server, gestión de sesiones |
| `db.js` | Capa SQLite (sql.js para ARM Docker) |
| `apex-connector.js` | Conector a Apex (versión servidor, sin DOM) |
| `config.json` | Lista de circuitos a monitorizar (hasta 10) |
| `package.json` | Dependencias (express, ws, sql.js) |
| `start.sh` | Script arranque Docker |

## Dominio: Karting Endurance

### Conceptos clave

- **Stint**: periodo que un piloto está en pista entre paradas
- **Stint mínimo/máximo**: límites de tiempo en pista marcados por la organización
- **Parada obligatoria**: duración FIJA marcada por la organización (ej: 2 min). El equipo espera con timer a que pase el tiempo. El coste es constante.
- **Paradas totales**: la organización marca cuántas (ej: 11 en 9h)
- **Box**: zona donde están los karts de reserva. Tres configuraciones:
  - **Línea**: cola FIFO, solo el primero accesible
  - **Batería**: todos accesibles por sorteo aleatorio
  - **Columnas**: fila 1 accesible (sorteo), filas 2+ bloqueadas
- **M5v**: media de las últimas 5 vueltas limpias (outliers filtrados)
- **Delta pista**: diferencia entre M5v del kart y mediana de todos los karts
- **Mediana**: más robusta que media aritmética (no se contamina con outliers)
- **`|*|`**: mensaje de pase por línea de meta en Apex (timestamp real de posición física)

### Umbrales de calidad de karts

| Calidad | Condición (piloto regular, rango <0.5s) | Condición (errático, rango ≥0.5s) |
|---|---|---|
| Bueno 🟩 | M5v < media_pista - 0.5s | Mejor vuelta stint < media_pista - 0.5s |
| Neutro 🟨 | entre -0.5s y +0.5s | entre -0.5s y +0.5s |
| Malo 🟥 | M5v > media_pista + 0.5s | Mejor vuelta stint > media_pista + 0.5s |

- La calidad se evalúa SOLO con vueltas del kart actual (desde último pit out)
- Kart bueno se mantiene verde hasta que entra en boxes (no degrada a neutro)
- Override manual: click en dorsal cicla auto → bueno → neutro → malo → auto
- Degradación: si M5v > stintBest + 2.0s → malo

### Cola del box (modelo FIFO dinámico)

- **Pit IN** → el kart entregado se añade al FINAL de la cola (cola CRECE sin límite)
- **Pit OUT** → el equipo se lleva el PRIMERO de la cola (cola DECRECE)
- Las "posiciones" configuradas definen los karts de reserva iniciales y la zona accesible, NO limitan la cola
- Si toda la cola es de karts "unknown" → muestra "SIN DATOS DE BOX" en vez de probabilidad ficticia

### Deuda de paradas

Concepto crucial: quien apura stint máximo acumula paradas pendientes. Al final de carrera el tiempo no da para cumplirlas con stints decentes.

**Fórmula del techo de stint de un rival:**
```
techo = elapsed + T_restante − paradas_pendientes × (parada + stint_mínimo)
techo_final = min(stint_máximo, techo)
```

Mientras cabe el máximo → marca máximo. Cuando la deuda aprieta → el techo cae y el countdown se acorta con ⚠.

**Ejemplo:** carrera 9h, parada 2min, 11 paradas, stint máx 75min:
- Tiempo de pista total: 9h − 11×2min = 8h 38min
- Un rival con 4/11 paradas a falta de 2h → su stint medio disponible cae a ~12min

### Topología del circuito (offset pit exit → meta)

La meta puede estar lejos del pit. La app auto-calibra el offset midiendo el tiempo entre `so` (pit out) y el primer `|*|` (pase por meta) de cualquier kart que pare. Con 2+ paradas observadas queda calibrado.

## Protocolo Apex Timing

### Mensajes principales

| Formato | Significado |
|---|---|
| `grid\|...` | Grid inicial con columnas mapeadas |
| `r1\|*\|67234\|` | Kart r1 pasa por meta, vuelta en ms |
| `r1\|c3\|si\|` | Celda c3 de r1, valor "si" (pit in) |
| `dyn1\|countdown\|5400000` | Countdown de sesión en ms |
| `r1\|#\|5` | Posición directa: kart r1 es P5 |

### Códigos de estado (columna grp/sta)

| Código | Significado |
|---|---|
| `si` | Pit IN |
| `so` | Pit OUT |
| `sr` | En pista (running) |
| `su` | En pista (running) |
| `ss` | Bandera (vuelta inválida) |
| `sf` | Sesión finalizada (checkered) |

### Tipos de celda (colMap dinámico del grid)

| dtype | Celda |
|---|---|
| `rk` | Posición |
| `no` | Dorsal (número) |
| `dr` | Nombre/equipo |
| `llp` | Última vuelta (tiempo) |
| `blp` | Mejor vuelta |
| `gap` | Gap al líder |
| `int` | Intervalo al de delante |
| `lc` | Vueltas completadas |
| `sc` | Stands count (paradas oficiales) |

## Pestañas del dashboard endurance

### 📊 Clasificación
- Grid de 13 columnas: flash, pos, kart, equipo, vtas, última, mejor, M5v, Δpista, gap, int, consist, pit
- Toggle Pos/M5v clicable en header (banner azul inconfundible en modo M5v)
- Tooltip en dorsal al pasar ratón: explica POR QUÉ ese kart es bueno/malo/neutro
- Click en dorsal: override manual de calidad
- Click en fila: pin para seguimiento visual

### 👥 Mi equipo
- Popup de selección de piloto al hacer pit out
- Historial de stints editable con botón 📊 (detalle con vueltas)
- Confirmación antes de borrar stint (popup)
- Resumen por piloto (tiempos acumulados)
- Config de paradas obligatorias

### 🎯 Estrategia
- Config: tipo box, posiciones, stint min/max, dorsal, duración parada
- Popup recordatorio de configurar stint al entrar primera vez
- Probabilidad de acceso a kart bueno (%) según tipo de box
- Presencia de buenos en el pool (%)
- "SIN DATOS DE BOX" cuando cola toda desconocida
- Cola del box visual con colores de calidad
- Diagrama del box (línea/batería/columnas) con zona accesible vs espera
- Karts en pista por calidad con countdown limitado por deuda ⚠
- Previsión de box (timeline de cuándo entran rivales con kart bueno)
- Clasificación estimada normalizada por paradas (standsCount oficial)
- Recomendación táctica integrada con semáforo de stint

### 🔬 Avanzado
- Config duración de parada (separada del re-render)
- Túnel de salida de box: proyección visual de karts ±20s del punto de reentrada
  - Auto-calibración del offset pit exit → meta
  - Semáforo: 🟢 aire limpio / 🟡 moderado / 🔴 denso
  - Hueco en segundos por delante y detrás
- Plan de paradas restantes: hechas/total, faltan, stint medio disponible, ¿Apurar máx?
  - Semáforo viabilidad: 🟢 holgado / 🟡 ajustado / 🔴 imposible
- Rivales comprometidos por deuda de paradas

## Reglas de negocio confirmadas

1. La duración de parada es FIJA (la organización pone timer obligatorio) → coste constante
2. NO hay banderas ni neutralizaciones en rental endurance
3. Una subida colectiva de tiempos = lluvia, no bandera
4. El `|*|` registra pases por meta en tiempo real (usable para orden físico)
5. La meta puede estar lejos del pit (offset auto-calibrable)
6. `standsCount` de Apex es la fuente de verdad para paradas (oficial, correcto aunque conectes tarde)
7. La recomendación táctica SIEMPRE verifica el semáforo de stint antes de sugerir parar
8. Max 10 pilotos por equipo, max 1500 vueltas de historial

## Patrones de desarrollo

### Verificación de sintaxis
```bash
node -e "const fs=require('fs'); const code=fs.readFileSync('src/endurance.js','utf8'); try{new Function(code);console.log('OK')}catch(e){console.log('ERROR:',e.message)}"
```

### Reemplazos grandes
Para cambios de muchas líneas, usar Python heredoc scripts en vez de sed — más fiable.

### Zip para el usuario
```bash
cd /path/to/project && rm -f output.zip && zip -r output.zip karting-v10/
```

### Arranque Electron (Mac del usuario)
```bash
cd "/Users/javiercoy/Documentos Locales/KARTING STRATEGY/karting-v10" && rm -rf node_modules package-lock.json && npm install && ~/Desktop/karting-strategy/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron "/Users/javiercoy/Documentos Locales/KARTING STRATEGY/karting-v10"
```

## Blindaje de errores

- El handler de datos tiene try/catch global: una excepción en tracking NUNCA congela el dashboard
- El render (`_enRender`) tiene try/catch por sección: un error en estrategia no rompe la clasificación
- `console.error('[StintPro] ...')` para diagnóstico sin congelar la UI

## Cosas a tener en cuenta

### Conector Apex (`apex-connector.js`)
- **Fallback de tiempos desde `|*|`**: si las celdas `llp` no llegan (colMap roto/circuito sin mapear), el tiempo de vuelta se extrae del mensaje `|*|` (ms validados 20-300s)
- **Anti-duplicado**: si llega `llp` con la misma vuelta (±0.05s) que ya registró `|*|` → REFINA en vez de duplicar
- **Detección de estado por código**: `si/so/sr/su/sd/ss/sf/gs/gf/gl/gm` se procesan aunque la columna no esté mapeada
- **IP del NAS codificada como char array** en setup.js (ofuscación ligera)

### ApexClock
- `sync(ms, mode)`: sincroniza con countdown de Apex
- `reset()`: desincroniza (display "—") sin matar timer ni callbacks — para cambio de sesión
- `remainingMs()`: ms restantes (null si no sincronizado)
- `isCountUp()`: true si es cronómetro ascendente

### Calidad de karts (`_enAutoKartQuality`)
- Evalúa SOLO vueltas del kart actual (desde `stintStartIdx` que se fija en pit out)
- Pit OUT resetea calidad solo en la TRANSICIÓN (flag `_lastPitState`) — el estado 'out' persiste varios ticks
- Piloto errático: usa mejor vuelta del stint en vez de M5v
- Kart bueno se mantiene sticky hasta pit in

### Logger NAS
- Docker node:latest en UGREEN NAS (ARM)
- sql.js en vez de better-sqlite3 (compilación ARM falla)
- Solo crea sesión cuando detecta primera vuelta real (no al recibir grid → fix micro-sesiones)
- GET `/api/cleanup` borra sesiones sin vueltas
- CORS habilitado para acceso desde navegador
- Tailscale configurado: IP 100.71.53.12 (cuenta coyjavier@gmail.com)

## Marca

- **Nombre:** StintPro
- **Colores:** azul #5b8dee, verde #22c55e, amarillo #fbbf24, rojo #ef4444, dark #0e0f11
- **Tema:** oscuro (background #08090a)

## Pendiente (futuro)

### Funcionalidades
- Exportación PDF al cerrar sesión (resumen de stints con vueltas)
- Fetch HTTP snapshot al conectar directo a Apex
- Countdown a ventana de pit en clasificación
- Alertas sonoras
- Reset manual de cola FIFO
- Icono ℹ️ ficha rival (datos históricos)
- Ritmo de caza del rival directo
- Alerta de degradación del propio kart
- Timeline de eventos de carrera
- Modo lluvia (detector de cambio de condiciones)

### Infraestructura
- VPS público (proxy + licencias + app web) — Hetzner 5€/mes
- Sistema de licencias con expiración (online + gracia 7 días)
- Empaquetado .exe / .dmg (electron-builder)
- Landing page sencilla (Netlify/GitHub Pages)
- Versión web para iPad
- Directorio equipos/pilotos funcional (prototipo HTML existe)

### Pendiente de portar al logger NAS
- Fallback de tiempos desde `|*|` (implementado en app, no en logger)
- Detección de estado por código (implementado en app, no en logger)
