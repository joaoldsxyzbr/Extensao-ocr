# Renderiza o print real do João (3 produtos Tirol/Petit Suisse) sinteticamente
# em várias escalas, fonte Arial-like (Arimo), fundo alternado branco/azul-claro.
# Exporta gray_*.bin (header w,h uint32 LE + pixels float32 LE 0..1).
import struct, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

BASE = Path(__file__).parent
FONTS = BASE / 'fonts'

LINHAS = [
    ('101357', 'PETIT SUISSE BATATAVINHO SHREK 320G MORANGO'),
    ('103864', 'IOGURTE TIROL PESSEGO COM PEDACOS 400G'),
    ('103865', 'IOGURTE TIROL MORANGO COM PEDACOS 400G'),
]

def render(font_path: Path, size: int, blue_bg: bool, gray_bg: int = 30, col2: int = 110):
    font = ImageFont.truetype(str(font_path), size)
    asc, desc_f = font.getmetrics()
    pad_v = max(3, size // 2)
    row_h = (asc + desc_f) + 2 * max(3, size // 3)
    W, H = 660, pad_v * 2 + row_h * 3
    # RGB p/ fundo azul-claro realista do ERP
    img = Image.new('RGB', (W, H), (255, 255, 255))
    d = ImageDraw.Draw(img)
    for i, (cod, desc) in enumerate(LINHAS):
        y0 = pad_v + i * row_h
        if blue_bg and i % 2 == 1:
            d.rectangle([0, y0, W - 1, y0 + row_h - 1], fill=(232, 240, 251))
        ty = y0 + (row_h - asc - desc_f) // 2
        d.text((20, ty), cod, font=font, fill=(gray_bg,) * 3)
        d.text((col2, ty), desc, font=font, fill=(gray_bg,) * 3)
    return img

def cap_px(font_path: Path, size: int) -> int:
    font = ImageFont.truetype(str(font_path), size)
    l, t, r, b = font.getbbox('PESSEGO')
    return b - t

def export_bin(img: Image.Image, out: Path):
    arr = np.asarray(img.convert('L'), dtype=np.float64) / 255.0
    h, w = arr.shape
    with open(out, 'wb') as f:
        f.write(struct.pack('<II', w, h))
        f.write(arr.astype('<f4').tobytes())

if __name__ == '__main__':
    outdir = BASE / 'bins'
    outdir.mkdir(exist_ok=True)
    (BASE / 'pngs').mkdir(exist_ok=True)
    font = FONTS / 'Arimo.ttf'
    sizes = [int(s) for s in sys.argv[1].split(',')] if len(sys.argv) > 1 else range(12, 31, 2)
    for size in sizes:
        for bg in (True, False):
            tag = f'{size}{"az" if bg else "br"}'
            img = render(font, size, bg)
            export_bin(img, outdir / f'gray_{tag}.bin')
            img.save(BASE / 'pngs' / f'print_{tag}.png')
            print(f'{tag}: fonte {size}px, cap height {cap_px(font, size)}px')