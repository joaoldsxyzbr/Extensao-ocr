# train.py — treina o MLP (323→160→71) e exporta rede-ocr.js NOVO formato.
# Formato do arquivo idêntico ao do projeto: W1 flat [i*NH+j] (i=entrada),
# W2 flat [j*NCLS+k], b1/b2, chars — o motor (ocr-comum.js) NÃO muda.
import time, json
from pathlib import Path
import numpy as np

BASE = Path(__file__).parent
CHARS = (list('0123456789')
         + [chr(x) for x in range(65, 91)]
         + [chr(x) for x in range(97, 123) if chr(x) != 'l']
         + list('.,-/()%&+:'))
NIN, NH, NC = 323, 160, len(CHARS)

def load():
    d = np.load(BASE / 'dataset.npz')
    X, y = d['X'], d['y']
    return X.astype(np.float32), y.astype(np.int64)

def forward(Xb, W1, b1, W2, b2):
    h = np.maximum(Xb @ W1 + b1, 0.0)          # (B,NH)
    o = h @ W2 + b2                             # (B,NC)
    return h, o

def softmax_ce(o, y):
    o = o - o.max(axis=1, keepdims=True)
    e = np.exp(o)
    p = e / e.sum(axis=1, keepdims=True)
    n = len(y)
    loss = -np.log(np.maximum(p[np.arange(n), y], 1e-12) + 1e-12).mean()
    return p, loss

def main():
    rng = np.random.default_rng(7)
    X, y = load()
    N = len(X)
    print('dataset:', X.shape, 'classes:', NC)
    idx = rng.permutation(N)
    n_val = int(0.05 * N)
    iva, itr = idx[:n_val], idx[n_val:]
    Xva, yva = X[iva], y[iva]
    Xtr, ytr = X[itr], y[itr]
    print(f'treino {len(Xtr)} / val {len(Xva)}')

    W1 = (rng.standard_normal((NIN, NH)) * np.sqrt(2.0 / NIN)).astype(np.float32)
    b1 = np.zeros(NH, dtype=np.float32)
    W2 = (rng.standard_normal((NH, NC)) * np.sqrt(2.0 / NH)).astype(np.float32)
    b2 = np.zeros(NC, dtype=np.float32)
    mW1 = np.zeros_like(W1); vW1 = np.zeros_like(W1)
    mb1 = np.zeros_like(b1); vb1 = np.zeros_like(b1)
    mW2 = np.zeros_like(W2); vW2 = np.zeros_like(W2)
    mb2 = np.zeros_like(b2); vb2 = np.zeros_like(b2)
    params = [(W1, mW1, vW1, 'W1'), (b1, mb1, vb1, 'b1'), (W2, mW2, vW2, 'W2'), (b2, mb2, vb2, 'b2')]

    lr, B, EP = 1.5e-3, 512, 30
    best_acc, best_state, paci, t0 = 0.0, None, 0, time.time()
    nb = len(Xtr) // B
    for ep in range(1, EP + 1):
        ordem = rng.permutation(len(Xtr))
        lt = 0.0
        for bi in range(nb):
            s = ordem[bi * B:(bi + 1) * B]
            Xb, yb = Xtr[s], ytr[s]
            h, o = forward(Xb, W1, b1, W2, b2)
            p, loss = softmax_ce(o, yb)
            lt += loss
            # gradiente
            p[np.arange(len(yb)), yb] -= 1.0
            go = p / len(yb)                        # (B,NC)
            gW2 = h.T @ go; gb2 = go.sum(axis=0)
            gh = (go @ W2.T) * (h > 0)
            gW1 = Xb.T @ gh; gb1 = gh.sum(axis=0)
            grads = {'W1': gW1, 'b1': gb1, 'W2': gW2, 'b2': gb2}
            t = ep * nb + bi + 1
            for P, M, V, nome in params:
                g = grads[nome]
                M *= 0.9; M += 0.1 * g
                V *= 0.999; V += 0.001 * (g * g)
                mh = M / (1 - 0.9 ** t); vh = V / (1 - 0.999 ** t)
                P -= lr * mh / (np.sqrt(vh) + 1e-8)
        # val
        acertos = 0
        for s in range(0, len(Xva), 4096):
            _, o = forward(Xva[s:s + 4096], W1, b1, W2, b2)
            acertos += (o.argmax(axis=1) == yva[s:s + 4096]).sum()
        acc = acertos / len(Xva)
        lrl = lr * (0.5 ** (ep // 10)) if False else lr
        print(f'ep {ep:2d}  loss {lt/nb:.4f}  val acc {acc*100:.3f}%  ({time.time()-t0:.0f}s)', flush=True)
        if acc > best_acc:
            best_acc = acc
            best_state = [P.copy() for P, _, _, _ in params]
            paci = 0
        else:
            paci += 1
            if paci >= 5:
                print('early stop'); break
    W1, b1, W2, b2 = best_state

    # export rede-ocr-v2.1.js
    def fmt(vals):
        linhas = []
        for i in range(0, len(vals), 100):
            corpo = ','.join('%.6g' % v for v in vals[i:i + 100])
            fim = '' if i + 100 >= len(vals) else ','
            linhas.append('      ' + corpo + fim)
        return '\n'.join(linhas)
    chars_js = json.dumps(CHARS)
    hdr = f"""/* rede-ocr.js - pesos da rede neural do OCR proprio (v2.1.0).
   MLP: 323 entradas (16x20 + 3 medidas relativas a banda) -> 160 ocultas (ReLU) -> 71 classes (softmax).
   Treinada com glifos sinteticos de 13 variantes de fonte (Arimo 300-600, Carlito, DejaVu, Roboto, Mono),
   11-26px, gaps naturais a colados, variantes downscale 2x (AA), fundos claros, augment em nivel de grid.
   Corrige a classe de falha do print real de 09/11 (TIROL->MROL, BATAVINHO->BMAVINHO, 400G->WOG):
   glifos apertados/fundidos agora leem com confianca alta e o DP divide em vez de aceitar a leitura fundida.
   Gerado automaticamente por train.py; nao editar a mao. */
(function (raiz) {{
  'use strict';
  raiz.REDE_OCR = {{
    chars: {chars_js},
    W1: [
{fmt(W1.ravel().tolist())}
    ],
    b1: [{','.join('%.6g' % v for v in b1.tolist())}],
    W2: [
{fmt(W2.ravel().tolist())}
    ],
    b2: [{','.join('%.6g' % v for v in b2.tolist())}]
  }};
}})(typeof self !== 'undefined' ? self : this);
"""
    out = BASE / 'rede-ocr-v2.1.js'
    out.write_text(hdr)
    print('exportado:', out, out.stat().st_size, 'bytes')
    print('melhor val acc:', f'{best_acc*100:.3f}%')
    np.savez(BASE / 'pesos-treino.npz', W1=W1, b1=b1, W2=W2, b2=b2)

if __name__ == '__main__':
    main()