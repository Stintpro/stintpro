# informe-carrera

Genera el informe de carrera en PDF de un piloto a partir de una sesión grabada por el logger del VPS.

```bash
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt   # solo la primera vez
./.venv/bin/python informe.py sesiones --circuito henakart
./.venv/bin/python informe.py analiza --carrera 2676 --crono 2674 --dorsal 13
./.venv/bin/python informe.py kart trabajo/2676-13      # opcional: el kart en todas las sesiones del día
# redactar los textos PENDIENTE de trabajo/2676-13/informe.json
./.venv/bin/python informe.py pdf trabajo/2676-13
./.venv/bin/python informe.py revisar trabajo/2676-13
```

- `nucleo.py`: descarga, reparación del registro, vueltas oficiales, posiciones, stints, huecos y cascadas.
- `graficos.py`: los diez gráficos, siempre con el mismo estilo.
- `maqueta.py`: estructura fija del PDF; el texto entra por `informe.json`.
- `ejemplos/`: un informe completo de referencia (solo en local: lleva nombres de pilotos y no se sube al repo público).
- La API key se lee de `STINTPRO_API_KEY` o de `~/.config/stintpro/api_key` (no va en el repo).
- El PDF sale en `KARTING STRATEGY/Informes/`. `trabajo/` y `.venv/` están ignorados por git.

El criterio de análisis y redacción vive en el skill `informe-carrera` (`~/.claude/skills/informe-carrera/SKILL.md`).
