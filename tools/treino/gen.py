# gen.py — gera o dataset de treino do MLP, ESPELHANDO o preprocessamento
# do motor (ocr-comum.js v2.0.1): mini-linhas "H c H" com gap variável
# (inclusive glifos encostados), variantes downscale 2x (AA-mush), fundos
# claros, pesos finos->semibold via Arimo variable. Features idênticas às
# de featuresDoGlifo (16x20 + gh/hband, gy0/hband, gw/gh).
import numpy as np
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

BASE = Path(__file__).parent
FDIR = BASE / 'fonts'

CHARS = (list('0123456789')
         + [chr(x) for x in range(65, 91)]
         + [chr(x) for x in range(97, 123) if chr(x) != 'l']
         + list('.,-/()%&+:'))
GH, GW = 20, 16
NIN = GH * GW + 3

FONTS = []  # (nome, path, peso_variable ou None)
for f in ['Carlito-Regular.ttf', 'Carlito-Bold.ttf', 'DejaVuSans.ttf',
          'DejaVuSans-Bold.ttf', 'DejaVuSansMono.ttf', 'DejaVuSansMono-Bold.ttf',
          'Roboto-Regular.ttf', 'Roboto-Bold.ttf']:
    FONTS.append((f, FDIR / f, None))
for w in (300, 400, 500, 600):
    FONTS.append((f'Arimo{w}', FDIR / 'Arimo.ttf', w))

_font_cache = {}
def get_font(path, peso, size):
    key = (str(path), peso, size)
    f = _font_cache.get(key)
    if f is None:
        f = ImageFont.truetype(str(path), size)
        if peso is not None:
            try: f.set_variation_by_axes([peso])
            except Exception: pass
        _font_cache[key] = f
    return f

# ---------- espelho do motor ----------

def ink_from_gray(gray):
    v = (1.0 - gray - 0.15) / 0.7
    return np.clip(v, 0.0, 1.0)

def banda_da_imagem(ink):
    bink = ink > 0.30
    rows = np.where(bink.any(axis=1))[0]
    if not len(rows): return None
    bandas = []
    ini = rows[0]; prev = rows[0]
    for r in rows[1:]:
        if r - prev <= 2: prev = r
        else:
            bandas.append((ini, prev + 1)); ini = r; prev = r
    bandas.append((ini, prev + 1))
    bandas = [b for b in bandas if 5 <= b[1] - b[0] <= 90]
    return bandas

def zoom_linspace(tight, nh, nw):
    gh, gw = tight.shape
    cy = (np.linspace(0, gh - 1, nh) if nh > 1 else np.zeros(nh))
    cx = (np.linspace(0, gw - 1, nw) if nw > 1 else np.zeros(nw))
    y0 = np.clip(np.floor(cy).astype(int), 0, gh - 1)
    y1 = np.minimum(y0 + 1, gh - 1)
    fy = cy - y0
    x0 = np.clip(np.floor(cx).astype(int), 0, gw - 1)
    x1 = np.minimum(x0 + 1, gw - 1)
    fx = cx - x0
    A = tight[y0][:, x0]; B = tight[y0][:, x1]
    C = tight[y1][:, x0]; D = tight[y1][:, x1]
    out = (A * (1 - fy)[:, None] * (1 - fx)[None, :]
           + B * (1 - fy)[:, None] * fx[None, :]
           + C * fy[:, None] * (1 - fx)[None, :]
           + D * fy[:, None] * fx[None, :])
    return np.clip(out, 0, 1)

def features(ink, y0, hband, x0, x1):
    sub = ink[y0:y0 + hband, x0:x1]
    ys, xs = np.where(sub > 0.08)
    if not len(ys): return None
    gy0, gy1 = ys.min(), ys.max() + 1
    gx0, gx1 = xs.min(), xs.max() + 1
    gh, gw = gy1 - gy0, gx1 - gx0
    if gh < 2 or gw < 1: return None
    tight = ink[y0 + gy0:y0 + gy1, x0 + gx0:x0 + gx1]
    f = min((GW - 2) / gw, (GH - 2) / gh, 1.0)
    nh = max(1, int(round(gh * f)))
    nw = max(1, int(round(gw * f)))
    z = zoom_linspace(tight, nh, nw)
    ft = np.zeros((GH, GW), dtype=np.float64)
    oy = (GH - nh) >> 1; ox = (GW - nw) >> 1
    ft[oy:oy + nh, ox:ox + nw] = z
    m = np.array([gh / hband, gy0 / hband, gw / max(gh, 1)])
    return np.concatenate([ft.ravel(), m])

# ---------- render da mini-linha ----------

