# exporta.py — reexporta rede-ocr-v2.1.js a partir de pesos-treino.npz (sem retreinar).
import json
from pathlib import Path
import numpy as np

BASE = Path(__file__).parent
CHARS = (list('0123456789')
         + [chr(x) for x in range(65, 91)]
         + [chr(x) for x in range(97, 123) if chr(x) != 'l']
         + list('.,-/()%&+:'))

def fmt(vals):
    linhas = []
    for i in range(0, len(vals), 100):
        corpo = ','.join('%.6g' % v for v in vals[i:i + 100])
        fim = '' if i + 100 >= len(vals) else ','
        linhas.append('      ' + corpo + fim)
    return '\n'.join(linhas)

def main():
    d = np.load(BASE / 'pesos-treino.npz')
    W1, b1, W2, b2 = d['W1'], d['b1'], d['W2'], d['b2']
    assert W1.shape == (323, 160) and W2.shape == (160, 71), (W1.shape, W2.shape)
    chars_js = json.dumps(CHARS)
    hdr = f"""/* rede-ocr.js - pesos da rede neural do OCR proprio (v2.2.0).
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
    out = BASE / 'rede-ocr-v2.2.js'
    out.write_text(hdr)
    print('exportado:', out, out.stat().st_size, 'bytes')

if __name__ == '__main__':
    main()