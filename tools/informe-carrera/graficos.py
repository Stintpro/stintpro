"""Gráficos del informe. Mismo estilo siempre: yo en azul, hasta 4 rivales en color fijo, resto en gris."""
import os
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter, MultipleLocator
from nucleo import fmt, coma

AZUL, RIV = '#2a78d6', ['#eb6834', '#1baf7a', '#eda100', '#e87ba4']   # paleta validada (dataviz)
GR, INK, SEC, BANDA = '#a9a8a1', '#0b0b0b', '#52514e', '#f1f0ec'
plt.rcParams.update({'font.family': ['Arial', 'DejaVu Sans'], 'font.size': 8.5, 'axes.spines.top': False, 'axes.spines.right': False,
    'axes.edgecolor': '#c9c8c2', 'axes.linewidth': .8, 'xtick.color': SEC, 'ytick.color': SEC, 'axes.labelcolor': SEC,
    'text.color': INK, 'axes.grid': True, 'grid.color': '#ebeae6', 'grid.linewidth': .7, 'axes.axisbelow': True,
    'figure.facecolor': 'white', 'axes.facecolor': 'white', 'savefig.dpi': 220, 'savefig.bbox': 'tight', 'legend.frameon': False,
    'xtick.major.size': 0, 'ytick.major.size': 0, 'axes.titlesize': 10, 'axes.titleweight': 'bold', 'axes.titlelocation': 'left'})
lapfmt = FuncFormatter(lambda v, _: fmt(v, 1))


def paso(rango):
    return next(p for p in (.1, .2, .5, 1, 2, 5) if rango / p <= 8)


