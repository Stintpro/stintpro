#!/usr/bin/env python3
"""Trazado de un circuito a partir de OpenStreetMap, orientado con el dibujo de Apex.

Uso: python3 -I tools/track-from-osm/osm_track.py <slug> <lat> <lon> [opciones]
  --radius M        radio de búsqueda en OSM (700)
  --work DIR        carpeta de trabajo (CSV, overlay, json descargados)
  --cache 1         reutiliza el osm.json ya descargado en --work
  --apex-slug S     coge el dibujo de otro canal de Apex (korridas tiene Campillos)
  --apex-track ID   fuerza un dibujo concreto de Apex (si no, el que mejor encaje)
  --cycle N         fuerza un circuito de OSM concreto (los índices salen en la salida)
  --meta LAT,LON    meta conocida (app del piloto o dada a mano) en vez de la de Apex

1. Descarga live.apex-timing.com/<slug>/ftp/tracks.json (forma, sentido, meta).
2. Descarga de Overpass los highway=raceway (descarta motocross, tierra…).
3. Enumera los circuitos cerrados del grafo de tramos, criba por descriptores de
   Fourier y encaja los mejores con el dibujo de Apex (Procrustes, sin espejo).
4. Con el mejor: sentido = ORDEN del path de Apex (en henakart da 54° y RaceBox
   midió 53°; el oneway de OSM no es fiable: en DR7 va al revés), meta = punto 0
   del path de Apex en coordenadas reales (error típico 3-20 m).
5. Escribe <work>/<slug>.csv (dos vueltas sintéticas a velocidad constante) para
   tools/track-from-gps.js, <work>/<slug>.overlay.svg (OSM azul, elegido gris,
   Apex rojo) para revisarlo a ojo y <work>/<slug>.result.json.
Sale con «SALTAR: …» si no hay dibujo en Apex o no hay circuito cerrado en OSM;
entonces, con meta y sentido conocidos, usar osm_manual.py.
Lo último: tools/track-from-osm/finalizar.sh (genera src/tracks/<slug>.json).
"""
import json, math, cmath, re, sys, os, time, subprocess, itertools

args = sys.argv[1:]
slug, lat0, lon0 = args[0], float(args[1]), float(args[2])
opt = {args[i][2:]: args[i + 1] for i in range(3, len(args) - 1) if args[i].startswith('--')}
flags = {a for a in args if a == '--no-apex'}
R = float(opt.get('radius', 700))
W = opt.get('work', '.')
os.makedirs(W, exist_ok=True)
K = math.cos(math.radians(lat0)); M = 111320.0
to_xy = lambda la, lo: complex((lo - lon0) * M * K, (la - lat0) * M)
to_ll = lambda z: (lat0 + z.imag / M, lon0 + z.real / (M * K))


def curl(url, out, data=None):
    cmd = ['curl', '-s', '-m', '60', '-A', 'stintpro-track-tool', '-o', out]
    if data: cmd += ['--data-urlencode', 'data=' + data]
    subprocess.run(cmd + [url], check=False)
    try:
        return open(out).read(1)
    except FileNotFoundError:
        return ''


# ── Apex ──
apex = []
if '--no-apex' not in flags:
    f = os.path.join(W, 'apex_tracks.json')
    if curl(f'https://live.apex-timing.com/{opt.get("apex-slug", slug)}/ftp/tracks.json', f) == '{':
        d = json.load(open(f))
        for t in d.get('list', []):
            m = re.search(r'data-type="track" d="([^"]*)"', t.get('svg', ''))
            if not m: continue
            P = [complex(float(a), -float(b)) for a, b in re.findall(r'(-?[\d.]+),(-?[\d.]+)', m.group(1))]
            # quitar duplicados consecutivos
            Q = [P[0]] + [p for i, p in enumerate(P[1:], 1) if p != P[i - 1]]
            apex.append({'id': t['id'], 'title': t.get('title'), 'pts': Q, 'default': str(t['id']) == str(d.get('default'))})
print('Apex:', [(a['id'], a['title'], len(a['pts'])) for a in apex] or 'sin dibujo')

