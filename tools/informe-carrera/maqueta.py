"""Maquetación del PDF. La estructura de páginas es fija; el texto entra por informe.json."""
import os, datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER
from reportlab.platypus import BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Image, Table, TableStyle, PageBreak, NextPageTemplate
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from PIL import Image as PI
from nucleo import fmt, coma

F = '/System/Library/Fonts/Supplemental/'
if os.path.exists(F + 'Arial.ttf'):
    for n, f in (('A', 'Arial.ttf'), ('AB', 'Arial Bold.ttf'), ('AI', 'Arial Italic.ttf')):
        pdfmetrics.registerFont(TTFont(n, F + f))
    pdfmetrics.registerFontFamily('A', normal='A', bold='AB', italic='AI', boldItalic='AB')
    FN, FB = 'A', 'AB'
else:
    FN, FB = 'Helvetica', 'Helvetica-Bold'
INK, SEC, ORG = colors.HexColor('#0b0b0b'), colors.HexColor('#52514e'), colors.HexColor('#eb6834')
DARK, SOFT, LINE, HL, BLUE = colors.HexColor('#14181f'), colors.HexColor('#f4f3ef'), colors.HexColor('#dddcd6'), colors.HexColor('#e6f0fb'), colors.HexColor('#2a78d6')
W, H = A4; M = 16 * mm; CW = W - 2 * M
st = lambda n, **k: ParagraphStyle(n, fontName=FN, fontSize=9.3, leading=13.2, textColor=INK, **k)
body, bul = st('b', spaceAfter=5), st('bu', leftIndent=11, bulletIndent=1, spaceAfter=3.5)
h1 = ParagraphStyle('h1', fontName=FB, fontSize=15, leading=18, textColor=INK, spaceBefore=2, spaceAfter=6)
h2 = ParagraphStyle('h2', fontName=FB, fontSize=11, leading=14, textColor=INK, spaceBefore=8, spaceAfter=4)
cap = ParagraphStyle('cap', fontName=FN, fontSize=7.8, leading=10.4, textColor=SEC, spaceAfter=7)
key = ParagraphStyle('k', fontName=FN, fontSize=9.6, leading=13.6, textColor=INK, backColor=SOFT, borderPadding=(7, 8, 7, 8), spaceBefore=6, spaceAfter=12, leftIndent=8, rightIndent=8)
MESES = 'enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre'.split()
DIAS = 'lunes martes miércoles jueves viernes sábado domingo'.split()
PEND = 'PENDIENTE'


def P(t, s=body): return Paragraph(t, s)
def B(items): return [Paragraph(t, bul, bulletText='•') for t in items or []]


def tbl(data, cw, hl=None, fs=8, der=1, pad=3):
    t = Table(data, colWidths=cw, repeatRows=1)
    s = [('FONT', (0, 0), (-1, -1), FN, fs), ('FONT', (0, 0), (-1, 0), FB, fs), ('TEXTCOLOR', (0, 0), (-1, 0), SEC), ('LINEBELOW', (0, 0), (-1, 0), .8, INK),
         ('LINEBELOW', (0, 1), (-1, -1), .3, LINE), ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('TOPPADDING', (0, 0), (-1, -1), pad), ('BOTTOMPADDING', (0, 0), (-1, -1), pad),
         ('ALIGN', (der, 0), (-1, -1), 'RIGHT'), ('LEFTPADDING', (0, 0), (-1, -1), 4), ('RIGHTPADDING', (0, 0), (-1, -1), 4)]
    for r in hl or []:
        s += [('BACKGROUND', (0, r), (-1, r), HL), ('FONT', (0, r), (-1, r), FB, fs)]
    t.setStyle(TableStyle(s)); return t


def fecha_larga(ms):
    d = datetime.datetime.fromtimestamp(ms / 1000)
    return f"{DIAS[d.weekday()]} {d.day} de {MESES[d.month - 1]} de {d.year}", d


