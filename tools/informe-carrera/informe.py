#!/usr/bin/env python3
"""Informe de carrera en PDF a partir de una sesión del StintPro Logger.

  informe.py sesiones [--circuito henakart] [--n 40]        lista sesiones recientes (para sacar los IDs)
  informe.py analiza --carrera ID [--crono ID] --dorsal N   descarga, analiza y crea trabajo/<ID>-<N>/ (analisis.md + informe.json)
  informe.py kart trabajo/<ID>-<N>                          el kart en todas las sesiones del día (calidad del kart)
  informe.py pdf trabajo/<ID>-<N>                           genera gráficos y PDF con los textos de informe.json
  informe.py revisar trabajo/<ID>-<N>                       renderiza las páginas a PNG para revisarlas

El criterio de análisis y redacción está en el skill `informe-carrera`.
"""
import argparse, datetime, json, os, re, sys, unicodedata
import numpy as np
AQUI = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, AQUI)
import nucleo as N
from nucleo import fmt, coma
INFORMES = os.path.normpath(os.path.join(AQUI, '..', '..', '..', 'Informes'))


def cargar(carpeta):
    cfg = json.load(open(os.path.join(carpeta, 'informe.json')))
    R = N.Carrera(carpeta, cfg['carrera'], cfg.get('crono'), cfg.get('crono_alias'))
    R.alias = cfg.get('nombres') or {}
    return R, cfg


def cmd_sesiones(a):
    for s in N.api('/api/sessions?limit=200'):
        if a.circuito and a.circuito.lower() not in (s['slug'] + s['circuit_name']).lower():
            continue
        d = datetime.datetime.fromtimestamp(s['started_at'] / 1000)
        print(f"{s['id']:>6}  {d:%Y-%m-%d %H:%M}  {s['circuit_name']:<18} {s['title']:<34} {s['lap_count']:>5} vueltas")
        a.n -= 1
        if not a.n:
            break


