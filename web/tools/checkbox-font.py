# Makes the tiny font that draws a note's checklist boxes (227): "☐" as a rounded outline square and
# "☑" as a filled one with the tick cut out, in place of the system's text glyphs. Only these two
# characters are in it (the editor's font list puts it first; every other character falls through to
# the note's own font). The output (base64) goes into the @font-face at the top of src/ui/phone/phone.css.
# Needs fontTools:  python -m pip install --target <dir> fonttools  then  PYTHONPATH=<dir> python tools/checkbox-font.py
import base64, io, math
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

UPM = 1000
ADV = 1000            # one em wide; the no-break space after the box gives the gap to the text
X0, X1 = 110, 890     # the square: 0.78 em, like Material's 18 of 24
Y0, Y1 = -60, 720     # sitting on the text's middle
R = 120               # corner radius
STROKE = 100          # outline weight (1.6 px at 16 px)

def rounded(pen, x0, y0, x1, y1, r, clockwise):
    # TrueType fills by winding: outer contours clockwise, holes the other way.
    pts = [
        ((x0 + r, y0), (x0, y0), (x0, y0 + r)),
        ((x0, y1 - r), (x0, y1), (x0 + r, y1)),
        ((x1 - r, y1), (x1, y1), (x1, y1 - r)),
        ((x1, y0 + r), (x1, y0), (x1 - r, y0)),
    ]
    if not clockwise:
        pts = [(c, b, a) for (a, b, c) in reversed(pts)]
    pen.moveTo(pts[0][0])
    for i, (a, b, c) in enumerate(pts):
        if i: pen.lineTo(a)
        pen.qCurveTo(b, c)
    pen.closePath()

def box():
    pen = TTGlyphPen(None)
    rounded(pen, X0, Y0, X1, Y1, R, True)
    s = STROKE
    rounded(pen, X0 + s, Y0 + s, X1 - s, Y1 - s, max(10, R - s), False)
    return pen.glyph()

def ticked():
    pen = TTGlyphPen(None)
    rounded(pen, X0, Y0, X1, Y1, R, True)
    # The tick, a hole: a polyline 95 units thick from the left arm down to the point and up to the right.
    cx, cy = (X0 + X1) / 2, (Y0 + Y1) / 2
    w = 95
    a = (cx - 245, cy + 10); b = (cx - 75, cy - 160); c = (cx + 250, cy + 175)
    def off(p, q, d):
        dx, dy = q[0] - p[0], q[1] - p[1]; l = math.hypot(dx, dy)
        return (-dy / l * d, dx / l * d)
    o1 = off(a, b, w / 2); o2 = off(b, c, w / 2)
    # Inner corner at b (on the upper side) where the two edges meet.
    def inter(p1, d1, p2, d2):
        den = d1[0] * d2[1] - d1[1] * d2[0]
        t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den
        return (p1[0] + d1[0] * t, p1[1] + d1[1] * t)
    d1 = (b[0] - a[0], b[1] - a[1]); d2 = (c[0] - b[0], c[1] - b[1])
    upper = inter((a[0] + o1[0], a[1] + o1[1]), d1, (b[0] + o2[0], b[1] + o2[1]), d2)
    lower = inter((a[0] - o1[0], a[1] - o1[1]), d1, (b[0] - o2[0], b[1] - o2[1]), d2)
    poly = [
        (a[0] + o1[0], a[1] + o1[1]), upper, (c[0] + o2[0], c[1] + o2[1]),
        (c[0] - o2[0], c[1] - o2[1]), lower, (a[0] - o1[0], a[1] - o1[1]),
    ]
    # Make it counter-clockwise (a hole).
    area = sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))
    if area < 0: poly.reverse()
    pen.moveTo(tuple(round(v) for v in poly[0]))
    for q in poly[1:]: pen.lineTo(tuple(round(v) for v in q))
    pen.closePath()
    return pen.glyph()

def empty():
    return TTGlyphPen(None).glyph()

fb = FontBuilder(UPM, isTTF=True)
order = [".notdef", "box", "ticked"]
fb.setupGlyphOrder(order)
fb.setupCharacterMap({0x2610: "box", 0x2611: "ticked"})
fb.setupGlyf({".notdef": empty(), "box": box(), "ticked": ticked()})
fb.setupHorizontalMetrics({".notdef": (500, 0), "box": (ADV, X0), "ticked": (ADV, X0)})
fb.setupHorizontalHeader(ascent=930, descent=-270)
fb.setupNameTable({"familyName": "Planner Boxes", "styleName": "Regular"})
fb.setupOS2(sTypoAscender=930, sTypoDescender=-270, usWinAscent=930, usWinDescent=270)
fb.setupPost()
buf = io.BytesIO()
fb.save(buf)
print(base64.b64encode(buf.getvalue()).decode())