def render_miniline(font, size, c, gap_extra, bg_gray, do2x, filtro):
    esc = 2 if do2x else 1
    f = get_font(font[1], font[2], size * esc)
    adv = {ch: f.getlength(ch) for ch in 'H' + c}
    m = 8 * esc
    xh1 = m
    xc = xh1 + adv['H'] - gap_extra * esc
    xh2 = xc + adv[c] - gap_extra * esc
    W = int(xh2 + adv['H'] + m)
    asc, desc = f.getmetrics()
    H = asc + desc + 2 * (2 * esc)
    ty = 2 * esc
    img = Image.new('L', (max(W, 10), H), int(round(bg_gray * 255)))
    d = ImageDraw.Draw(img)
    d.text((int(round(xh1)), ty), 'H', font=f, fill=0)
    d.text((int(round(xc)), ty), c, font=f, fill=0)
    d.text((int(round(xh2)), ty), 'H', font=f, fill=0)
    if do2x:
        img = img.resize((img.width // 2, img.height // 2), filtro)
    gray = np.asarray(img, dtype=np.float64) / 255.0
    return gray, int(round(xc / esc)), int(round(xh2 / esc))

def extrai_da_miniline(gray, xc, xfim_c):
    ink = ink_from_gray(gray)
    bandas = banda_da_imagem(ink)
    if not bandas: return None
    h, w = ink.shape
    y0, y1 = bandas[0]  # mini-linha = 1 banda
    hband = y1 - y0
    # runs crus: colink >= 1 no limiar 0.50
    colink = (ink[y0:y1] > 0.50).sum(axis=0)
    runs = []
    ini = -1
    for x in range(w):
        if colink[x] >= 1 and ini < 0: ini = x
        elif colink[x] < 1 and ini >= 0: runs.append((ini, x)); ini = -1
    if ini >= 0: runs.append((ini, w))
    # run que cobre o centro do glifo c
    alvo = None
    for r in runs:
        if r[0] <= (xc + xfim_c) // 2 < r[1]:
            alvo = r; break
    if alvo is None: return None
    larg = alvo[1] - alvo[0]
    adv_c = max(xfim_c - xc, 1)
    # janela-fragmento (haste de h/m/n partida) ou fundida demais: pular
    if larg < 0.45 * adv_c or larg > adv_c + max(4, 0.35 * adv_c):
        return None
    return features(ink, y0, hband, alvo[0], alvo[1])

# ---------- augment em nível de grid ----------

GAUSS = None
def _gauss():
    global GAUSS
    if GAUSS is None:
        r, sig = 2, 0.5
        k = np.exp(-0.5 * (np.arange(-r, r + 1) / sig) ** 2)
        GAUSS = k / k.sum()
    return GAUSS

def blur_grid(g):
    from scipy.ndimage import gaussian_filter
    return gaussian_filter(g, sigma=0.5, mode='reflect')

def augment_grid(ft, rng):
    g = ft[:GH * GW].reshape(GH, GW).copy()
    modo = rng.integers(0, 4)
    if modo == 0:
        g = blur_grid(g)
    elif modo == 1:
        g = np.clip(g + rng.normal(0, 0.06, g.shape), 0, 1)
    elif modo == 2:
        dy = rng.uniform(-0.8, 0.8); dx = rng.uniform(-0.8, 0.8)
        from scipy.ndimage import shift as ndshift
        g = ndshift(g, (dy, dx), order=1, mode='reflect')
    else:
        g = blur_grid(np.clip(g + rng.normal(0, 0.04, g.shape), 0, 1))
    out = ft.copy()
    out[:GH * GW] = np.clip(g, 0, 1).ravel()
    return out

# ---------- main ----------

if __name__ == '__main__':
    rng = np.random.default_rng(42)
    sizes = list(range(11, 27))
    gaps = [0.0, -0.5, -1.0, 1.0]
    bgs = [1.0, 0.95, 0.92]
    filtros = [Image.LANCZOS, Image.BOX, Image.BILINEAR]

    Xs, ys = [], []
    n_skip = 0; n = 0
    for font in FONTS:
        for size in sizes:
            for ci, c in enumerate(CHARS):
                for gap in gaps:
                    do2x = rng.random() < 0.40
                    bg = bgs[rng.integers(0, len(bgs))]
                    filt = filtros[rng.integers(0, len(filtros))] if do2x else None
                    try:
                        gray, xc, xfim = render_miniline(font, size, c, gap, bg, do2x, filt)
                        ft = extrai_da_miniline(gray, xc, xfim)
                    except Exception:
                        n_skip += 1; continue
                    if ft is None:
                        n_skip += 1; continue
                    Xs.append(ft.astype(np.float16)); ys.append(ci); n += 1
                    for _ in range(3):
                        Xs.append(augment_grid(ft, rng).astype(np.float16)); ys.append(ci); n += 1
        print(f'{font[0]}: {n} amostras (skip {n_skip})', flush=True)
    X = np.stack(Xs); y = np.array(ys, dtype=np.int16)
    np.savez_compressed(BASE / 'dataset.npz', X=X, y=y)
    print('TOTAL', X.shape, y.shape, 'chars', len(CHARS))