def cmd_analiza(a):
    yo = str(a.dorsal); carpeta = os.path.join(AQUI, 'trabajo', f'{a.carrera}-{yo}')
    N.descargar(a.carrera, carpeta)
    if a.crono:
        N.descargar(a.crono, carpeta)
    R = N.Carrera(carpeta, a.carrera, a.crono)
    if yo not in R.T:
        raise SystemExit(f'El dorsal {yo} no está en la sesión {a.carrera}. Dorsales: ' + ', '.join(f"{d} {R.nombre(d)}" for d in R.orden))
    o, k = R.orden, R.orden.index(yo)
    cerca = lambda n_: [d for d in o[max(0, k - n_):k] + o[k + 1:k + 1 + n_] if d in R.T]
    riv = [d for d in (a.rivales.split(',') if a.rivales else cerca(2))]
    grupo = [d for d in o[max(0, min(k - 4, len(o) - 9)):max(0, min(k - 4, len(o) - 9)) + 9] if d in R.T]
    cfgf = os.path.join(carpeta, 'informe.json')
    if os.path.exists(cfgf) and not a.reiniciar:
        cfg = json.load(open(cfgf)); print('informe.json ya existe: se conserva (usa --reiniciar para rehacerlo)')
    else:
        tit = R.sesion.get('title', '')
        cfg = dict(carrera=a.carrera, crono=a.crono, dorsal=yo, piloto=R.nombre(yo), categoria=tit.split(' · ')[0] if tit else 'CARRERA',
                   circuito=R.sesion.get('circuit_name', ''), nombres={}, rivales=riv, duelos=riv[:2], cascada=riv[0], grupo=grupo,
                   tabla=[d for d in o[max(0, k - 3):k + 4]], box=[d for d in dict.fromkeys(o[:2] + o[max(0, k - 3):k + 4])],
                   anotaciones=[], notas_vuelta={}, cascada_etiquetas=None,
                   textos=dict(tiles=[['PENDIENTE', 'PENDIENTE', True]] * 6, veredicto='PENDIENTE', tabla_nota='', pos_caption='PENDIENTE', lectura=['PENDIENTE'],
                               stint_contexto=['PENDIENTE'] * len(R.stints(yo)), vueltas=['PENDIENTE'], ritmo=['PENDIENTE'] * 3,
                               final=dict(titulo='PENDIENTE', intro='', bullets=['PENDIENTE']), duelo=dict(titulo='PENDIENTE', intro='', bullets=['PENDIENTE']),
                               box=dict(caption='PENDIENTE', bullets=['PENDIENTE']), crono=dict(caption='PENDIENTE'), valoracion=['PENDIENTE'], plan=['PENDIENTE'], limites=[]))
        json.dump(cfg, open(cfgf, 'w'), ensure_ascii=False, indent=1)
    # ---------------- analisis.md: los hechos, para redactar ----------------
    W = []; w = W.append
    q = R.q; st = {d: R.stats(d) for d in R.T}; me = R.LOG[yo]; A = R.T[yo]; nl = len(A)
    w(f"# Análisis · sesión {a.carrera} · kart {yo} {R.nombre(yo)}\n")
    w(f"- Sesión: {R.sesion.get('circuit_name')} · {R.sesion.get('title')} · {datetime.datetime.fromtimestamp(R.sesion.get('started_at', R.t0) / 1000):%Y-%m-%d %H:%M}")
    w(f"- {len(R.T)} karts · {R.tours[o[0]]} vueltas · duración {fmt(R.fin, 0)} · parada obligatoria {R.snap.get('mandatoryPitSec')} s · vuelta tipo {fmt(R.vuelta_tipo)}")
    w(f"- Relanzada: {R.relanzada}" if R.relanzada else '- Sin relanzamiento')
    w(f"- Reparaciones: {R.reparaciones or 'ninguna'}"); w(f"- AVISOS: {R.avisos or 'ninguno'}\n")
    w('## Clasificación (ritmo sin salida ni 1ª vuelta de stint)\n')
    w('| Pos | Kart | Piloto | Crono | Vueltas | Dif | Mejor | Media | Mediana | σ | Paradas (min · vueltas) | Paso por box (s) |'); w('|---|---|---|---|---|---|---|---|---|---|---|---|')
    rk = sorted(st, key=lambda d: st[d]['media'])
    for e in R.snap['equipos']:
        d = e['dorsal']
        if d not in R.T: continue
        w(f"| P{e['pos']}{' **YO**' if d == yo else ''} | {d} | {R.nombre(d)} | {('P%d %s' % (q['pos'][d], fmt(q['best'][d]))) if q and d in q['pos'] else '—'} | {e['tours']} | {e['gap'] or '—'} | {fmt(e['bestLap'])} | {fmt(st[d]['media'])} (#{rk.index(d) + 1}) | {fmt(st[d]['mediana'])} | {st[d]['sd']:.3f} | "
          f"{', '.join('%.1f' % (x[0] / 60) for x in R.stops[d])} · {R.paradas_vuelta(d)} · crono parada {[x[2] // 1000 if x[2] else None for x in R.stops[d]]} | {', '.join('%.1f' % c for c in R.ciclos(d))} |")
    w(f"\n## Mis stints\n"); w('| Stint | Vueltas | n | Media (sin 1ª) | Mediana | Mejor | σ |'); w('|---|---|---|---|---|---|---|')
    for i, s in enumerate(R.stint_stats(yo)):
        w(f"| {i + 1} | {s['ini']}-{s['fin']} | {s['n']} | {fmt(s['media'])} | {fmt(s['mediana'])} | {fmt(s['mejor'])} | {s['sd']:.3f} |")
    x = [v for l, v in R.la[yo].items() if l > 1]; md = float(np.median(x))
    w(f"\n- Vueltas por debajo de {fmt(md - .15)}: {sum(v < md - .15 for v in x)} · por encima de {fmt(md + .4)}: {sum(v > md + .4 for v in x)} · total {len(x)}")
    w(f"- Paso por box: {[round(c, 1) for c in R.ciclos(yo)]} s · mejor de la carrera: {min(((min(R.ciclos(d)), d) for d in R.T if R.ciclos(d)), default='sin paradas en la carrera')}")
    w('\n## Mis vueltas (pos = clasificación en vivo; delante/detrás = en pista al paso por meta, con su posición final)\n')
    w('| V | Tiempo | Pos | Delante en pista | Detrás en pista |'); w('|---|---|---|---|---|')
    log = {l: (t, v) for t, v, l in me}
    for l in range(1, nl + 1):
        if l not in log:
            w(f'| {l} | box | | | |'); continue
        t, v = log[l]; (da, ga), (db, gb) = R.vecinos(yo, t)
        fa = f"{da} {R.nombre(da, True).split(' ', 1)[1]} (P{R.fpos.get(da)}) a {ga:.1f}" if da else ''
        fb = f"{db} {R.nombre(db, True).split(' ', 1)[1]} (P{R.fpos.get(db)}) a {gb:.1f}" if db else ''
        w(f"| {l} | {fmt(v)} | P{R.pos_en(t)[yo]} | {fa} | {fb} |")
    w('\n## Cambios de orden a igualdad de vuelta y de paradas (adelantamientos reales)\n')
    for L_, r, k_ in R.eventos(yo):
        w(f"- v{L_}: {k_} {r} {R.nombre(r)} (P{R.fpos.get(r)})")
    w('\n## Hueco a igualdad de vuelta (positivo = voy delante; · = no comparable por paradas)\n')
    for r in dict.fromkeys(riv + cerca(4)):
        tr = R.tramos_comparables(yo, r)
        w(f"**{r} {R.nombre(r)} (P{R.fpos[r]})** · tramos comparables {tr} · oficial en meta {R.hueco_oficial(yo, r)}")
        w('`' + ' '.join(f"{L_}:{R.hueco(yo, r, L_):+.1f}" if R.comparable(yo, r, L_) else f"{L_}:·" for L_ in range(1, min(nl, len(R.T[r])) + 1)) + '`')
        w('cascada: ' + ' → '.join(f"[{p['etiqueta'].replace(chr(10), ' ')}: {p['valor']:+.2f}]" for p in R.cascada(yo, r)) + '\n')
    ult = R.stints(yo)[-1]; d0 = ult[0] if ult[1] - ult[0] >= 4 else nl - 9
    w(f'## Último stint (v{d0}-{nl}): media por piloto y vueltas\n')
    for d in [yo] + list(dict.fromkeys(riv + cerca(4))):
        vs = [R.la[d].get(l) for l in range(d0, nl + 1)]
        w(f"- {d} {R.nombre(d)}: media {fmt(np.mean([v for v in vs if v]))} · " + ' '.join(fmt(v, 2)[2:] if v else 'box' for v in vs))
    if q and yo in q['pos']:
        w('\n## Crono\n'); k2 = q['orden'].index(yo)
        for d in q['orden'][max(0, k2 - 3):k2 + 4]:
            w(f"- P{q['pos'][d]} {d} {R.nombre(d) if d in R.names else d} (kart {q['kart'].get(d, d)} en el crono): {fmt(q['best'][d])} · vueltas: " + ' '.join(fmt(v, 3)[2:] for v in q['laps'].get(d, [])))
        w(f"- Pole: {fmt(q['best'][q['orden'][0]])}")
    open(os.path.join(carpeta, 'analisis.md'), 'w').write('\n'.join(W) + '\n')
    print(f'Carpeta de trabajo: {carpeta}\n  analisis.md  -> hechos para redactar\n  informe.json -> rivales, grupo y textos (rellenar los PENDIENTE)')
    for av in R.avisos:
        print('  AVISO:', av)


