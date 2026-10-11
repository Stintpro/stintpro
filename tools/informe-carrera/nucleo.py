"""Carga, reparación y análisis de una carrera grabada por el StintPro Logger.

Todo lo que el informe afirma con números sale de aquí. Convenciones:
- Vuelta oficial L: incluye las dos vueltas "ocultas" de cada parada (entrada y salida de box),
  que Apex no publica como tiempo de vuelta.
- T[d][L-1]: instante (s desde el cero de carrera) en que el kart d completa la vuelta oficial L.
- LOG[d]: [(t, tiempo_vuelta, L)] solo de las vueltas cronometradas.
- Hueco a igualdad de vuelta con un rival r: T[r][L-1] - T[yo][L-1]  (positivo = voy delante).
"""
import json, os, collections, bisect, urllib.request
import numpy as np

BASE = os.environ.get('STINTPRO_LOGGER_URL', 'https://stintpro.duckdns.org')
KEYFILE = os.path.expanduser('~/.config/stintpro/api_key')


def api_key():
    k = os.environ.get('STINTPRO_API_KEY')
    if not k and os.path.exists(KEYFILE):
        k = open(KEYFILE).read().strip()
    if not k:
        raise SystemExit(f'Falta la API key del logger: define STINTPRO_API_KEY o crea {KEYFILE}')
    return k


def api(path):
    req = urllib.request.Request(BASE + path, headers={'x-api-key': api_key()})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def descargar(sid, carpeta):
    os.makedirs(carpeta, exist_ok=True)
    for e in ('laps', 'pits', 'snapshot'):
        f = os.path.join(carpeta, f'{e}-{sid}.json')
        if not os.path.exists(f):
            json.dump(api(f'/api/{e}/{sid}'), open(f, 'w'))
    f = os.path.join(carpeta, f'sesion-{sid}.json')
    if not os.path.exists(f):
        ses = [s for s in api('/api/sessions?limit=200') if s['id'] == sid]
        json.dump(ses[0] if ses else {'id': sid}, open(f, 'w'))


def fmt(s, dec=3):
    """Tiempo de vuelta en m:ss.sss (nunca segundos a pelo)."""
    return f"{int(s // 60)}:{s % 60:0{dec + 3 if dec else 2}.{dec}f}"


def coma(v, n=1, signo=True):
    return (f"{v:+.{n}f}" if signo else f"{v:.{n}f}").replace('.', ',').replace('-', '−')


