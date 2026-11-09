# paridade.py — valida o gerador de features contra a rede v2.0.1 DEPLOYADA:
# se o espelho do preprocessamento estiver certo, a rede atual acerta ~100%
# das amostras limpas extraídas aqui.
import subprocess, json, sys
from pathlib import Path
import numpy as np
import gen

BASE = Path(__file__).parent
RAIZ = BASE.parent.parent  # raiz do repo (ocr-comum.js + rede-ocr.js)

def extrai_limpo(font, size, c, gap=0.0):
    gray, xc, xfim = gen.render_miniline(font, size, c, gap, 1.0, False, None)
    ink = gen.ink_from_gray(gray)
    bandas = gen.banda_da_imagem(ink)
    if not bandas: return None
    y0, y1 = bandas[0]
    hband = y1 - y0
    colink = (ink[y0:y1] > 0.50).sum(axis=0)
    runs = []
    ini = -1
    for x in range(ink.shape[1]):
        if colink[x] >= 1 and ini < 0: ini = x
        elif colink[x] < 1 and ini >= 0: runs.append((ini, x)); ini = -1
    if ini >= 0: runs.append((ini, ink.shape[1]))
    alvo = None
    for r in runs:
        if r[0] <= (xc + xfim) // 2 < r[1]: alvo = r; break
    if alvo is None: return None
    adv_c = max(xfim - xc, 1)
    if alvo[1] - alvo[0] > adv_c + max(4, 0.35 * adv_c): return None
    return gen.features(ink, y0, hband, alvo[0], alvo[1])

if __name__ == '__main__':
    casos = []
    idx_fontes = [0, 1, 2, 4, 8, 11]
    tamanhos = (13, 18, 23)
    if len(sys.argv) > 1: tamanhos = tuple(int(a) for a in sys.argv[1].split(','))
    import time
    t0 = time.time()
    for fi in idx_fontes:
        f = gen.FONTS[fi]
        for size in tamanhos:
            for c in gen.CHARS:
                ft = extrai_limpo(f, size, c)
                if ft is not None:
                    casos.append((c, ft))
    print(f'{len(casos)} casos extraídos em {time.time()-t0:.1f}s', flush=True)
    with open(str(BASE / 'fts_tmp.txt'), 'w') as fh:
        for _, ft in casos:
            fh.write(','.join('%.10g' % v for v in ft) + '\n')
    labels = [c for c, _ in casos]
    r = subprocess.run(['node', str(BASE / 'fwd.js'), str(RAIZ / 'rede-ocr.js'), str(BASE / 'fts_tmp.txt')],
                       capture_output=True, text=True, timeout=120)
    preds = json.loads(r.stdout)
    acertos = sum(1 for p, l in zip(preds, labels) if p['ch'] == l)
    print(f'rede v2.0.1 nas features limpas: {acertos}/{len(labels)} = {100*acertos/len(labels):.2f}%')
    erros = [(l, p['ch'], round(p['conf'], 3)) for p, l in zip(preds, labels) if p['ch'] != l]
    print('erros:', erros[:25])