def cmd_kart(a):
    """Rendimiento del kart de la carrera en todas las sesiones del día, y cada piloto que lo llevó frente a sí mismo en otro kart."""
    import statistics as S
    R, cfg = cargar(a.carpeta); k = str(a.kart or cfg['dorsal'])
    clave = lambda n: unicodedata.normalize('NFKD', n or '').encode('ascii', 'ignore').decode().upper().strip()
    dia = datetime.datetime.fromtimestamp(R.sesion['started_at'] / 1000).date()
    ses = sorted((x for x in N.api('/api/sessions?limit=300') if x['slug'] == R.sesion['slug']
                  and datetime.datetime.fromtimestamp(x['started_at'] / 1000).date() == dia and x['started_at'] <= R.sesion['started_at'] + 3600e3), key=lambda x: x['started_at'])
    filas, porpiloto = [], {}
    cat = lambda t: re.sub(r'^(Q|R|CLASIFICACION|CARRERA)\s*-\s*', '', clave(t))
    for x in ses:
        by = {}
        for l in N.api(f"/api/laps/{x['id']}"):
            by.setdefault((l['dorsal'], clave(l['name'])), []).append(l['lap_time_ms'] / 1000)
        tipo = S.median([v for z in by.values() for v in z])
        med = {d: S.median(c) for d, z in by.items() if len(c := [v for v in z if v < tipo + 1.6]) >= 3}
        best = {d: min(z) for d, z in by.items()}; pole = min(best.values()); mc = S.median(med.values())
        rb, rm = sorted(best, key=best.get), sorted(med, key=med.get)
        for d in by:
            r = dict(sesion=x['id'], titulo=x['title'], hora=datetime.datetime.fromtimestamp(x['started_at'] / 1000).strftime('%H:%M'), kart=d[0], piloto=d[1],
                     vueltas=len(by[d]), mejor=best[d], mejor_vs_pole=best[d] - pole, rk_mejor=rb.index(d) + 1, n=len(rb),
                     mediana=med.get(d), mediana_vs_campo=(med[d] - mc) if d in med else None, rk_mediana=(rm.index(d) + 1) if d in med else None, n_med=len(rm))
            porpiloto.setdefault(d[1], []).append(r)
            if d[0] == k:
                filas.append(r)
    # mismo piloto, otra sesión del día en otro kart: aísla el kart del piloto
    pares = []
    for r in filas:
        if r['piloto'].startswith('KART '):
            continue
        for o in porpiloto.get(r['piloto'], []):
            # misma categoría (Q y R del mismo grupo): entre categorías cambia el lastre y no es comparable
            if o['sesion'] != r['sesion'] and o['kart'] != k and cat(o['titulo']) == cat(r['titulo']):
                pares.append(dict(piloto=r['piloto'], con=dict(r), sin=dict(o)))
    cfg['kart_dia'] = dict(kart=k, filas=filas, pares=pares)
    json.dump(cfg, open(os.path.join(a.carpeta, 'informe.json'), 'w'), ensure_ascii=False, indent=1)
    print(f'Kart {k} · {len(filas)} sesiones del día con él (mediana vs campo: negativo = más rápido que la mediana)')
    for r in filas:
        print(f"  {r['sesion']} {r['hora']} {r['titulo']:<22} {r['piloto']:<20} {r['vueltas']:>2} v · mejor {fmt(r['mejor'])} #{r['rk_mejor']}/{r['n']} (+{r['mejor_vs_pole']:.3f})"
              + (f" · mediana {fmt(r['mediana'])} #{r['rk_mediana']}/{r['n_med']} ({r['mediana_vs_campo']:+.3f})" if r['mediana'] else ' · sin vueltas limpias'))
    print('Mismo piloto con y sin este kart (mejor vs pole · mediana vs campo):')
    for p in pares:
        c, o = p['con'], p['sin']
        f_ = lambda r: f"{r['titulo']} kart {r['kart']}: +{r['mejor_vs_pole']:.3f} · " + ('%+.3f' % r['mediana_vs_campo'] if r['mediana'] else '—')
        print(f"  {p['piloto']:<18} {f_(c)}   |   {f_(o)}")