# ── OSM ──
f = os.path.join(W, 'osm.json')
q = f'[out:json][timeout:60];(way(around:{R:.0f},{lat0},{lon0})[highway=raceway];);out geom tags;'
SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter',
           'https://maps.mail.ru/osm/tools/overpass/api/interpreter']
if not (os.path.exists(f) and open(f).read(1) == '{' and opt.get('cache') == '1'):
    for wait in (0, 5, 10, 20, 30, 45):
        time.sleep(wait)
        if any(curl(sv, f, q) == '{' for sv in SERVERS): break
    else:
        sys.exit('SALTAR: Overpass no responde')
ways = [e for e in json.load(open(f))['elements'] if e.get('geometry')
        and not re.search(r'motocross|bmx|cycl|horse|equestrian|athlet|dirt|speedway', e.get('tags', {}).get('sport', '') + e.get('tags', {}).get('surface', ''))]
for e in ways:
    print('  way', e['id'], e.get('tags', {}).get('name', ''), e.get('tags', {}).get('sport', ''), len(e['geometry']))
pos, adj = {}, {}
for e in ways:
    ns = [(round(g['lat'], 7), round(g['lon'], 7)) for g in e['geometry']]
    for n in ns: pos[n] = to_xy(*n)
    for u, v in zip(ns, ns[1:]):
        adj.setdefault(u, set()).add(v); adj.setdefault(v, set()).add(u)   # sin sentido: lo da Apex

# Ciclos simples (grafo no dirigido): contraer nodos de grado 2 para que sea pequeño.
deg = {n: len(v) for n, v in adj.items()}
junc = [n for n in adj if deg[n] != 2]
edges = []   # (a, b, [nodos])
seen = set()
for a in junc:
    for nb in adj[a]:
        path = [a, nb]
        while deg.get(path[-1]) == 2:
            nxt = [x for x in adj[path[-1]] if x != path[-2]]
            if not nxt: break
            path.append(nxt[0])
        key = (min(path[0], path[-1]), max(path[0], path[-1]), len(path), frozenset(path))
        if key in seen: continue
        seen.add(key); edges.append(path)
# anillos aislados (todos grado 2)
visited = set(x for p in edges for x in p)
for n in adj:
    if n in visited or deg[n] != 2: continue
    ring = [n]; prev = None; cur = n
    while True:
        nxt = [x for x in adj[cur] if x != prev and (x != n or len(ring) > 2)]
        if not nxt: break
        prev, cur = cur, nxt[0]
        if cur == n: break
        ring.append(cur)
    visited.update(ring); edges.append(ring + [n])

cycles = []
E = len(edges)
inc = {}
for i, p in enumerate(edges): inc.setdefault(p[0], []).append(i); inc.setdefault(p[-1], []).append(i)


def dfs(start, node, used, nodes):
    for i in inc.get(node, []):
        if i in used: continue
        p = edges[i]; other = p[-1] if p[0] == node else p[0]
        seg = p if p[0] == node else p[::-1]
        if other == start:
            cycles.append(nodes + seg[1:-1] if len(used) or p[0] != p[-1] else seg[:-1])
            continue
        if other in nodes or other < start: continue
        dfs(start, other, used | {i}, nodes + seg[1:])
        if len(cycles) > 400: return


for i, p in enumerate(edges):
    if p[0] == p[-1]: cycles.append(p[:-1])
for s in sorted(set(n for p in edges for n in (p[0], p[-1]))):
    dfs(s, s, frozenset(), [s])
# deduplicar
uniq = {}
for c in cycles:
    if len(c) < 4: continue
    uniq.setdefault(frozenset(c), c)
cycles = list(uniq.values())


def length(P, closed=True):
    Q = P + [P[0]] if closed else P
    return sum(abs(Q[i + 1] - Q[i]) for i in range(len(Q) - 1))


def resample(P, n=200):
    Q = P + [P[0]]; tot = length(P); out = []; acc = 0; i = 0
    for j in range(n):
        t = tot * j / n
        while acc + abs(Q[i + 1] - Q[i]) < t: acc += abs(Q[i + 1] - Q[i]); i += 1
        f = (t - acc) / abs(Q[i + 1] - Q[i]) if Q[i + 1] != Q[i] else 0
        out.append(Q[i] + (Q[i + 1] - Q[i]) * f)
    return out


