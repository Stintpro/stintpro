#!/bin/bash
# ── Envoltorio programado del detector de novedades ────────────────────────
# Lo lanza launchd cada 2 días. Corre run-novelty.sh, guarda la salida en un
# log y SOLO manda una notificación de macOS si el detector encuentra algo
# (código de salida 1 = novedades; 2 = error).
#
# launchd arranca con un entorno mínimo: fijamos PATH a mano.
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$DIR/novelty-cron.log"
STAMP="$(date '+%Y-%m-%d %H:%M')"

# Ejecuta el detector, captura salida y código.
OUT="$(bash "$DIR/run-novelty.sh" 2>&1)"
CODE=$?

# Registra siempre la última ejecución (rotación simple: últimas ~500 líneas).
{
  echo "════════════════════════════════════════════"
  echo "[$STAMP] exit=$CODE"
  echo "$OUT"
} >> "$LOG"
tail -n 500 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"

notify() { # título, mensaje
  osascript -e "display notification \"$2\" with title \"$1\" sound name \"Ping\"" 2>/dev/null
}

case $CODE in
  0) : ;; # sin novedades → silencio
  1) notify "StintPro · NOVEDADES en el logger" "El detector encontró algo nuevo. Revisa tools/novelty-cron.log" ;;
  *) notify "StintPro · detector con ERROR" "Fallo al pasar el detector (exit $CODE). Revisa tools/novelty-cron.log" ;;
esac

exit $CODE
