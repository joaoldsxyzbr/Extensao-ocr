# Render glifo a glifo com GAP controlado entre glifos — simula fonte com
# side bearings apertados (Tahoma/Segoe/ClearType) onde T+A, T+I se TOCAM.
# Sweep: tamanho x gap x (fundo azul/branco), procura a assinatura do João:
#   PETIT→PM, BATATAVINHO→BMAVINHO, IOGURTE→IOGUFM, TIROL→MROL, 400G→WOG
import struct, subprocess, json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

BASE = Path(__file__).parent
RAIZ = BASE.parent.parent  # raiz do repo (ocr-comum.js + rede-ocr.js)
FONT = BASE / 'fonts' / 'Arimo.ttf'

LINHAS = [
    ('101357', 'PETIT SUISSE BATATAVINHO SHREK 320G MORANGO'),
    ('103864', 'IOGURTE TIROL PESSEGO COM PEDACOS 400G'),
    ('103865', 'IOGURTE TIROL MORANGO COM PEDACOS 400G'),
]

def draw_text(d, xy, text, font, gap, fill):
    x, y = xy
    for ch in text:
        if ch == ' ':
            x += max(3, font.size // 2)  # espaço entre palavras
            continue
        d.text((x, y), ch, font=font, fill=fill)
        x += font.getlength(ch) - gap
    return x

def render(size, gap, azul):
    font = ImageFont.truetype(str(FONT), size)
    asc, desc_f = font.getmetrics()
    pad_v = max(3, size // 2)
    row_h = (asc + desc_f) + 2 * max(3, size // 3)
    W, H = 700, pad_v * 2 + row_h * 3
    img = Image.new('RGB', (W, H), (255, 255, 255))
    d = ImageDraw.Draw(img)
    for i, (cod, desc) in enumerate(LINHAS):
        y0 = pad_v + i * row_h
        if azul and i % 2 == 1:
            d.rectangle([0, y0, W - 1, y0 + row_h - 1], fill=(232, 240, 251))
        ty = y0 + (row_h - asc - desc_f) // 2
        draw_text(d, (20, ty), cod, font, gap, (30, 30, 30))
        draw_text(d, (110, ty), desc, font, gap, (30, 30, 30))
    return img

def gray_bin(img, path):
    arr = np.asarray(img.convert('L'), dtype=np.float64) / 255.0
    h, w = arr.shape
    with open(path, 'wb') as fh:
        fh.write(struct.pack('<II', w, h))
        fh.write(arr.astype('<f4').tobytes())

SIG = ['PM ', 'BMAVINHO', 'IOGUFM', 'MROL', 'WOG']
def score(linhas):
    t = ' '.join(linhas)
    return sum(1 for s in SIG if s in t)

if __name__ == '__main__':
    outdir = BASE / 'sweep2'; outdir.mkdir(exist_ok=True)
    res = []
    for size in (13, 14, 15, 16, 17):
        for gap in (0.0, 0.5, 1.0, 1.5, 2.0):
            for azul in (True,):
                tag = f's{size}_g{gap}'
                img = render(size, gap, azul)
                p = outdir / f'gray_{tag}.bin'
                gray_bin(img, p)
                r = subprocess.run(['node', str(BASE / 'harness.js'), str(RAIZ), str(p)],
                                   capture_output=True, text=True, timeout=60)
                try:
                    d = json.loads(r.stdout)
                except Exception:
                    print(tag, 'ERRO:', r.stderr[:150]); continue
                sc = score(d['linhas'])
                res.append((sc, tag, d['linhas']))
    res.sort(key=lambda x: -x[0])
    for sc, tag, linhas in res:
        print(f'[{sc}] {tag}')
        for l in linhas: print('   ', l)