# gera-grade.py — gera a GRADE CANONICA de prints sinteticos de regressao (140 bins).
# Todos os cenarios renderizam o mesmo print de 3 produtos (caso real do Joao,
# 09/11/2026: Tirol / Petit Suisse) em fontes/escala/gap/peso/contraste diferentes.
# Deterministico: mesma maquina + mesmas fontes => bins identicos.
# Saida: grade/gray_*.bin (header w,h uint32 LE + pixels float32 LE 0..1)
#        + esperado.json (tag -> 3 linhas corretas, o gabarito da suíte).
#
# Cenarios (espelham as varreduras que validaram a v2.1.0):
#   bins (30):          Arimo natural, tamanhos 12-28, fundo azul/branco
#   sweep2 (25):        Arimo, 13-17px, gap 0-2 entre glifos, azul
#   sweep3 (24):        Arimo variable, 15-17px, gap 0-0.75, peso 400/500
#   sweep4 (54):        Carlito (alvo real do ERP), 14-24px, gap 0-1, cinza 30/80/130
#   carlito_nat (7):    Carlito natural, 13-25px, azul
import struct, json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

BASE = Path(__file__).parent
RAIZ = BASE.parent.parent
FONTS = BASE / 'fonts'
OUT = BASE / 'grade'
LINHAS = [
    ('101357', 'PETIT SUISSE BATATAVINHO SHREK 320G MORANGO'),
    ('103864', 'IOGURTE TIROL PESSEGO COM PEDACOS 400G'),
    ('103865', 'IOGURTE TIROL MORANGO COM PEDACOS 400G'),
]
ESPERADO = [f'{c} {d}' for c, d in LINHAS]


def gray_bin(img, path):
    arr = np.asarray(img.convert('L'), dtype=np.float64) / 255.0
    h, w = arr.shape
    with open(path, 'wb') as fh:
        fh.write(struct.pack('<II', w, h))
        fh.write(arr.astype('<f4').tobytes())


# ---------- render natural (string inteira, d.text) ----------
# replica render.py v2.1.0

def render_natural(font_path, size, blue_bg, gray=30, col2=110, W=660):
    font = ImageFont.truetype(str(font_path), size)
    asc, desc_f = font.getmetrics()
    pad_v = max(3, size // 2)
    row_h = (asc + desc_f) + 2 * max(3, size // 3)
    H = pad_v * 2 + row_h * 3
    img = Image.new('RGB', (W, H), (255, 255, 255))
    d = ImageDraw.Draw(img)
    for i, (cod, desc) in enumerate(LINHAS):
        y0 = pad_v + i * row_h
        if blue_bg and i % 2 == 1:
            d.rectangle([0, y0, W - 1, y0 + row_h - 1], fill=(232, 240, 251))
        ty = y0 + (row_h - asc - desc_f) // 2
        d.text((20, ty), cod, font=font, fill=(gray,) * 3)
        d.text((col2, ty), desc, font=font, fill=(gray,) * 3)
    return img


# ---------- render glifo a glifo com gap (replica sweep2/sweep4 v2.1.0) ----------

def draw_text(d, xy, text, font, gap, fill):
    x, y = xy
    for ch in text:
        if ch == ' ':
            x += max(3, font.size // 2)
            continue
        d.text((x, y), ch, font=font, fill=fill)
        x += font.getlength(ch) - gap
    return x


def render_gap(font_path, size, gap, gray, peso=None, azul=True, W=700):
    font = ImageFont.truetype(str(font_path), size)
    if peso is not None and peso != 400:
        try: font.set_variation_by_axes([peso])
        except Exception: pass
    asc, desc_f = font.getmetrics()
    pad_v = max(3, size // 2)
    row_h = (asc + desc_f) + 2 * max(3, size // 3)
    H = pad_v * 2 + row_h * 3
    img = Image.new('RGB', (W, H), (255, 255, 255))
    d = ImageDraw.Draw(img)
    for i, (cod, desc) in enumerate(LINHAS):
        y0 = pad_v + i * row_h
        if azul and i % 2 == 1:
            d.rectangle([0, y0, W - 1, y0 + row_h - 1], fill=(232, 240, 251))
        ty = y0 + (row_h - asc - desc_f) // 2
        draw_text(d, (20, ty), cod, font, gap, (gray,) * 3)
        draw_text(d, (110, ty), desc, font, gap, (gray,) * 3)
    return img


def main():
    OUT.mkdir(exist_ok=True)
    esperado = {}
    arimo = FONTS / 'Arimo.ttf'
    carlito = FONTS / 'Carlito-Regular.ttf'
    fonte_atual = None

    def exporta(tag, img):
        gray_bin(img, OUT / f'gray_{tag}.bin')
        esperado[tag] = ESPERADO

    # 1) bins: Arimo natural 12-28 (pares), azul/branco
    for size in [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 26, 28]:
        for bg in (True, False):
            exporta(f'{size}{"az" if bg else "br"}', render_natural(arimo, size, bg))

    # 2) sweep2: Arimo 13-17, gap 0-2, azul
    for size in (13, 14, 15, 16, 17):
        for gap in (0.0, 0.5, 1.0, 1.5, 2.0):
            exporta(f's{size}_g{gap}', render_gap(arimo, size, gap, 30))

    # 3) sweep3: Arimo variable 15-17, gap 0-0.75, peso 400/500
    for size in (15, 16, 17):
        for gap in (0.0, 0.25, 0.5, 0.75):
            for peso in (400, 500):
                exporta(f's{size}_g{gap}_w{peso}', render_gap(arimo, size, gap, 30, peso=peso))

    # 4) sweep4: Carlito 14-24, gap 0-1, cinza 30/80/130
    for size in (14, 16, 18, 20, 22, 24):
        for gap in (0.0, 0.5, 1.0):
            for gray in (30, 80, 130):
                exporta(f'ca{size}_g{gap}_c{gray}', render_gap(carlito, size, gap, gray))

    # 5) carlito_nat: Carlito natural 13-25 impares, azul
    for size in (13, 15, 17, 19, 21, 23, 25):
        exporta(f'ca{size}_nat', render_natural(carlito, size, True))

    (BASE / 'esperado.json').write_text(json.dumps(esperado, indent=1), encoding='utf-8')
    print(f'grade: {len(esperado)} bins em {OUT}')
    print('gabarito: esperado.json')


if __name__ == '__main__':
    main()