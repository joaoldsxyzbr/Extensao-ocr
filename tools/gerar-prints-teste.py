#!/usr/bin/env python3
"""
gerar-prints-teste.py — Gera prints sintéticos (PNG) equivalentes aos prints
reais do João, para validar o pipeline OCR + parser sem depender de bibliotecas.
Fonte bitmap 5x7 desenhada à mão, escala 5, fundo branco.
"""
import struct, zlib, os

# Fonte 5x7 (linhas de 5 bits)
F = {
 'A': ["01110","10001","10001","11111","10001","10001","10001"],
 'B': ["11110","10001","10001","11110","10001","10001","11110"],
 'C': ["01110","10001","10000","10000","10000","10001","01110"],
 'D': ["11110","10001","10001","10001","10001","10001","11110"],
 'E': ["11111","10000","10000","11110","10000","10000","11111"],
 'F': ["11111","10000","10000","11110","10000","10000","10000"],
 'G': ["01110","10001","10000","10111","10001","10001","01111"],
 'H': ["10001","10001","10001","11111","10001","10001","10001"],
 'I': ["01110","00100","00100","00100","00100","00100","01110"],
 'J': ["00111","00010","00010","00010","00010","10010","01100"],
 'K': ["10001","10010","10100","11000","10100","10010","10001"],
 'L': ["10000","10000","10000","10000","10000","10000","11111"],
 'M': ["10001","11011","10101","10101","10001","10001","10001"],
 'N': ["10001","11001","10101","10011","10001","10001","10001"],
 'O': ["01110","10001","10001","10001","10001","10001","01110"],
 'P': ["11110","10001","10001","11110","10000","10000","10000"],
 'Q': ["01110","10001","10001","10001","10101","10010","01101"],
 'R': ["11110","10001","10001","11110","10100","10010","10001"],
 'S': ["01111","10000","10000","01110","00001","00001","11110"],
 'T': ["11111","00100","00100","00100","00100","00100","00100"],
 'U': ["10001","10001","10001","10001","10001","10001","01110"],
 'V': ["10001","10001","10001","10001","10001","01010","00100"],
 'W': ["10001","10001","10001","10101","10101","11011","10001"],
 'X': ["10001","10001","01010","00100","01010","10001","10001"],
 'Y': ["10001","10001","01010","00100","00100","00100","00100"],
 'Z': ["11111","00001","00010","00100","01000","10000","11111"],
 '0': ["01110","10001","10011","10101","11001","10001","01110"],
 '1': ["00100","01100","00100","00100","00100","00100","01110"],
 '2': ["01110","10001","00001","00110","01000","10000","11111"],
 '3': ["11110","00001","00001","01110","00001","00001","11110"],
 '4': ["00010","00110","01010","10010","11111","00010","00010"],
 '5': ["11111","10000","11110","00001","00001","10001","01110"],
 '6': ["01110","10000","11110","10001","10001","10001","01110"],
 '7': ["11111","00001","00010","00100","01000","01000","01000"],
 '8': ["01110","10001","10001","01110","10001","10001","01110"],
 '9': ["01110","10001","10001","01111","00001","00001","01110"],
 '/': ["00001","00010","00010","00100","01000","01000","10000"],
 '-': ["00000","00000","00000","01110","00000","00000","00000"],
 ':': ["00000","00100","00000","00000","00000","00100","00000"],
 ' ': ["00000","00000","00000","00000","00000","00000","00000"],
}

ESCALA = 10
PX, GAP = ESCALA, ESCALA

def escrever_png(caminho, larg, alt, pixels):  # pixels: lista de linhas RGB
    def chunk(tipo, dados):
        c = struct.pack('>I', len(dados)) + tipo + dados
        return c + struct.pack('>I', zlib.crc32(tipo + dados) & 0xffffffff)
    raw = b''.join(b'\x00' + bytes(b for px in linha for b in px) for linha in pixels)
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', larg, alt, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 6))
    png += chunk(b'IEND', b'')
    with open(caminho, 'wb') as f:
        f.write(png)

def renderizar(texto, negrito_barra=None):
    """Renderiza linhas de texto; devolve (largura, altura, pixels RGB)."""
    linhas = texto.strip('\n').split('\n')
    altura_gly = 7 * PX
    # barra de título cinza (chrome de tela) no topo
    bar_h = 2 * PX if negrito_barra else 0
    margem = 4 * PX
    larg_cont = max(len(l) for l in linhas) * (5 * PX + GAP) - GAP
    larg = larg_cont + 2 * margem
    alt = bar_h + len(linhas) * (altura_gly + 2 * PX) + 2 * margem - 2 * PX
    # fundo branco
    grid = [[(255, 255, 255)] * larg for _ in range(alt)]
    # barra de título
    for y in range(bar_h):
        for x in range(larg):
            grid[y][x] = (230, 230, 230)
    y0 = margem + bar_h
    for li, linha in enumerate(linhas):
        x0 = margem
        for ch in linha:
            gl = F.get(ch.upper(), F[' '])
            for gy, rowbits in enumerate(gl):
                for gx, bit in enumerate(rowbits):
                    if bit == '1':
                        for dy in range(PX):
                            for dx in range(PX):
                                yy = y0 + li * (altura_gly + 2 * PX) + gy * PX + dy
                                xx = x0 + gx * PX + dx
                                if yy < alt and xx < larg:
                                    grid[yy][xx] = (0, 0, 0)
            x0 += 5 * PX + GAP
    return larg, alt, grid

def reduzir_2x(grid):
    """Downsample 2x por média de blocos 2x2 → antialiasing."""
    alt = len(grid) // 2 * 2
    larg = len(grid[0]) // 2 * 2
    out = []
    for y in range(0, alt, 2):
        linha = []
        for x in range(0, larg, 2):
            acc = [0, 0, 0]
            for dy in (0, 1):
                for dx in (0, 1):
                    px = grid[y + dy][x + dx]
                    acc[0] += px[0]; acc[1] += px[1]; acc[2] += px[2]
            linha.append((acc[0] // 4, acc[1] // 4, acc[2] // 4))
        out.append(linha)
    return out

def main():
    out = os.path.join(os.path.dirname(__file__), '..', 'tests')
    os.makedirs(out, exist_ok=True)

    # Print A: ficha de inconsistência (código sozinho, descrição abaixo)
    texto_a = """
CODIGO
104527
DESCRICAO DA INCONSISTENCIA
QUANTIDADE RECEBIDA DIVERGE DO QUE CONSTA NA NOTA
PRODUTO
BEBIDA LACTEA PARMALAT FIT FLEX CHOCOLATE 250ML UN
"""
    larg, alt, px = renderizar(texto_a, negrito_barra=True)
    px = reduzir_2x(px); larg //= 2; alt //= 2
    escrever_png(os.path.join(out, 'print-sintetico-a.png'), larg, alt, px)
    print(f'print-sintetico-a.png: {larg}x{alt}')

    # Print B: grid com numeração de linha
    texto_b = """
20 96551 DIANTEIRO BOV RESF C/ OSSO KG
25 87601 FILE AMERICANO BOVINO RESFRIADO KG
"""
    larg, alt, px = renderizar(texto_b)
    px = reduzir_2x(px); larg //= 2; alt //= 2
    escrever_png(os.path.join(out, 'print-sintetico-b.png'), larg, alt, px)
    print(f'print-sintetico-b.png: {larg}x{alt}')

if __name__ == '__main__':
    main()
