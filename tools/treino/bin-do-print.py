# bin-do-print.py — converte um print REAL (PNG/JPG) no formato .bin da suite.
# O motor nao decodifica PNG: a suite roda sobre .bin (header w,h uint32 LE +
# pixels float32 LE 0..1, cinza). Os prints reais ficam em prints/ e os .bin
# em grade_real/.
#
# Uso (a partir de tools/treino/):
#   python bin-do-print.py ../prints/print-1.png [mais-um.png ...]
#   (ou sem argumentos: converte TODOS os PNG/JPG de ../prints/)
#
# Depois registre o gabarito em esperado-real.json (tag = nome sem o gray_/
# e .bin, igual ao esperado.json) com as linhas CORRETAS confirmadas por quem
# tirou o print. Aí o regressao.py passa a cobrir o print real.
import struct, sys
from pathlib import Path
import numpy as np
from PIL import Image

BASE = Path(__file__).parent
PDIR = BASE.parent / 'prints'
OUT = BASE / 'grade_real'


def converte(img_path):
    img = Image.open(img_path)
    arr = np.asarray(img.convert('L'), dtype=np.float64) / 255.0
    h, w = arr.shape
    OUT.mkdir(exist_ok=True)
    dest = OUT / (img_path.stem + '.bin')
    with open(dest, 'wb') as f:
        f.write(struct.pack('<II', w, h))
        f.write(arr.astype('<f4').tobytes())
    print(f'{dest.name}: {w}x{h}')


def main():
    if len(sys.argv) > 1:
        for a in sys.argv[1:]:
            converte(Path(a))
        return
    imgs = sorted(list(PDIR.glob('*.png')) + list(PDIR.glob('*.jpg')))
    if not imgs:
        print(f'nenhum print em {PDIR} — arraste os prints para essa pasta')
        return
    for p in imgs:
        converte(p)


if __name__ == '__main__':
    main()