print(f'{len(cycles)} circuitos cerrados en OSM:', sorted(round(length([pos[n] for n in c])) for c in cycles))
if not cycles: sys.exit('SALTAR: OSM no tiene ningún trazado cerrado aquí')

apex = [A for A in apex if len(A['pts']) >= 10]


def fdesc(P, n=96, K=8):
    # |c_k|/|c_1| para k=-K..K sin 0: no depende de giro, escala ni punto de inicio.
    b = resample(P, n); c = {}
    for k in range(-K, K + 1):
        if k == 0: continue
        c[k] = abs(sum(b[j] * cmath.exp(-2j * math.pi * k * j / n) for j in range(n))) / n
    m = max(c[1], c[-1]) or 1
    return {k: v / m for k, v in c.items()}


cyc_pts = [[pos[n] for n in c] for c in cycles]
cyc_fd = [fdesc(P) for P in cyc_pts]
results = []
for ai, A in enumerate(apex or [None]):
    if A is None: break
    a = resample(A['pts'][:-1] if A['pts'][0] == A['pts'][-1] else A['pts'])
    fa = fdesc(a)
    dist = []
    for ci, fd in enumerate(cyc_fd):
        d1 = sum((fa[k] - fd[k]) ** 2 for k in fa); d2 = sum((fa[k] - fd[-k]) ** 2 for k in fa)
        dist.append((min(d1, d2), ci))
    shortlist = [ci for _, ci in sorted(dist)[:6]]
    ma = sum(a) / len(a); a = [x - ma for x in a]; na = sum(abs(x) ** 2 for x in a)
    for ci in shortlist:
        c = cycles[ci]
        b = resample([pos[n] for n in c]); mb = sum(b) / len(b); b = [x - mb for x in b]
        for refl in (False,):   # Apex no dibuja en espejo (comprobado en henakart)
            bb = [x.conjugate() for x in b] if refl else b
            for rev in (False, True):
                b2 = bb[::-1] if rev else bb
                nb = sum(abs(y) ** 2 for y in b2)
                for sh in range(len(b2)):
                    cc = b2[sh:] + b2[:sh]
                    z = sum(x * y.conjugate() for x, y in zip(a, cc)) / nb
                    r = math.sqrt(sum(abs(x - z * y) ** 2 for x, y in zip(a, cc)) / na)
                    results.append((r, ai, ci, refl, rev, sh, z, ma, mb))
results.sort(key=lambda t: t[0])
best_by = {}
for t in results:
    best_by.setdefault((t[1], t[2]), t)
ranked = sorted(best_by.values(), key=lambda t: t[0])
for t in ranked[:6]:
    r, ai, ci, refl, rev, sh, z, ma, mb = t
    print(f'  apex#{apex[ai]["id"]} {apex[ai]["title"]!r:28} vs osm ciclo {ci} ({length([pos[n] for n in cycles[ci]]):.0f} m): error {r:.3f}  espejo={refl}')
if not ranked: sys.exit('SALTAR: sin dibujo de Apex (no hay sentido ni meta)')
pick = ranked[0]
if 'cycle' in opt:
    pick = min((t for t in ranked if t[2] == int(opt['cycle'])), key=lambda t: t[0])
if 'apex-track' in opt:
    pick = min((t for t in ranked if str(apex[t[1]]['id']) == opt['apex-track'] and ('cycle' not in opt or t[2] == int(opt['cycle']))), key=lambda t: t[0])
r, ai, ci, refl, rev, sh, z, ma, mb = pick
A = apex[ai]; cyc = [pos[n] for n in cycles[ci]]
# Sentido de Apex: con rev=True el ciclo de OSM va al revés que Apex.
if rev: cyc = cyc[::-1]
# Meta: punto 0 del path de Apex → geo:  a = z * b'  con b' = (b - mb) (conj si espejo)
sf = A['pts'][0] - ma
bp = sf / z
g = (bp.conjugate() if refl else bp) + mb
if 'meta' in opt:
    _la, _lo = map(float, opt['meta'].split(','))
    print(f'meta de Apex a {abs(g - to_xy(_la, _lo)):.0f} m de la meta dada; uso la dada')
    g = to_xy(_la, _lo)
