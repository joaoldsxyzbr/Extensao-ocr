#!/usr/bin/env python3
"""
gerar-icones.py — Gera os ícones PNG da extensão (16/32/48/128) sem dependências.
Desenho: quadrado escuro arredondado com linhas de texto brancas (um "print"
sendo lido) e um canto azul de destaque. Renderiza em 4x e reduz (antialiasing).
"""
import struct, zlib, os

def chunk(tipo, dados):
    return (struct.pack('>I', len(dados)) + tipo + dados
            + struct.pack('>I', zlib.crc32(tipo + dados) & 0xffffffff))

def png(caminho, larg, alt, pixels):
    raw = b''.join(b'\x00' + bytes(b for px in linha for b in px) for linha in pixels)
    dados = (b'\x89PNG\r\n\x1a\n'
             + chunk(b'IHDR', struct.pack('>IIBBBBB', larg, alt, 8, 2, 0, 0, 0))
             + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b''))
    open(caminho, 'wb').write(dados)

def reduzir(grid, fator):
    h = (len(grid) // fator) * fator
    w = (len(grid[0]) // fator) * fator
    out = []
    for y in range(0, h, fator):
        linha = []
        for x in range(0, w, fator):
            a = [0, 0, 0]
            for dy in range(fator):
                for dx in range(fator):
                    p = grid[y + dy][x + dx]
                    a[0] += p[0]; a[1] += p[1]; a[2] += p[2]
            k = fator * fator
            linha.append((a[0] // k, a[1] // k, a[2] // k))
        out.append(linha)
    return out

def desenhar(n):
    """Desenha o ícone n×n com supersampling 4x."""
    S = 4
    N = n * S
    FUNDO = (23, 24, 29)      # #17181d
    BRANCO = (232, 232, 234)   # #e8e8ea
    AZUL = (37, 99, 235)       # #2563eb
    VERDE = (110, 231, 183)    # #6ee7b7

    grid = [[FUNDO] * N for _ in range(N)]

    def dentro_arredondado(x, y, raio):
        # quadrado com cantos arredondados
        for cx, cy in ((raio, raio), (N - 1 - raio, raio), (raio, N - 1 - raio), (N - 1 - raio, N - 1 - raio)):
            if (x < raio or x > N - 1 - raio) and (y < raio or y > N - 1 - raio):
                dx, dy = x - cx, y - cy
                if dx * dx + dy * dy > raio * raio:
                    return False
        return True

    raio = max(2 * S, N // 6)
    for y in range(N):
        for x in range(N):
            if dentro_arredondado(x, y, raio):
                grid[y][x] = (26, 27, 33)

    # "folha" branca com linhas de texto (o print sendo lido)
    m = N // 7          # margem
    folha_w = N - 2 * m
    folha_h = N - 2 * m - N // 4
    for y in range(m, m + folha_h):
        for x in range(m, m + folha_w):
            grid[y][x] = BRANCO
    # linhas de texto (cinza escuro) na folha
    linha_h = max(S, N // 14)
    espaco = max(S, N // 10)
    y0 = m + linha_h
    while y0 + linha_h <= m + folha_h - linha_h:
        comprimento = int(folha_w * (0.72 if (y0 % 2) else 0.55))
        for y in range(y0, y0 + linha_h):
            for x in range(m + linha_h, m + linha_h + comprimento):
                grid[y][x] = (60, 63, 72)
        y0 += linha_h + espaco
    # código em destaque no topo da folha (azul)
    for y in range(m + linha_h, m + 2 * linha_h):
        for x in range(m + linha_h, m + linha_h + int(folha_w * 0.42)):
            grid[y][x] = AZUL

    # marcador de extração (seta/check verde) no canto inferior direito
    r2 = N // 5
    cx, cy = N - r2 - N // 10, N - r2 - N // 10
    for y in range(cy - r2, cy + r2):
        for x in range(cx - r2, cx + r2):
            if (x - cx) ** 2 + (y - cy) ** 2 <= r2 * r2:
                grid[y][x] = VERDE
    # "check" dentro do círculo
    esp = max(1, r2 // 2)
    for i in range(-esp, esp + 1):
        for t in (-S // 2, S // 2):
            grid[cy + t + i][cx + i] = (6, 78, 59)
    for i in range(0, esp + 1):
        for t in (-S // 2, S // 2):
            grid[cy + esp - t + i][cx + i] = (6, 78, 59)
    return reduzir(grid, S)

def main():
    base = os.path.join(os.path.dirname(__file__), '..', 'icons')
    os.makedirs(base, exist_ok=True)
    for n in (16, 32, 48, 128):
        png(os.path.join(base, f'icon{n}.png'), n, n, desenhar(n))
        print(f'icon{n}.png ok')

if __name__ == '__main__':
    main()