def generar(R, cfg, out):
    yo, riv = cfg['dorsal'], cfg['rivales'][:4]
    C = {yo: AZUL, **{d: RIV[i] for i, d in enumerate(riv)}}
    SN = lambda d: R.nombre(d, corto=True)
    ap = lambda d: SN(d).split(' ', 1)[1]
    me, A, la = R.LOG[yo], R.T[yo], R.la
    end, n = R.fin, len(R.T)
    box_t = [(a, b) for a, b, _ in R.stops[yo]]
    box_l = R.paradas_vuelta(yo)
    relanz = ' (desde el relanzamiento)' if R.relanzada else ''
    save = lambda fig, name: (fig.savefig(os.path.join(out, f'{name}.png')), plt.close(fig))

    def bandas(ax, vueltas=False):
        for k in range(len(box_l)):
            x0, x1 = (box_l[k][0] - .5, box_l[k][1] + .5) if vueltas else (box_t[k][0] / 60, (box_t[k][1] + 18) / 60)
            ax.axvspan(x0, x1, color=BANDA, zorder=0)

    # 1 ---- evolución de la posición
    ini = max(R.T[d][0] for d in C) + 5
    ts = np.arange(ini, end + 1, 5.0)
    P = {d: [] for d in C}
    for t in ts:
        p = R.pos_en(t)
        for d in C:
            P[d].append(p[d])
    fig, ax = plt.subplots(figsize=(7.3, 3.6))
    ax.set_ylim(n + .8, .3); ax.set_xlim(0, end / 60 + 5.6); bandas(ax)
    for d in riv[::-1] + [yo]:
        ax.step(ts / 60, P[d], where='post', color=C[d], lw=2.6 if d == yo else 1.4, zorder=5 if d == yo else 3)
    ly, prev = {}, -99
    for d in sorted(C, key=lambda d: R.fpos[d]):
        ly[d] = max(R.fpos[d], prev + n * .058); prev = ly[d]
    for d in C:
        ax.text(end / 60 + 1.1, ly[d], f"P{R.fpos[d]} · {SN(d)}", va='center', fontsize=8, fontweight='bold' if d == yo else 'normal')
        ax.plot([end / 60, end / 60 + 1.0], [R.fpos[d], ly[d]], color=C[d], lw=.8)
        ax.plot([end / 60], [R.fpos[d]], 'o', ms=5, color=C[d], mec='white', mew=1, zorder=6)
    for k, (a, b) in enumerate(box_t):
        ax.text((a + b + 18) / 120, n + .5, f'mi BOX {k + 1}', ha='center', va='bottom', fontsize=7, color=SEC)
    ax.set_yticks(sorted({1, 5, 10, 15, 20, 25, 30, n, R.fpos[yo]} - {x for x in (5, 10, 15, 20, 25, 30) if x > n or abs(x - R.fpos[yo]) == 1 or 0 < n - x < 3}))
    ax.set_xticks(range(0, int(end / 60) + 1, 5)); ax.set_xlabel('minuto de carrera' + relanz); ax.set_ylabel('posición en la clasificación')
    ax.set_title('Evolución de la posición (clasificación en vivo, cada 5 s)'); ax.grid(axis='x', visible=False)
    save(fig, 'pos')

    # 2 ---- todas mis vueltas
    L = [x[2] for x in me]; V = [x[1] for x in me]
    cuerpo = [v for l, v in zip(L, V) if l > 1 and v < R.vuelta_tipo + 4]
    best = min(V); ymax = max(cuerpo) + .32; ymin = best - max(.38, .15 * (ymax - best))
    fig, ax = plt.subplots(figsize=(7.3, 3.7)); ax.set_ylim(ymin, ymax); ax.set_xlim(0, max(L) + 1.5); bandas(ax, True)
    for k, (a, b) in enumerate(box_l):
        ax.text((a + b) / 2, ymin + .28 * (ymax - ymin), f'BOX {k + 1}', rotation=90, ha='center', va='center', fontsize=7, color=SEC)
    for i, s in enumerate(R.stint_stats(yo)):
        xs = [l for l, v in zip(L, V) if s['ini'] <= l <= s['fin'] and v < ymax]
        ax.plot(xs, [la[yo][l] for l in xs], color=AZUL, lw=1, alpha=.45)
        ax.plot([s['ini'], s['fin']], [s['media']] * 2, color=INK, lw=1.2, ls=(0, (4, 3)))
        ancho = s['fin'] - s['ini']
        txt = f"stint {i + 1} · media {fmt(s['media'])}" if ancho >= 22 else f"stint {i + 1}\n{fmt(s['media'])}" if ancho < 12 else f"stint {i + 1} · {fmt(s['media'])}"
        ax.text(s['ini'] + (ancho - 20) / 2 if ancho >= 22 else s['ini'] - .4, ymin + .02 * (ymax - ymin), txt, ha='left', va='bottom', fontsize=8, fontweight='bold')
    ax.scatter([l for l, v in zip(L, V) if v < ymax], [v for v in V if v < ymax], s=20, color=AZUL, edgecolor='white', linewidth=.8, zorder=4)
    notas = cfg.get('anotaciones') or [dict(vuelta=L[V.index(best)], texto=f'mejor vuelta {fmt(best)}', dx=2, dy=-.2 * (ymax - ymin) / 3, ha='left')]
    for a in notas:
        l = int(a['vuelta']); v = la[yo][l]
        ax.annotate(a['texto'], (l, v), (l + a.get('dx', 2), v + a.get('dy', .3)), fontsize=7.5, ha=a.get('ha', 'center'), color=INK,
                    arrowprops=dict(arrowstyle='-', color=SEC, lw=.7, shrinkB=3))
    fuera = [(l, v) for l, v in zip(L, V) if v >= ymax]
    if fuera:
        ax.text(max(L) * .42, ymax - .02 * (ymax - ymin), 'fuera de escala: ' + ', '.join(f"v{l} {fmt(v)}" + (' (salida)' if l == 1 else '') for l, v in fuera),
                fontsize=7, color=SEC, va='top')
    ax.yaxis.set_major_formatter(lapfmt); ax.yaxis.set_major_locator(MultipleLocator(paso(ymax - ymin)))
    ax.set_xlabel('vuelta oficial'); ax.set_title(f'Todas mis vueltas cronometradas — kart {yo}')
    save(fig, 'laps')

    # 3 ---- ritmo: media móvil de 5 vueltas
    fig, ax = plt.subplots(figsize=(7.3, 3.2)); allv = []
    for d in riv[:3][::-1] + [yo]:
        for a, b in R.stints(d):
            s_ = [(t, v) for t, v, l in R.LOG[d] if a < l <= b and v < R.vuelta_tipo + 2.4]
            if len(s_) < 5:
                continue
            y = [np.mean([r[1] for r in s_[i - 4:i + 1]]) for i in range(4, len(s_))]; allv += y
            ax.plot([np.mean([r[0] for r in s_[i - 4:i + 1]]) / 60 for i in range(4, len(s_))], y, color=C[d], lw=2.4 if d == yo else 1.5, zorder=5 if d == yo else 3)
        ax.plot([], [], color=C[d], lw=2.4 if d == yo else 1.5, label=SN(d))
    lo, hi = min(allv), max(allv); ax.set_ylim(lo - .1, hi + .28 * (hi - lo + .2)); ax.set_xlim(0, end / 60 + .5); bandas(ax)
    h, l_ = ax.get_legend_handles_labels(); ax.legend(h[::-1], l_[::-1], loc='upper center', ncol=4, fontsize=8, handlelength=1.6, columnspacing=1.4)
    ax.yaxis.set_major_formatter(lapfmt); ax.yaxis.set_major_locator(MultipleLocator(paso(hi - lo + .4)))
    ax.set_xlabel('minuto de carrera'); ax.set_title('Ritmo: media móvil de 5 vueltas (sin vueltas de salida de box)')
    save(fig, 'pace')

    # 4 ---- ritmo y regularidad del grupo
    grupo = cfg['grupo']; st = {d: R.stats(d) for d in grupo}
    x0 = min(s['mejor'] for s in st.values()) - .12; x1 = max(s['q3'] for s in st.values()) + .1; xt = x1 + .08 * (x1 - x0)
    fig, ax = plt.subplots(figsize=(7.3, .9 + .25 * len(grupo)))
    for i, d in enumerate(grupo):
        s = st[d]; col = AZUL if d == yo else GR
        ax.plot([s['q1'], s['q3']], [i, i], color=col, lw=5, alpha=.45, solid_capstyle='round')
        ax.plot([s['media']], [i], 'o', ms=8, color=col, mec='white', mew=1.2, zorder=4); ax.plot([s['mejor']], [i], '|', ms=9, color=INK, mew=1.3)
        ax.text(xt, i, fmt(s['media']), va='center', fontsize=8, fontweight='bold' if d == yo else 'normal')
    ax.set_yticks(range(len(grupo))); ax.set_yticklabels([f"P{R.fpos[d]} · {SN(d)}" for d in grupo])
    k = grupo.index(yo); ax.get_yticklabels()[k].set_fontweight('bold'); ax.get_yticklabels()[k].set_color(INK)
    ax.invert_yaxis(); ax.set_xlim(x0, xt + .16 * (x1 - x0)); ax.xaxis.set_major_formatter(lapfmt); ax.grid(axis='y', visible=False)
    ax.text(xt, -.8, 'media', fontsize=7.5, color=SEC, va='center')
    ax.set_title(f'Ritmo y regularidad de P{R.fpos[grupo[0]]} a P{R.fpos[grupo[-1]]}')
    save(fig, 'dist')

    # 5 ---- mediana por bloques de 5 minutos
    otros = [d for d in grupo if d != yo]; nb = max(1, int(end // 300))
    xs, ym, yr = [], [], []
    for k in range(nb):
        a, b = k * 300, (k + 1) * 300 if k < nb - 1 else end + 1
        m = [v for t, v, l in me if a < t <= b and l > 1 and v < R.vuelta_tipo + 2.4]
        r = [v for d in otros for t, v, l in R.LOG[d] if a < t <= b and l > 1 and v < R.vuelta_tipo + 2.4]
        xs.append(k * 5 + 2.5); ym.append(np.median(m) if len(m) >= 3 else np.nan); yr.append(np.median(r) if r else np.nan)
    fig, ax = plt.subplots(figsize=(7.3, 2.5))
    ax.plot(xs, yr, '-o', color=GR, lw=1.8, ms=5, mec='white'); ax.plot(xs, ym, '-o', color=AZUL, lw=2.4, ms=6, mec='white')
    ax.text(xs[-1] + .6, ym[-1], SN(yo), fontweight='bold', va='center', fontsize=8); ax.text(xs[-1] + .6, yr[-1], f'otros {len(otros)} del grupo', va='center', fontsize=8)
    ax.set_xlim(0, nb * 5 + 8); ax.set_xticks(range(0, nb * 5 + 1, 5)); ax.yaxis.set_major_formatter(lapfmt)
    ax.set_xlabel('minuto de carrera (bloques de 5 min; el último llega a meta)'); ax.set_title('Mediana de vuelta por bloques de 5 minutos')
    save(fig, 'track')

    # 6 ---- hueco a igualdad de vuelta con los rivales del duelo
    duelos = cfg['duelos'][:2]; nl = len(A)
    fig, axs = plt.subplots(len(duelos), 1, figsize=(7.3, 2.0 * len(duelos)), sharex=True, gridspec_kw={'hspace': .32}, squeeze=False)
    for ax, r in zip(axs[:, 0], duelos):
        x = np.arange(1, nl + 1)
        g = np.array([R.hueco(yo, r, int(l)) if R.comparable(yo, r, int(l)) else np.nan for l in x], dtype=float)
        tr = R.tramos_comparables(yo, r); col = C.get(r, GR)
        hueco0 = 1
        for a, b in tr + [(nl + 1, nl + 1)]:
            if a - hueco0 >= 1 and hueco0 > 1:
                ax.axvspan(hueco0 - .5, a - .5, color=BANDA, zorder=0)
            hueco0 = b + 1
        ax.axhline(0, color=INK, lw=.9)
        ax.fill_between(x, 0, g, where=g > 0, color=AZUL, alpha=.18); ax.fill_between(x, 0, g, where=g < 0, color=col, alpha=.22)
        ax.plot(x, g, '-o', color=INK, lw=1.2, ms=3)
        lo, hi = min(np.nanmin(g), 0), max(np.nanmax(g), 0); span = max(hi - lo, 1.5); ax.set_ylim(lo - .28 * span, hi + .28 * span)
        pts = sorted({tr[0][0]} | {b for a, b in tr} | {a for a, b in tr[1:]})
        ult_ = -99
        for Lk in pts:
            if Lk - ult_ < 5 and Lk != pts[-1]:
                continue
            ult_ = Lk
            v = g[Lk - 1]; ax.text(Lk, v + (.07 if v >= 0 else -.07) * span, coma(v), ha='center', va='bottom' if v >= 0 else 'top', fontsize=8, fontweight='bold')
        ax.set_ylabel('segundos')
        ax.set_title(f'Hueco con {ap(r)} (kart {r}) a igualdad de vuelta · positivo = voy delante', fontsize=9)
    axs[-1, 0].set_xlabel('vuelta oficial'); axs[-1, 0].set_xlim(-1.5, nl + 2)
    save(fig, 'gap')

    # 7 ---- cascada del hueco
    rc = cfg['cascada']; pasos = R.cascada(yo, rc)
    et = cfg.get('cascada_etiquetas') or [p['etiqueta'] for p in pasos]
    vals = np.cumsum([p['valor'] if p['tipo'] == 'd' else 0 for p in pasos]) + pasos[0]['valor']
    lo, hi = min(0, vals.min(), pasos[-1]['valor']), max(0, vals.max(), pasos[0]['valor']); esc = (hi - lo) or 1
    fig, ax = plt.subplots(figsize=(7.3, 3.0)); cur = 0
    for i, p in enumerate(pasos):
        v = p['valor']
        if p['tipo'] == 'abs':
            ax.bar(i, v, width=.56, color=INK); cur = v
            ax.text(i, v + (.03 if v > 0 else -.03) * esc, coma(v, 3 if p.get('oficial') else 1) + ' s', ha='center', va='bottom' if v > 0 else 'top', fontweight='bold', fontsize=8.5)
        else:
            ax.bar(i, v, bottom=cur, width=.56, color=AZUL if v > 0 else RIV[0]); ax.plot([i - 1 + .28, i - .28], [cur, cur], color=SEC, lw=.7)
            ax.text(i, max(cur, cur + v) + .025 * esc if v > 0 else min(cur, cur + v) - .025 * esc, coma(v) + ' s', ha='center', va='bottom' if v > 0 else 'top', fontsize=8.5, fontweight='bold')
            cur += v
        if i < len(pasos) - 1 and pasos[i + 1]['tipo'] == 'abs':
            ax.plot([i + .28, i + 1 - .28], [cur, cur], color=SEC, lw=.7)
    ax.axhline(0, color=INK, lw=.9); ax.set_xticks(range(len(pasos))); ax.set_xticklabels(et, fontsize=7.3, color=INK)
    ax.set_ylim(lo - .2 * esc, hi + .24 * esc); ax.set_ylabel(f'hueco con {ap(rc)} (s) · + delante'); ax.grid(axis='x', visible=False)
    ax.set_title(f"De {coma(pasos[0]['valor'])} s a {coma(pasos[-1]['valor'], 3 if pasos[-1].get('oficial') else 1)} s con {ap(rc)} (P{R.fpos[rc]}): dónde se va cada décima")
    ax.plot([], [], 's', color=AZUL, label='gano tiempo'); ax.plot([], [], 's', color=RIV[0], label='pierdo tiempo')
    ax.legend(loc='upper right' if pasos[-1]['valor'] < pasos[0]['valor'] else 'upper left', fontsize=8, ncol=2)
    save(fig, 'water')

    # 8 ---- último stint
    ult = R.stints(yo)[-1]
    fr = (cfg.get('final_rivales') or riv)[:4]
    nl0, nl = nl, min([nl] + [len(R.T[d]) for d in fr])      # si algún rival acabó con menos vueltas, se compara hasta donde llegan todos
    desde = cfg.get('final_desde') or (ult[0] if ult[1] - ult[0] >= 4 and ult[0] < nl - 2 else max(2, nl - 9))
    xs = list(range(desde, nl + 1)); xg = list(range(max(1, desde - 1), nl + 1))
    fig, (a1, a2) = plt.subplots(2, 1, figsize=(7.3, 4.4), sharex=True, gridspec_kw={'hspace': .28, 'height_ratios': [1, 1.15]})
    allv = []
    for d in fr[:3][::-1] + [yo]:
        pts = [(l, la[d][l]) for l in xs if l in la[d]]; allv += [v for _, v in pts]
        a1.plot([p[0] for p in pts], [p[1] for p in pts], '-o', color=C.get(d, GR), lw=2.4 if d == yo else 1.4, ms=5 if d == yo else 4, mec='white', zorder=5 if d == yo else 3, label=SN(d))
    h, l_ = a1.get_legend_handles_labels(); a1.legend(h[::-1], l_[::-1], loc='upper left', ncol=4, fontsize=8, handlelength=1.6, columnspacing=1.2)
    lo, hi = min(allv), max(allv); a1.set_ylim(lo - .15, hi + .32 * (hi - lo + .3)); a1.yaxis.set_major_formatter(lapfmt); a1.yaxis.set_major_locator(MultipleLocator(paso(hi - lo + .5)))
    a1.set_title(f'Últimas {len(xs)} vueltas: tiempo por vuelta')
    a2.plot([xg[0] - .5, nl + .25], [0, 0], color=AZUL, lw=2.4)
    G = {d: [-(R.T[d][l - 1] - A[l - 1]) if R.comparable(yo, d, l) else np.nan for l in xg] for d in fr}   # solo con las mismas paradas hechas
    lim = max(2.5, max([abs(v) for g in G.values() for v in g if v == v] or [2.5]) * 1.15)
    a2.text(xg[0] - .1, .05 * lim, SN(yo), fontsize=8, fontweight='bold', va='bottom')
    yl, prev = {}, -99
    fin_ = {d: (G[d][-1] if G[d][-1] == G[d][-1] else 0.0) for d in fr}
    for d in sorted(fr, key=lambda d: fin_[d]):
        yl[d] = max(fin_[d], prev + .25 * lim); prev = yl[d]
    for d in fr:
        a2.plot(xg, G[d], '-o', color=C.get(d, GR), lw=1.6, ms=4.5, mec='white')
        of = R.hueco_oficial(yo, d); v = -of if of is not None else fin_[d]
        a2.plot([nl + .05, nl + .5], [fin_[d], yl[d]], color=C.get(d, GR), lw=.8)
        a2.text(nl + .6, yl[d], f"{SN(d)} · " + (f"a {coma(abs(v), 3 if of is not None else 1, False)} s" if v > 0 else f"{coma(abs(v), 3 if of is not None else 1, False)} s detrás"), fontsize=7.6, va='center')
    ancho = len(xg) * .48 + 1.2
    a2.fill_between([xg[0] - .5, nl + ancho], 0, lim, color=BANDA, zorder=0)
    a2.text(nl + ancho - .2, lim * .94, 'delante de mí ▲', ha='right', va='top', fontsize=7.5, color=SEC); a2.text(nl + ancho - .2, -lim * .94, 'detrás de mí ▼', ha='right', va='bottom', fontsize=7.5, color=SEC)
    a2.set_ylim(-lim, lim); a2.set_xlim(xg[0] - .5, nl + ancho); a2.set_xticks(xg); a2.set_ylabel('segundos respecto a mí'); a2.set_xlabel('vuelta oficial')
    a2.set_title('Posición en pista de mis rivales respecto a mí, al paso por meta')
    save(fig, 'final')
    nl = nl0

    # 9 ---- pasos por box
    filas = [d for d in cfg['box'] if len(R.ciclos(d)) >= 1]; CY = {d: R.ciclos(d)[:2] for d in filas}
    lo, hi = min(min(c) for c in CY.values()), max(max(c) for c in CY.values()); xt = hi + .14 * (hi - lo + 1)
    fig, ax = plt.subplots(figsize=(7.3, .9 + .25 * len(filas)))
    for i, d in enumerate(filas):
        col = AZUL if d == yo else GR; c = CY[d]
        ax.plot([min(c), max(c)], [i, i], color=col, lw=2, alpha=.5); ax.scatter(c, [i] * len(c), s=46, color=col, edgecolor='white', linewidth=1, zorder=3)
        ax.text(xt, i, fmt(np.mean(c), 1), va='center', fontsize=8, fontweight='bold' if d == yo else 'normal')
    ax.set_yticks(range(len(filas))); ax.set_yticklabels([f"P{R.fpos[d]} · {SN(d)}" for d in filas])
    k = filas.index(yo); ax.get_yticklabels()[k].set_fontweight('bold'); ax.get_yticklabels()[k].set_color(INK)
    ax.invert_yaxis(); ax.set_xlim(lo - .12 * (hi - lo + 1), xt + .14 * (hi - lo + 1)); ax.xaxis.set_major_locator(MultipleLocator(1))
    ax.xaxis.set_major_formatter(FuncFormatter(lambda v, _: f'{int(v // 60)}:{v % 60:02.0f}')); ax.grid(axis='y', visible=False)
    ax.text(xt, -.8, 'media', fontsize=7.5, color=SEC, va='center')
    ax.set_xlabel('paso completo por box (entrada + parada + salida), en min:s'); ax.set_title('Tiempo de paso completo por box (un punto por parada)')
    save(fig, 'box')

    # 10 ---- crono
    if R.q and yo in R.q['pos']:
        q = R.q; o = q['orden']; k = o.index(yo); qo = [d for d in (cfg.get('crono_filas') or o[max(0, k - 2):k + 3]) if d in q['laps']]
        x0 = min(q['best'][d] for d in qo) - .18; x1 = float(np.percentile([v for d in qo for v in q['laps'][d]], 88)) + .1
        fig, ax = plt.subplots(figsize=(7.3, .9 + .3 * len(qo)))
        for i, d in enumerate(qo):
            b = q['best'][d]; x = [v for v in q['laps'][d] if b + .0005 < v < x1]; col = AZUL if d == yo else GR
            ax.scatter(x, [i] * len(x), s=26, color=col, alpha=.75, edgecolor='white', linewidth=.7, zorder=3)
            ax.scatter([b], [i], s=70, color=col, edgecolor=INK, linewidth=1.4, zorder=4); ax.text(b, i - .33, fmt(b), ha='center', fontsize=7.5, fontweight='bold' if d == yo else 'normal')
        ax.set_yticks(range(len(qo))); ax.set_yticklabels([f"P{q['pos'][d]} · {SN(d)}" for d in qo])
        j = qo.index(yo); ax.get_yticklabels()[j].set_fontweight('bold'); ax.get_yticklabels()[j].set_color(INK)
        ax.set_ylim(len(qo) - .5, -.7); ax.set_xlim(x0, x1); ax.xaxis.set_major_formatter(lapfmt); ax.grid(axis='y', visible=False)
        ax.set_title('Crono: todas las vueltas de cada piloto (aro negro = mejor vuelta)')
        save(fig, 'qual')
