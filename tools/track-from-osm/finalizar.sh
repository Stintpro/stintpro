#!/bin/bash
# finalizar.sh <workdir> <slug> "<Nombre>" "<texto para profiles.normal.source>"
# Genera src/tracks/<slug>.json con tools/track-from-gps.js a partir de
# <workdir>/<slug>.csv, pone la fuente, conserva el perfil medido y el pitLane
# del trazado anterior si la forma coincide (keep_profile.py) y comprueba que
# el panel lo carga. NO hace commit.
set -e
W="$1"; SLUG="$2"; NAME="$3"; SRC="$4"
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/../.."
OLD=""
if git cat-file -e "HEAD:src/tracks/$SLUG.json" 2>/dev/null; then
  OLD="$W/$SLUG.old.json"; git show "HEAD:src/tracks/$SLUG.json" > "$OLD"
fi
node tools/track-from-gps.js "$W/$SLUG.csv" --slug "$SLUG" --name "$NAME" | grep -E "✓|✗"
SRC="$SRC" SLUG="$SLUG" python3 -I -c "
import json,os;f='src/tracks/'+os.environ['SLUG']+'.json';d=json.load(open(f));d['profiles']['normal']['source']=os.environ['SRC'];open(f,'w').write(json.dumps(d,separators=(',',':'))+'\n')"
if [ -n "$OLD" ]; then python3 -I "$HERE/keep_profile.py" "$OLD" "src/tracks/$SLUG.json"; fi
node -e "const P=require('./src/en-track-pos.js');if(!P.loadTrack(require('./src/tracks/$SLUG.json'),'normal'))process.exit(1);console.log('carga OK')"