def construir(R, cfg, graf, salida):
    yo, tx = cfg['dorsal'], cfg['textos']
    piloto, cat, circ = cfg['piloto'], cfg['categoria'], cfg['circuito']
    fl, d0 = fecha_larga(R.sesion.get('started_at') or R.t0)
    hora = d0.strftime('%H:%M')
    if R.relanzada:
        hora += ', relanzada a las ' + datetime.datetime.fromtimestamp(R.t0 / 1000).strftime('%H:%M')
    nl, n = len(R.T[yo]), len(R.T)
    dur = f"{int(R.fin // 60)} min {int(R.fin % 60)} s" + (' desde el relanzamiento' if R.relanzada else '')
    npar = len(R.paradas_vuelta(yo)); mand = R.snap.get('mandatoryPitSec')
    linea3 = f"{n} karts · {R.tours[R.orden[0]]} vueltas · {dur} · {npar} parada{'s' if npar != 1 else ''}" + (f" obligatoria{'s' if npar != 1 else ''} de {mand} s" if mand else '') + ' · datos: StintPro Logger'
    pie = f"Informe de carrera · {cat} {circ} · {d0.strftime('%d-%m-%Y')} · Kart {yo} {piloto}"

    def page(c, doc):
        c.saveState()
        if doc.page == 1:
            c.setFillColor(DARK); c.rect(0, H - 44 * mm, W, 44 * mm, stroke=0, fill=1)
            c.setFillColor(BLUE); c.rect(0, H - 44 * mm, W, 1.6 * mm, stroke=0, fill=1)
            c.setFillColor(colors.white); c.setFont(FB, 22); c.drawString(M, H - 19 * mm, f'Informe de carrera · Kart {yo} · {piloto}')
            c.setFont(FN, 11.5); c.setFillColor(colors.HexColor('#c9d2de')); c.drawString(M, H - 27 * mm, f'{cat} · {circ} · {fl} · salida {hora}')
            c.setFont(FN, 9); c.drawString(M, H - 34 * mm, linea3)
        else:
            c.setFont(FN, 7.5); c.setFillColor(SEC); c.drawString(M, H - 10 * mm, pie)
            c.setStrokeColor(LINE); c.setLineWidth(.5); c.line(M, H - 11.5 * mm, W - M, H - 11.5 * mm)
        c.setFont(FN, 7.5); c.setFillColor(SEC); c.drawRightString(W - M, 9 * mm, f'{doc.page}')
        c.restoreState()

    def img(name, w=CW):
        p = os.path.join(graf, f'{name}.png'); iw, ih = PI.open(p).size
        return Image(p, width=w, height=w * ih / iw)

    os.makedirs(os.path.dirname(salida), exist_ok=True)
    doc = BaseDocTemplate(salida, pagesize=A4, title=f'Informe de carrera · Kart {yo} · {cat} {circ} {d0.strftime("%d-%m-%Y")}', author='StintPro · ingeniería de pista')
    doc.addPageTemplates([PageTemplate('first', [Frame(M, 14 * mm, CW, H - 44 * mm - 18 * mm, 0, 0, 0, 0)], onPage=page),
                          PageTemplate('rest', [Frame(M, 14 * mm, CW, H - 29 * mm, 0, 0, 0, 0)], onPage=page)])
    s = [NextPageTemplate('rest')]
    me, la = R.LOG[yo], R.la[yo]
    q = R.q
    qtxt = lambda d: f"P{q['pos'][d]} · {fmt(q['best'][d])}" if q and d in q['pos'] else '—'
    paradas = lambda d: ' y '.join(f"{a / 60:.0f}" for a, b, _ in R.stops[d]) or '—'

    # ---------- página 1: resumen ----------
    tiles = tx['tiles']
    cel = lambda v, l, hl=False: [Paragraph(f'<font name="{FB}" size="14.5" color="{"#2a78d6" if hl else "#0b0b0b"}">{v}</font>', ParagraphStyle('t', alignment=TA_CENTER, leading=20)),
                                  Paragraph(f'<font size="7.5" color="#52514e">{l}</font>', ParagraphStyle('t2', fontName=FN, alignment=TA_CENTER, leading=9.5))]
    cs = [cel(*t) for t in tiles]
    tt = Table([[c[0] for c in cs], [c[1] for c in cs]], colWidths=[CW / len(cs)] * len(cs))
    tt.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), SOFT), ('LINEAFTER', (0, 0), (-2, -1), .6, colors.white), ('TOPPADDING', (0, 0), (-1, 0), 8), ('BOTTOMPADDING', (0, 1), (-1, 1), 8), ('VALIGN', (0, 0), (-1, -1), 'MIDDLE')]))
    s += [tt, Spacer(1, 8), P('<b>Veredicto.</b> ' + tx['veredicto'], key)]
    filas = cfg['tabla']
    top = [['Pos', 'Kart · piloto', 'Crono', 'Vueltas', 'Diferencia', 'Mejor vuelta', 'Ritmo medio*', 'Paradas (min)']]
    for d in filas:
        e = R.eq[d]
        top.append([f"P{e['pos']}", f"{d} · {R.nombre(d)}", qtxt(d), e['tours'], e['gap'].replace('.', ',').replace('v', ' v') or 'ganador', fmt(e['bestLap']), fmt(R.stats(d)['media']), paradas(d)])
    s += [tbl(top, [10 * mm, 42 * mm, 26 * mm, 13 * mm, 19 * mm, 21 * mm, 22 * mm, CW - 153 * mm], hl=[filas.index(yo) + 1], der=2),
          P('* Ritmo medio sin la vuelta de salida ni la primera vuelta cronometrada tras cada parada. Diferencia tal como la publica el cronometraje. ' + tx.get('tabla_nota', ''), cap)]
    s += [P('Evolución de la posición', h2), img('pos'), P(tx['pos_caption'], cap)]

    # ---------- página 2: lectura y vueltas ----------
    s += [PageBreak(), P('Lectura de la carrera', h1)] + B(tx['lectura'])
    ocultas = ' y '.join(f'{a}-{b}' for a, b in R.paradas_vuelta(yo))
    s += [Spacer(1, 4), P('Todas las vueltas', h1), img('laps'),
          P(f"Las {len(me)} vueltas cronometradas del kart {yo} (tabla completa al final). Numeración oficial de carrera{' desde el relanzamiento' if R.relanzada else ''}: las vueltas {ocultas} son las de entrada y salida de box, sin tiempo publicado. Línea discontinua: media del stint sin su primera vuelta.", cap)]
    rows = [['Stint', 'Vueltas', 'Nº', 'Media', 'Mediana', 'Mejor', 'Dispersión (σ)', 'Contexto']]
    for i, ss in enumerate(R.stint_stats(yo)):
        ctx = (tx.get('stint_contexto') or [])[i] if i < len(tx.get('stint_contexto') or []) else ''
        rows.append([f'{i + 1}', f"{ss['ini']}-{ss['fin']}", ss['n'], fmt(ss['media']), fmt(ss['mediana']), fmt(ss['mejor']), coma(ss['sd'], 3, False) + ' s', ctx])
    t = tbl(rows, [11 * mm, 16 * mm, 9 * mm, 19 * mm, 19 * mm, 19 * mm, 24 * mm, CW - 117 * mm]); t.setStyle(TableStyle([('ALIGN', (-1, 0), (-1, -1), 'LEFT')]))
    s += [t, Spacer(1, 7)] + B(tx['vueltas'])

    # ---------- página 3: ritmo ----------
    rc = tx['ritmo']
    s += [PageBreak(), P('Ritmo', h1), img('pace', CW * .9), P(rc[0], cap), img('dist', CW * .9), P(rc[1], cap), img('track', CW * .9), P(rc[2], cap)]

    # ---------- página 4: último stint ----------
    f = tx['final']
    s += [PageBreak(), P(f['titulo'], h1)] + ([P(f['intro'])] if f.get('intro') else []) + [img('final'),
          P(f.get('caption') or 'Arriba: tiempo de cada vuelta. Abajo: dónde está cada rival respecto a mí al paso por meta (por encima de la línea azul, delante). Etiquetas de la derecha: diferencia en meta.', cap)] + B(f['bullets'])

    # ---------- página 5: duelo ----------
    du = tx['duelo']
    s += [PageBreak(), P(du['titulo'], h1)] + ([P(du['intro'])] if du.get('intro') else []) + [img('gap', CW * .92),
          P(du.get('caption_gap') or 'Hueco a igualdad de vuelta oficial. En las zonas grises uno de los dos lleva una parada más y el hueco no es comparable. Resolución de ±0,2 s.', cap),
          img('water', CW * .88),
          P(du.get('caption_cascada') or 'Descomposición del hueco por tramos, con las marcas de paso por meta (±0,2 s) y anclada a la diferencia oficial en meta.', cap)] + B(du['bullets'])

    # ---------- página 6: paradas y crono ----------
    bx = tx['box']
    s += [PageBreak(), P('Paradas', h1), img('box', CW * .92), P(bx['caption'], cap)] + B(bx['bullets'])
    if q and yo in q['pos']:
        s += [P('Crono', h1), img('qual', CW * .92), P(tx['crono']['caption'], cap)]

    # ---------- página 7: valoración ----------
    s += [PageBreak(), P('Valoración del ingeniero', h1)] + B(tx['valoracion']) + [P('Plan para la próxima carrera', h2)] + B(tx['plan'])
    lim = []
    if R.relanzada:
        ps = R.relanzada['paron_s']
        lim.append(f"La carrera se detuvo {R.relanzada['tras_s']:.0f} s después de la primera salida y se relanzó {int(ps // 60)} min {int(ps % 60)} s más tarde. Todo el informe cuenta desde el relanzamiento; la vuelta de la salida anulada no se incluye.")
    lim.append('Las vueltas de entrada y salida de box no tienen tiempo publicado: se analiza el paso completo (3 vueltas oficiales) con las marcas de recepción del paso por meta, con resolución de unos 0,2 s.')
    lim.append('No hay sectores ni mensajes de dirección de carrera: los adelantamientos y las causas de las vueltas lentas se deducen del orden de paso por meta, no de lo que pasó en cada curva.')
    dup = sorted({d for k, d, _ in R.reparaciones if k == 'duplicado'}, key=int); nor = sorted({d for k, d, _ in R.reparaciones if k == 'no registrado'}, key=int)
    if dup or nor:
        lim.append('Se han corregido anomalías del registro para reconstruir las posiciones: ' + ' y '.join(x for x in ((f"pasos por meta duplicados (karts {', '.join(dup)})" if dup else ''), (f"no registrados (karts {', '.join(nor)})" if nor else '')) if x) + '.')
    lim += [a[0].upper() + a[1:] + '.' for a in R.avisos] + (tx.get('limites') or [])
    s += [P('Límites de los datos', h2)] + B(lim)

    # ---------- tabla de vueltas ----------
    s += [PageBreak(), P(f'Tabla de vueltas · kart {yo}', h1)]
    best = min(la.values()); umbral = cfg.get('umbral_lenta') or round(R.stats(yo)['mediana'] + .4, 1)
    notas = {int(k): v for k, v in (cfg.get('notas_vuelta') or {}).items()}
    pos = {l: R.pos_en(t)[yo] for t, v, l in me}
    pv = R.paradas_vuelta(yo); ent = {a: i + 1 for i, (a, b) in enumerate(pv)}; sal = {b for a, b in pv}
    rows = []
    for l in range(1, nl + 1):
        if l in la:
            (d, g), _ = R.vecinos(yo, R.T[yo][l - 1]); v = la[l]
            nota = notas.get(l) or ('MEJOR VUELTA' if v == best else '1ª tras box' if (l - 1) in sal else '')
            rows.append([l, fmt(v), '—' if l == 1 else '+' + coma(v - best, 3, False), f'P{pos[l]}', f"{d} a {coma(g, 1, False)}" if g is not None and g < 10 else '—', nota])
        else:
            rows.append([l, 'box', '', '', '', f'entrada a box {ent[l]}' if l in ent else 'parada + salida'])
    hdr = ['V', 'Tiempo', 'Δ mejor', 'Pos', 'Delante', 'Nota']; mitad = (len(rows) + 1) // 2; cws = [7 * mm, 14 * mm, 13 * mm, 9 * mm, 15 * mm, 28 * mm]

    def lt(rs):
        t = Table([hdr] + rs, colWidths=cws)
        stl = [('FONT', (0, 0), (-1, -1), FN, 7.2), ('FONT', (0, 0), (-1, 0), FB, 7.2), ('TEXTCOLOR', (0, 0), (-1, 0), SEC), ('LINEBELOW', (0, 0), (-1, 0), .8, INK), ('LINEBELOW', (0, 1), (-1, -1), .25, LINE),
               ('TOPPADDING', (0, 0), (-1, -1), 1.8), ('BOTTOMPADDING', (0, 0), (-1, -1), 1.8), ('LEFTPADDING', (0, 0), (-1, -1), 2.5), ('RIGHTPADDING', (0, 0), (-1, -1), 2.5),
               ('ALIGN', (0, 0), (2, -1), 'RIGHT'), ('ALIGN', (3, 0), (3, -1), 'CENTER'), ('TEXTCOLOR', (5, 1), (5, -1), SEC)]
        for i, r in enumerate(rs, 1):
            if r[1] == 'box': stl.append(('BACKGROUND', (0, i), (-1, i), SOFT))
            elif la[r[0]] == best: stl += [('BACKGROUND', (0, i), (-1, i), HL), ('FONT', (0, i), (-1, i), FB, 7.2)]
            elif la[r[0]] > umbral and r[0] > 1: stl.append(('TEXTCOLOR', (1, i), (2, i), ORG))
        t.setStyle(TableStyle(stl)); return t
    two = Table([[lt(rows[:mitad]), lt(rows[mitad:])]], colWidths=[CW / 2, CW / 2]); two.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 4)]))
    s += [two, Spacer(1, 5), P(f"V: vuelta oficial. Δ mejor: diferencia con mi mejor vuelta ({fmt(best)}). Pos: posición en la clasificación al pasar por meta (incluye karts con paradas pendientes). Delante: kart que cruza la meta justo antes y a cuántos segundos (puede ser un doblado, un líder o un kart con distinta parada). En naranja, vueltas por encima de {fmt(umbral)}.", cap)]

    # ---------- clasificación ----------
    s += [PageBreak(), P('Clasificación final y paradas', h1)]
    rows = [['Pos', 'Kart', 'Piloto', 'Vueltas', 'Diferencia', 'Intervalo', 'Mejor vuelta', 'Crono', 'Parada 1', 'Parada 2']]
    for e in R.snap['equipos']:
        d = e['dorsal']
        ps = [f"min {coma(a / 60, 1, False)}" + (f" · {du_ // 1000} s" if du_ else '') for a, b, du_ in R.stops[d][:2]] + ['—'] * (2 - len(R.stops[d][:2]))
        rows.append([f"P{e['pos']}", d, R.nombre(d), e['tours'], e['gap'].replace('.', ',').replace('v', ' v') or '—', e['interval'].replace('.', ',').replace('v', ' v') or '—', fmt(e['bestLap']),
                     f"P{q['pos'][d]}" if q and d in q['pos'] else '—', ps[0], ps[1]])
    t = tbl(rows, [10 * mm, 10 * mm, 34 * mm, 13 * mm, 18 * mm, 16 * mm, 20 * mm, 11 * mm, (CW - 132 * mm) / 2, (CW - 132 * mm) / 2], hl=[R.orden.index(yo) + 1], fs=7.6 if n > 24 else 7.8, der=3, pad=2.2 if n > 24 else 2.6)
    s += [t, Spacer(1, 5), P(f"Diferencia e intervalo tal como los publica el cronometraje (v = vueltas). Paradas: minuto de carrera de la entrada{' (desde el relanzamiento)' if R.relanzada else ''} y duración según el cronómetro de parada del circuito (resolución de 1 s). Fuente: StintPro Logger, sesión {R.id}.", cap)]
    doc.build(s)
    return salida