# proyectar sobre el ciclo
best = None
for i in range(len(cyc)):
    p0, p1 = cyc[i], cyc[(i + 1) % len(cyc)]
    d = p1 - p0
    t = max(0, min(1, ((g - p0) * d.conjugate()).real / (abs(d) ** 2 or 1)))
    pr = p0 + d * t; dist = abs(g - pr)
    if best is None or dist < best[0]: best = (dist, i, t, pr, d)
dist, i, t, pr, d = best
brg = (90 - math.degrees(cmath.phase(d))) % 360
loop = [pr] + cyc[i + 1:] + cyc[:i + 1] + [pr]
la, lo = to_ll(pr)
print(f'ELEGIDO: apex#{A["id"]} {A["title"]!r} + osm ciclo {ci}, {length(cyc):.0f} m, error {r:.3f}, espejo={refl}')
print(f'META (de Apex): {la:.6f}, {lo:.6f}  rumbo {brg:.0f}°  (a {dist:.1f} m del eje)')
# CSV sintético: muestras cada ~1 m a 14 m/s
pts = []
for j in range(len(loop) - 1):
    L = abs(loop[j + 1] - loop[j]); n = max(1, int(L))
    for s in range(n): pts.append(loop[j] + (loop[j + 1] - loop[j]) * s / n)
v = 14.0; tt = 0.0
with open(os.path.join(W, slug + '.csv'), 'w') as fo:
    fo.write('Time,Latitude,Longitude,Lap\n')
    fo.write('%.3f,%.7f,%.7f,1\n' % (tt, *to_ll(pts[-1]))); tt += 1 / v
    for lap in (2, 3):
        for p in pts: fo.write('%.3f,%.7f,%.7f,%d\n' % (tt, *to_ll(p), lap)); tt += 1 / v
    fo.write('%.3f,%.7f,%.7f,4\n' % (tt, *to_ll(pts[0])))
# Superposición: OSM (azul, todos los tramos), elegido (gris), Apex (rojo), metas.
bt = lambda p: z * ((p - mb).conjugate() if refl else (p - mb))
allp = [bt(pos[n]) for n in pos] + [x - ma for x in A['pts']]
x0 = min(p.real for p in allp); x1 = max(p.real for p in allp); y0 = min(p.imag for p in allp); y1 = max(p.imag for p in allp)
S = 900 / max(x1 - x0, y1 - y0 or 1)
F = lambda c: '%.1f,%.1f' % ((c.real - x0) * S + 50, (y1 - c.imag) * S + 50)
svg = ['<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000"><rect width="1000" height="1000" fill="white"/>']
for e in ways:
    svg.append('<polyline fill="none" stroke="#bde" stroke-width="12" points="%s"/>' % ' '.join(F(bt(to_xy(g_['lat'], g_['lon']))) for g_ in e['geometry']))
svg.append('<polygon fill="none" stroke="#557" stroke-width="5" points="%s"/>' % ' '.join(F(bt(p)) for p in cyc))
svg.append('<polyline fill="none" stroke="red" stroke-width="2" points="%s"/>' % ' '.join(F(x - ma) for x in A['pts']))
k2 = loop[min(25, len(loop) - 1)] if len(loop) > 2 else loop[-1]
svg.append('<circle cx="%s" cy="%s" r="10" fill="red"/>' % tuple(F(sf).split(',')))
svg.append('<circle cx="%s" cy="%s" r="7" fill="black"/>' % tuple(F(bt(pr)).split(',')))
svg.append('<circle cx="%s" cy="%s" r="6" fill="green"/>' % tuple(F(bt(cyc[(i + 3) % len(cyc)])).split(',')))
svg.append('</svg>')
open(os.path.join(W, slug + '.overlay.svg'), 'w').write(''.join(svg))
json.dump({'slug': slug, 'meta': [round(la, 6), round(lo, 6)], 'bearing': round(brg), 'lengthM': round(length(cyc)),
           'error': round(r, 3), 'apex': A['title'], 'osm_cycle': ci}, open(os.path.join(W, slug + '.result.json'), 'w'))
