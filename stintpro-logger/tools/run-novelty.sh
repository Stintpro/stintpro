#!/bin/bash
# ── "Pasa el detector de novedades" en un solo paso ────────────────────────
# Baja los raw logs actuales del VPS y corre el detector contra el catálogo.
# Uso: bash run-novelty.sh
set -e
KEY=~/.ssh/stintpro_hetzner
VPS=root@188.245.90.48
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "→ Descargando raw logs del VPS…"
rsync -az -e "ssh -i $KEY" "$VPS:/opt/stintpro-logger/recordings/" "$TMP/"
echo "→ Analizando…"
node "$(dirname "$0")/novelty-detector.js" "$TMP"