class Carrera:
    def __init__(self, carpeta, carrera, crono=None):
        L = lambda e, i: json.load(open(os.path.join(carpeta, f'{e}-{i}.json')))
        self.id, self.crono_id = carrera, crono
        self.sesion = L('sesion', carrera)
        self.snap, self.pits_raw = L('snapshot', carrera), L('pits', carrera)
        laps = L('laps', carrera)
        self.avisos, self.reparaciones = [], []
        # --- cero de carrera: relanzamiento si hubo parón largo al principio; si no, primer paso por meta
        first = min(l['timestamp'] for l in laps)
        self.relanzada = None
        ev = self.snap.get('raceEvents') or []
        for e in ev:
            if e['type'] == 'resumed' and e.get('durationMs', 0) > 60000 and e['time'] - first < 15 * 60000:
                self.relanzada = dict(paron_s=e['durationMs'] / 1000, tras_s=(e['time'] - e['durationMs'] - first) / 1000)
                t0 = e['time']
        if self.relanzada:
            laps = [l for l in laps if l['timestamp'] > t0]
            self.pits = [p for p in self.pits_raw if p['timestamp'] > t0 + 60000]
        else:
            t0, self.pits = first, self.pits_raw
        self.t0 = t0
        self.names = {l['dorsal']: l['name'] for l in laps}
        # --- pasos por meta, quitando duplicados
        by = collections.defaultdict(list)
        for l in sorted(laps, key=lambda l: l['timestamp']):
            t, v, K = (l['timestamp'] - t0) / 1000, l['lap_time_ms'] / 1000, by[l['dorsal']]
            if K and (t - K[-1][0] < 20 or (abs(v - K[-1][1]) < 1e-6 and t - K[-1][0] < 34.5)):
                self.reparaciones.append(('duplicado', l['dorsal'], round(t, 1)))
                continue
            K.append((t, v))
        self.by = by
        # --- paradas (in/out emparejados, solo paradas reales)
        self.stops = collections.defaultdict(list)
        for p in sorted(self.pits, key=lambda p: p['timestamp']):
            t, S = (p['timestamp'] - t0) / 1000, self.stops[p['dorsal']]
            if p['event_type'] == 'in':
                S.append([t, None, None])
            elif S and S[-1][1] is None:
                S[-1][1], S[-1][2] = t, p.get('duration_ms')
        for d in list(self.stops):
            self.stops[d] = [s for s in self.stops[d] if s[1] and s[1] - s[0] > 60]
        # --- vueltas oficiales
        self.eq = {e['dorsal']: e for e in self.snap['equipos']}
        self.orden = [e['dorsal'] for e in self.snap['equipos']]
        self.tours = {d: e['tours'] for d, e in self.eq.items()}
        allv = sorted(v for K in by.values() for _, v in K)
        self.vuelta_tipo = allv[len(allv) // 2]
        self.T, self.LOG = {}, {}
        for d, K in by.items():
            ev = [(t, v, True) for t, v in K if not any(a < t < b - 0.5 and t - a > 5 for a, b, _ in self.stops[d])]
            for a, b, _ in self.stops[d]:
                ev.append((a, None, False))
                nxt = [(t, v) for t, v, ok in ev if ok and t > b]
                if nxt:
                    t, v = min(nxt)
                    ev.append((t - v, None, False))
            ev.sort(key=lambda e: e[0])
            Td = [e[0] for e in ev]
            i = 0
            while i < len(Td) - 1 and len(Td) < self.tours.get(d, 0):   # paso por meta no registrado
                if 1.85 * self.vuelta_tipo < Td[i + 1] - Td[i] < 2.15 * self.vuelta_tipo:
                    Td.insert(i + 1, (Td[i] + Td[i + 1]) / 2)
                    self.reparaciones.append(('no registrado', d, round(Td[i + 1], 1)))
                i += 1
            log, k = [], 0
            for t, v, ok in ev:
                if not ok:
                    continue
                while abs(Td[k] - t) > 1e-6:
                    k += 1
                log.append((t, v, k + 1))
            self.T[d], self.LOG[d] = Td, log
            if d in self.tours and len(Td) != self.tours[d]:
                self.avisos.append(f'kart {d}: {len(Td)} vueltas reconstruidas frente a {self.tours[d]} oficiales')
        # un paso por meta registrado a destiempo aparece como duplicado + no registrado: no es una anomalía doble
        nor = {(d, t) for k, d, t in self.reparaciones if k == 'no registrado'}
        self.reparaciones = [(k, d, t) for k, d, t in self.reparaciones
                             if not (k == 'duplicado' and any(d == d2 and abs(t - t2) < 15 for d2, t2 in nor))]
        dup = {(d, t) for k, d, t in self.reparaciones if k == 'duplicado'}
        self.fin = max(max(t) for t in self.T.values())
        self.la = {d: {l: v for _, v, l in self.LOG[d]} for d in self.T}
        self.fpos = {e['dorsal']: e['pos'] for e in self.snap['equipos']}
        calc = self.pos_en(self.fin + 1)
        ok = [d for d in self.orden if d in self.T and len(self.T[d]) == self.tours[d]]
        mal = [d for a, d in zip(sorted(ok, key=lambda d: calc[d]), ok) if a != d]
        if mal:
            self.avisos.append('la clasificación reconstruida no coincide con la oficial en los karts ' + ', '.join(mal))
        self.allc = sorted((t, d) for d in by for t, _ in by[d])
        self._tsall = [a for a, _ in self.allc]
        # --- crono
        self.q = None
        if crono:
            qs, ql = L('snapshot', crono), L('laps', crono)
            base = qs['equipos'][0]['bestLap']
            qb = collections.defaultdict(list)
            for l in ql:
                qb[l['dorsal']].append(l['lap_time_ms'] / 1000)
            num = lambda g: float(g) if g and g[0] == '+' and 'v' not in g else 0.0
            self.q = dict(pos={e['dorsal']: e['pos'] for e in qs['equipos']},
                          best={e['dorsal']: base + num(e['gap']) for e in qs['equipos']},
                          laps=dict(qb), orden=[e['dorsal'] for e in qs['equipos']])

    # ---------- utilidades ----------
    def nombre(self, d, corto=False):
        """Nombre del piloto; corto = 'dorsal Apellido' (con inicial si el apellido se repite)."""
        n = getattr(self, 'alias', {}).get(d) or self.names.get(d, d).title()
        if not corto:
            return n
        p = n.split()
        ap = p[-1] if len(p[-1]) > 2 else n
        rep = sum(1 for x in self.names if (getattr(self, 'alias', {}).get(x) or self.names[x].title()).split()[-1] == p[-1])
        return f"{d} {p[0][0]}. {ap}" if rep > 1 and len(p) > 1 else f"{d} {ap}"

    def pos_en(self, t):
        r = []
        for d, Td in self.T.items():
            k = bisect.bisect_right(Td, t + 1e-6)
            r.append((-k, Td[k - 1] if k else 0, d))
        r.sort()
        return {d: i + 1 for i, (_, _, d) in enumerate(r)}

    def ocultas(self, d):
        logged = set(self.la[d])
        return [l for l in range(1, len(self.T[d]) + 1) if l not in logged]

    def paradas_vuelta(self, d):
        """Pares (vuelta de entrada, vuelta de salida) de cada parada."""
        o = self.ocultas(d)
        return [(a, b) for a, b in zip(o, o[1:]) if b == a + 1][:len(self.stops[d]) or None]

    def stints(self, d):
        """[(L_ini, L_fin)] de cada stint, por huecos de numeración en las vueltas cronometradas."""
        Ls = sorted(self.la[d])
        out, a = [], Ls[0]
        for x, y in zip(Ls, Ls[1:]):
            if y - x > 1 and (x + 1, x + 2) in self.paradas_vuelta(d):
                out.append((a, x)); a = y
        out.append((a, Ls[-1]))
        return out

    def limpias(self, d, tope=None):
        """Tiempos de vuelta sin la salida ni la primera vuelta de cada stint (ni vueltas atípicas)."""
        tope = tope or self.vuelta_tipo + 1.6
        ini = {a for a, _ in self.stints(d)}
        return [v for l, v in self.la[d].items() if l not in ini and v < tope]

    def stats(self, d):
        x = self.limpias(d)
        return dict(media=float(np.mean(x)), mediana=float(np.median(x)), q1=float(np.percentile(x, 25)),
                    q3=float(np.percentile(x, 75)), mejor=min(self.la[d].values()), sd=float(np.std(x)), n=len(x))

    def stint_stats(self, d):
        out = []
        for a, b in self.stints(d):
            x = [self.la[d][l] for l in range(a + 1, b + 1) if l in self.la[d]] or [self.la[d][a]]
            out.append(dict(ini=a, fin=b, n=b - a + 1, media=float(np.mean(x)), mediana=float(np.median(x)),
                            mejor=min(x), sd=float(np.std(x))))
        return out

    def ciclos(self, d):
        """Paso completo por box: de la última vuelta antes de entrar a la primera cronometrada tras salir."""
        Td = self.T[d]
        return [Td[b] - Td[a - 2] for a, b in self.paradas_vuelta(d) if a >= 2 and b < len(Td)]

    def estado(self, d, L):
        """Nº de paradas completadas en la vuelta L, o None si está en plena parada."""
        n = 0
        for a, b in self.paradas_vuelta(d):
            if L in (a, b):
                return None
            if L > b:
                n += 1
        return n

    def hueco(self, yo, r, L):
        if L > len(self.T[yo]) or L > len(self.T[r]):
            return None
        return self.T[r][L - 1] - self.T[yo][L - 1]

    def comparable(self, yo, r, L):
        a, b = self.estado(yo, L), self.estado(r, L)
        return a is not None and a == b and self.hueco(yo, r, L) is not None

    def tramos_comparables(self, yo, r):
        n = min(len(self.T[yo]), len(self.T[r]))
        out, cur = [], None
        for L in range(1, n + 1):
            if self.comparable(yo, r, L):
                cur = [L, L] if cur is None else [cur[0], L]
            elif cur:
                out.append(tuple(cur)); cur = None
        if cur:
            out.append(tuple(cur))
        return [t for t in out if t[1] - t[0] >= 1]

    def hueco_oficial(self, yo, r):
        """Diferencia oficial en meta (positivo = acabo delante). None si no están en la misma vuelta."""
        base, grupo = {}, 0
        for e in self.snap['equipos']:
            g = e['gap']
            if 'v' in g:
                grupo += 1; base[e['dorsal']] = (grupo, 0.0)
            else:
                base[e['dorsal']] = (grupo, float(g) if g else 0.0)
        if base[yo][0] != base[r][0]:
            return None
        return base[r][1] - base[yo][1]

    def cascada(self, yo, r):
        """Descompone la evolución del hueco con r en tramos comparables y fases de paradas descompasadas."""
        tr = self.tramos_comparables(yo, r)
        if not tr:
            return []
        g = lambda L: self.hueco(yo, r, L)
        pasos = [dict(tipo='abs', etiqueta=f'Hueco\nvuelta {tr[0][0]}', valor=g(tr[0][0]))]
        for i, (a, b) in enumerate(tr):
            if i:
                pa, pb = tr[i - 1][1], a
                pasos.append(dict(tipo='d', etiqueta=f'Paradas\ndescompasadas\n(v{pa}-{pb})', valor=g(pb) - g(pa), fase='paradas', ini=pa, fin=pb))
            if b > a:
                pasos.append(dict(tipo='d', etiqueta=f'En pista\n(v{a}-{b})', valor=g(b) - g(a), fase='pista', ini=a, fin=b))
        of = self.hueco_oficial(yo, r)
        final = of if of is not None else g(tr[-1][1])
        pasos[-1]['valor'] += final - g(tr[-1][1])     # cuadra con la diferencia oficial
        pasos.append(dict(tipo='abs', etiqueta='Hueco\nen meta', valor=final, oficial=of is not None))
        return pasos

    def vecinos(self, yo, t):
        j = bisect.bisect_left(self._tsall, t - 1e-6)
        while self.allc[j][1] != yo:
            j += 1
        a = self.allc[j - 1] if j else None
        b = self.allc[j + 1] if j + 1 < len(self.allc) else None
        return ((a[1], t - a[0]) if a else (None, None)), ((b[1], b[0] - t) if b else (None, None))

    def eventos(self, yo):
        """Cambios de orden con cada kart a igualdad de vuelta (adelantamientos reales, no por paradas)."""
        out = []
        for r in self.T:
            if r == yo:
                continue
            prev = None
            for L in range(1, min(len(self.T[yo]), len(self.T[r])) + 1):
                if not self.comparable(yo, r, L):
                    continue
                g = self.hueco(yo, r, L)
                if abs(g) > 30:
                    prev = None; continue
                if prev and prev[0] == L - 1 and min(prev[1], g) < -0.15 and max(prev[1], g) > 0.15:
                    out.append((L, r, 'adelanto a' if g > 0 else 'me pasa'))
                prev = (L, g)
        return sorted(out)