def cmd_pdf(a):
    import graficos, maqueta
    R, cfg = cargar(a.carpeta)
    pend = [m.start() for m in re.finditer('PENDIENTE', json.dumps(cfg['textos'], ensure_ascii=False))]
    if pend and not a.borrador:
        raise SystemExit(f'Quedan {len(pend)} textos PENDIENTE en informe.json (usa --borrador para maquetar igualmente).')
    graf = os.path.join(a.carpeta, 'graficos'); os.makedirs(graf, exist_ok=True)
    graficos.generar(R, cfg, graf)
    d0 = datetime.datetime.fromtimestamp(R.sesion.get('started_at', R.t0) / 1000)
    lim = lambda s: re.sub(r'[^A-Za-z0-9]+', '', unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().title())
    salida = cfg.get('salida') or os.path.join(INFORMES, f"Informe_{lim(cfg['circuito'])}_{lim(cfg['categoria'])}_Kart{cfg['dorsal']}_{lim(cfg['piloto'])}_{d0:%Y-%m-%d}.pdf")
    if a.borrador:
        salida = os.path.join(a.carpeta, 'borrador.pdf')
    print(maqueta.construir(R, cfg, graf, salida))
    json.dump(dict(pdf=salida), open(os.path.join(a.carpeta, '.ultimo.json'), 'w'))


