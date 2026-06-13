#!/bin/bash
# ── Deploy StintPro Logger a Hetzner ────────────────────────────────────────
# Ejecutar en Hetzner: bash deploy-hetzner.sh
# Hace backup del DB, sustituye los archivos JS por la versión del repo,
# y reinicia el servicio.

set -e
DIR=/opt/stintpro-logger

echo "=== StintPro Logger Deploy ==="

# Backup del DB si existe
if [ -f "$DIR/data/stintpro.db" ]; then
  cp "$DIR/data/stintpro.db" "/tmp/stintpro.db.bak.$(date +%Y%m%d_%H%M%S)"
  echo "✓ DB backup en /tmp/"
fi

# Detener servicio
systemctl stop stintpro-logger 2>/dev/null || true
echo "✓ Servicio detenido"

# Si el DB tiene esquema antiguo (0 sesiones grabadas por el bug), resetear
if [ -f "$DIR/data/stintpro.db" ]; then
  COUNT=$(sqlite3 "$DIR/data/stintpro.db" "SELECT COUNT(*) FROM sessions;" 2>/dev/null || echo "0")
  if [ "$COUNT" = "0" ]; then
    rm -f "$DIR/data/stintpro.db"
    echo "✓ DB vacío eliminado (se creará uno nuevo con esquema correcto)"
  fi
fi

# Descargar los 4 archivos JS del repo (usa la URL raw de tu GitHub si es público)
# Si no tienes acceso desde Hetzner, usa la sección "Modo manual" abajo
echo "→ Copiando archivos..."

# MODO MANUAL: copia los archivos desde tu Mac con scp y luego ejecuta restart:
#   scp stintpro-logger/server.js stintpro-logger/db.js \
#       stintpro-logger/apex-parser.js stintpro-logger/circuit-monitor.js \
#       root@188.245.90.48:/opt/stintpro-logger/
#   ssh root@188.245.90.48 'systemctl restart stintpro-logger'

echo ""
echo "⚠️  Copia manual requerida. Desde tu Mac:"
echo ""
echo "  scp karting-v10/../stintpro-logger/server.js \\"
echo "      stintpro-logger/db.js \\"
echo "      stintpro-logger/apex-parser.js \\"
echo "      stintpro-logger/circuit-monitor.js \\"
echo "      root@188.245.90.48:/opt/stintpro-logger/"
echo ""
echo "Luego en Hetzner:"
echo "  systemctl start stintpro-logger"
echo "  journalctl -u stintpro-logger -f"
