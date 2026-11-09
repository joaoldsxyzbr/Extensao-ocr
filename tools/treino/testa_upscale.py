# Gera versões 2x (bilinear) dos bins de teste e compara motor com/sem upscale.
import struct, subprocess, json, sys
from pathlib import Path
import numpy as np
from PIL import Image

BASE = Path(__file__).parent
RAIZ = BASE.parent.parent  # raiz do repo (ocr-comum.js + rede-ocr.js)

def read_bin(p):
    b = Path(p).read_bytes()
    w = struct.unpack_from('<I', b, 0)[0]
    h = struct.unpack_from('<I', b, 4)[0]
    arr = np.frombuffer(b, dtype='<f4', offset=8, count=w*h).reshape(h, w).astype(np.float64)
    return arr, w, h

def write_bin(arr, p):
    h, w = arr.shape
    with open(p, 'wb') as f:
        f.write(struct.pack('<II', w, h))
        f.write(arr.astype('<f4').tobytes())

def upscale2x(arr):
    img = Image.fromarray((arr * 255).astype(np.uint8), 'L')
    img2 = img.resize((arr.shape[1] * 2, arr.shape[0] * 2), Image.BILINEAR)
    return np.asarray(img2, dtype=np.float64) / 255.0

def run(binp):
    r = subprocess.run(['node', str(BASE / 'harness.js'), str(RAIZ), str(binp)],
                       capture_output=True, text=True, timeout=60)
    d = json.loads(r.stdout)
    return d['linhas']

def ok(linhas):
    exp = ['101357 PETIT SUISSE BATATAVINHO SHREK 320G MORANGO',
           '103864 IOGURTE TIROL PESSEGO COM PEDACOS 400G',
           '103865 IOGURTE TIROL MORANGO COM PEDACOS 400G']
    return linhas == exp

if __name__ == '__main__':
    src_dir = BASE / sys.argv[1]
    outdir = BASE / (sys.argv[1] + '_2x')
    outdir.mkdir(exist_ok=True)
    rows = []
    for b in sorted(src_dir.glob('*.bin')):
        arr, w, h = read_bin(b)
        arr2 = upscale2x(arr)
        b2 = outdir / (b.stem + '.bin')
        write_bin(arr2, b2)
        l1 = run(b)
        l2 = run(b2)
        rows.append((b.stem, l1, l2, ok(l1), ok(l2)))
        flag = '' if ok(l1) == ok(l2) else ('  << CORRIGIU' if (not ok(l1)) and ok(l2) else '  << REGREDIU')
        print(f"{b.stem}: antes={'OK' if ok(l1) else 'ERRO'} depois={'OK' if ok(l2) else 'ERRO'}{flag}")
        if not ok(l2):
            for l in l2: print('     >', l)
    n_fix = sum(1 for r in rows if not r[3] and r[4])
    n_reg = sum(1 for r in rows if r[3] and not r[4])
    print(f"\nCORRIGIDOS: {n_fix} | REGREDIDOS: {n_reg} | total {len(rows)}")