def cmd_revisar(a):
    import fitz
    from PIL import Image
    pdf = json.load(open(os.path.join(a.carpeta, '.ultimo.json')))['pdf']
    out = os.path.join(a.carpeta, 'revision'); os.makedirs(out, exist_ok=True)
    d = fitz.open(pdf); ims = []
    for i, p in enumerate(d):
        f = os.path.join(out, f'pag{i + 1}.png'); p.get_pixmap(dpi=90).save(f); ims.append(Image.open(f))
        bl = [b for b in p.get_text('blocks') if b[3] < 800]
        print(f"pág {i + 1}: contenido hasta y={max(b[3] for b in bl):.0f} de 802" + ('  <-- casi vacía, revisar desbordes' if max(b[3] for b in bl) < 150 else ''))
    w, h = ims[0].size; w2, h2 = int(w * .62), int(h * .62)
    for k in range(0, len(ims), 4):
        sh = Image.new('RGB', (w2 * 4 + 30, h2), '#888')
        for i, im in enumerate(ims[k:k + 4]):
            sh.paste(im.resize((w2, h2)), (i * (w2 + 10), 0))
        sh.save(os.path.join(out, f'hoja{k // 4 + 1}.png'))
    print(f'{len(d)} páginas · imágenes en {out} (hojaN.png = vista de conjunto, pagN.png = detalle)')


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('sesiones'); p.add_argument('--circuito'); p.add_argument('--n', type=int, default=40); p.set_defaults(f=cmd_sesiones)
    p = sub.add_parser('analiza'); p.add_argument('--carrera', type=int, required=True); p.add_argument('--crono', type=int); p.add_argument('--dorsal', required=True)
    p.add_argument('--rivales', help='dorsales separados por coma (por defecto, los 2 de delante y los 2 de detrás)'); p.add_argument('--reiniciar', action='store_true'); p.set_defaults(f=cmd_analiza)
    p = sub.add_parser('kart'); p.add_argument('carpeta'); p.add_argument('--kart', help='por defecto, el dorsal de la carrera'); p.set_defaults(f=cmd_kart)
    p = sub.add_parser('pdf'); p.add_argument('carpeta'); p.add_argument('--borrador', action='store_true'); p.set_defaults(f=cmd_pdf)
    p = sub.add_parser('revisar'); p.add_argument('carpeta'); p.set_defaults(f=cmd_revisar)
    a = ap.parse_args(); a.f(a)
