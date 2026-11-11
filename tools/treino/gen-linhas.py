# gen-linhas.py — dataset de LINHAS inteiras para a CRNN v3.0 (spec
# docs/specs/2026-11-11-crnn-ocr-design.md, plano tarefa 1).
#
# Espelha o preprocessamento do motor (ocr-comum.js): banda da linha em ink
# = clip((1-gray-0.15)/0.7), redimensionada p/ ALTURA FIXA 32px preservando
# proporcao. Duas discretas de layout do ERP: COLUNAR (codigo numa coluna,
# descricao em outra, tipo render.py do Tirol) e CORRIDO (codigo + espaco +
# descricao, tipo hortifruti). Fundos branco/cinza/azul-claro, texto claro em
# parte das amostras (casos duros), augment blur/AA/jitter.
#
# Modos:
#   python gen-linhas.py amostra            -> 24 PNGs + stats (sem npz)
#   python gen-linhas.py 0..13 [n]          -> chunk das fontes [0,13) com n/fonte
#   python gen-linhas.py merge              -> concatena partes em dataset-linhas.npz
#
# Saida por chunk: parte-<ini>-<fim>.npz com X uint8 (N,32,W) em ink 0..255,
# L int32 largura util de cada linha, Y int16 labels (0=blank, classe+1),
# YL int32 tamanho do label, S uint8 (N,LMAX) texto ASCII. Seed fixa por
# chunk = 1000+indice da fonte (regeravel).
import sys, random, math
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

BASE = Path(__file__).parent
FDIR = BASE / 'fonts'
HF = 32            # altura fixa da linha de entrada da CRNN
LMAX = 64          # tamanho maximo do texto-label
CH = (list('0123456789')
      + [chr(x) for x in range(65, 91)]
      + [chr(x) for x in range(97, 123) if chr(x) != 'l']
      + list('.,-/()%&+:')
      + [' '])                     # ESPACO E CLASSE: CTC emite espaco como char
IDX = {c: i + 1 for i, c in enumerate(CH)}   # 0 = blank do CTC; 73 saidas

FONTS = []
for f in ['Carlito-Regular.ttf', 'Carlito-Bold.ttf', 'DejaVuSans.ttf',
          'DejaVuSans-Bold.ttf', 'DejaVuSansMono.ttf', 'DejaVuSansMono-Bold.ttf',
          'Roboto-Regular.ttf', 'Roboto-Bold.ttf']:
    FONTS.append((f, FDIR / f, None))
for w in (300, 400, 500, 600):
    FONTS.append((f'Arimo{w}', FDIR / 'Arimo.ttf', w))

# vocabulario real do ERP (prints do Joao) — 50% das linhas vem daqui
REAIS = [
    '282 ABACATE KG', '286 LARANJA PERA KG', '292 MACA FUJI KG',
    '296 MELAO AMARELO KG', '318 CENOURA KG', '444 MANGA PALMER KG',
    '446 BANANA BRANCA KG', '533 LARANJA BAHIA KG', '715 PESSEGO NACIONAL KG',
    '815 ALHO PORO UN', '1083 ABACAXI PEROLA UN',
    '101357 PETIT SUISSE BATATAVINHO SHREK 320G MORANGO',
    '103864 IOGURTE TIROL PESSEGO COM PEDACOS 400G',
    '103865 IOGURTE TIROL MORANGO COM PEDACOS 400G',
    '94940 IOGURTE BATAVO PENSE 1150G ZERO MORANGO UN',
    '86227 PAO DA MARCIA INTEGRAL 500G', '85197 MACA FUJI NACIONAL KG',
    '53330 BANANA PRATA KG', '41218 QUEIJO MINAS FRESCAL KG',
]
PALAVRAS = ['ABACAXI', 'ABACATE', 'IOGURTE', 'MORANGO', 'PESSEGO', 'BANANA',
            'MACA', 'LARANJA', 'MELAO', 'CENOURA', 'MANGA', 'ALHO', 'PORO',
            'TIROL', 'PETIT', 'SUISSE', 'BATATAVINHO', 'BATATA', 'SHREK',
            'PEROLA', 'NACIONAL', 'BAHIA', 'PALMER', 'BRANCA', 'FUJI',
            'AMARELO', 'PRATA', 'INTEGRAL', 'BATAVO', 'PENSE', 'ZERO',
            'PEDACOS', 'COM', 'DA', 'DE', 'FRESCAL', 'MINAS', 'QUEIJO',
            'REQUEIJAO', 'CREME', 'LEITE', 'COBERTURA', 'TORTA', 'PAO',
            'MARGARINA', 'MANTEIGA', 'RECHEADO', 'DANON', 'ZERO', 'ACUCAR',
            'SUCO', 'NECTAR', 'GOIABA', 'UVA', 'MELANCIA', 'COUVE', 'ALFACE',
            'TOMATE', 'CEBOLA', 'BATATA-DOCE', 'MANDIOCA', 'JILO']
UNIDADES = ['KG', 'UN', 'CX', 'PC', 'LT', 'FD', 'DZ', 'MT', 'SC', 'RL', 'PAR', 'BAR']
PESOS = ['90G', '100G', '170G', '200G', '320G', '340G', '400G', '450G', '500G',
         '750G', '1KG', '1,5KG', '2KG', '1150G']

def linha_aleatoria(rng):
    r = rng.random()
    if r < 0.50:                       # linha real (vocabulario ERP)
        s = rng.choice(REAIS)
        return s
    if r < 0.85:                       # composicao plausivel
        cod = str(rng.randint(1, 10 ** rng.choice([1, 2, 3, 4, 5, 6])))
        pal = [rng.choice(PALAVRAS) for _ in range(rng.randint(2, 6))]
        if rng.random() < 0.35:
            pal.append(rng.choice(PESOS))
        txt = cod + ' ' + ' '.join(pal)
        if rng.random() < 0.80:
            txt += ' ' + rng.choice(UNIDADES)
        return txt
    # cobertura de chars raros: tokens com pontuacao/minusculas
    cod = str(rng.randint(1, 999999))
    toks = []
    for _ in range(rng.randint(2, 5)):
        k = rng.random()
        if k < 0.4:
            toks.append(''.join(rng.choice(CH) for _ in range(rng.randint(3, 9))))
        elif k < 0.7:
            toks.append(f'{rng.randint(1,99)}{rng.choice(["G","ML","/","%"])}')
        else:
            toks.append(rng.choice(['C/12', 'X', 'S/', 'FL.', 'PCT', rng.choice(PESOS)]))
    return cod + ' ' + ' '.join(toks)

_font_cache = {}
def get_font(path, peso, size):
    key = (str(path), peso, size)
    f = _font_cache.get(key)
    if f is None:
        f = ImageFont.truetype(str(path), size)
        if peso is not None:
            try: f.set_variation_by_axes([peso])
            except Exception: pass
        _font_cache[key] = f
    return f

def render_linha(texto, font, rng):
    """Renderiza UMA linha, retorna img PIL RGB. Uma sorte decide layout E
    desenho: COLUNAR (desc comeca numa coluna fixa, tipo render.py do Tirol)
    ou CORRIDO (gap natural, tipo hortifruti)."""
    asc, desc = font.getmetrics()
    s = font.size
    x0 = int(s * rng.uniform(0.4, 0.9))
    colunar = rng.random() < 0.45
    if colunar:
        cod, resto = texto.split(' ', 1)
        w0 = font.getlength(cod)
        col2 = max(x0 + w0 + s * 0.8, s * rng.uniform(4.5, 6.0))
        x1 = int(col2)
        W = int(x1 + font.getlength(resto)) + 8
        partes = [(x0, cod), (x1, resto)]
    else:
        W = int(x0 + font.getlength(texto)) + 8
        partes = [(x0, texto)]
    pad_v = max(3, s // 2)
    H = asc + desc + pad_v * 2
    r = rng.random()
    if r < 0.55:
        bg = (255, 255, 255)
    elif r < 0.75:
        v = rng.randint(238, 250)
        bg = (v, v, v)
    else:
        bg = (232, 240, 251)
    img = Image.new('RGB', (W, H), bg)
    d = ImageDraw.Draw(img)
    ty = pad_v + rng.randint(-1, 1)
    # texto claro em 1/6 das amostras (casos duros tipo gray 80-140)
    if rng.random() < 1 / 6:
        g = rng.randint(80, 140)
    else:
        g = rng.randint(15, 75)
    for x, t in partes:
        d.text((x, ty), t, font=font, fill=(g,) * 3)
    return img

def augment(img, rng):
    k = rng.random()
    if k < 0.35:                       # AA-mush: upscale + downscale
        f = rng.uniform(1.2, 1.6)
        img = img.resize((int(img.width * f), int(img.height * f)),
                         Image.BILINEAR).resize(
                         (int(img.width), int(img.height)), Image.BILINEAR)
    if rng.random() < 0.55:            # blur leve
        img = img.filter(ImageFilter.GaussianBlur(rng.uniform(0.2, 0.6)))
    if rng.random() < 0.25:            # noise
        a = np.asarray(img, dtype=np.int16)
        ruido = np.random.RandomState(rng.randint(0, 2**31)).randint(-6, 7, a.shape)
        a += ruido.astype(np.int16)
        img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    return img

def linha_para_input(img):
    """PIL RGB -> (gray ink banda 0..1 uint8, w). Espelho do motor."""
    gray = np.asarray(img.convert('L'), dtype=np.float64) / 255.0
    ink = np.clip((1.0 - gray - 0.15) / 0.7, 0.0, 1.0)
    linhas_com_tinta = np.where(ink.max(axis=1) > 0.30)[0]
    if len(linhas_com_tinta) == 0:
        return None, 0
    y0 = max(0, linhas_com_tinta[0] - 1)
    y1 = min(ink.shape[0], linhas_com_tinta[-1] + 2)
    banda = ink[y0:y1]
    h = y1 - y0
    escala = HF / h
    w2 = max(8, int(round(banda.shape[1] * escala)))
    banda = np.array(Image.fromarray((banda * 255).astype(np.uint8)).resize(
        (w2, HF), Image.BILINEAR), dtype=np.float64) / 255.0
    return (banda * 255).astype(np.uint8), w2

def gera_chunk(ini, fim, n, seed_base=1000):
    Xs, Ls, Ys, YLs, Ss = [], [], [], [], []
    for fi in range(ini, fim):
        if fi >= len(FONTS): break
        nome, path, peso = FONTS[fi]
        rng = random.Random(seed_base + fi)
        for _ in range(n):
            texto = linha_aleatoria(rng).strip()
            if any(c not in IDX for c in texto):
                continue                      # guarda: label so aceita as 71 classes
            size = rng.randint(11, 26)
            font = get_font(path, peso, size)
            img = render_linha(texto, font, rng)
            img = augment(img, rng)
            x, w = linha_para_input(img)
            if x is None or w > 1536: continue
            lab = [IDX.get(c, 0) for c in texto if c in IDX][:LMAX]
            if len(lab) < 2: continue
            Xs.append(x); Ls.append(x.shape[1])
            Ys.append(lab + [0] * (LMAX - len(lab))); YLs.append(len(lab))
            b = texto.encode('ascii', 'ignore')[:LMAX]
            Ss.append(b + b' ' * (LMAX - len(b)))
    if not Xs:
        raise SystemExit('ERRO: chunk vazio')
    W = max(x.shape[1] for x in Xs)
    X = np.zeros((len(Xs), HF, W), dtype=np.uint8)
    for i, x in enumerate(Xs):
        X[i, :, :x.shape[1]] = x
    return {'X': X, 'L': np.array(Ls, dtype=np.int32),
            'Y': np.array(Ys, dtype=np.int16), 'YL': np.array(YLs, dtype=np.int32),
            'S': np.array([list(b) for b in Ss], dtype=np.uint8)}

def cmd_amostra():
    rng = random.Random(7)
    out = BASE / 'amostra-linhas'
    out.mkdir(exist_ok=True)
    disponiveis = [f for f in FONTS if Path(f[1]).exists()]
    widths = []
    for i in range(24):
        nome, path, peso = disponiveis[i % len(disponiveis)]
        texto = linha_aleatoria(rng)
        size = rng.randint(11, 26)
        font = get_font(path, peso, size)
        img = render_linha(texto, font, rng)
        img = augment(img, rng)
        x, w = linha_para_input(img)
        assert x is not None, f'linha {i} sem tinta?!'
        arr = 255 - np.repeat((255 - x).astype(np.uint8)[:, :, None], 3, axis=2)
        Image.fromarray(arr.astype(np.uint8)).save(out / f'linha-{i:02d}-{nome[:-4]}.png')
        widths.append(w)
        print(f'linha {i:02d} [{nome} {size}px] w={w:4d} label="{texto[:50]}"')
    print(f'\nHF={HF} | larguras: min={min(widths)} max={max(widths)} '
          f'media={sum(widths)/len(widths):.0f} | X esp. {HF}x{max(widths)} uint8')
    print(f'fontes disponiveis: {len(disponiveis)} de {len(FONTS)}')

def cmd_chunk(arg, n):
    a, b = arg.split('..')
    ini, fim = int(a), int(b)
    data = gera_chunk(ini, fim, n)
    out = BASE / f'parte-{ini}-{fim}.npz'
    np.savez_compressed(out, **data)
    mb = out.stat().st_size / 1e6
    print(f'{out.name}: {data["X"].shape[0]} linhas, W={data["X"].shape[2]}, '
          f'{mb:.1f} MB compactado')

def cmd_merge():
    partes = sorted(BASE.glob('parte-*.npz'))
    if not partes:
        raise SystemExit('ERRO: nenhuma parte encontrada')
    Xs, Ls, Ys, YLs, Ss = [], [], [], [], []
    for p in partes:
        d = np.load(p)
        Xs.append(d['X']); Ls.append(d['L']); Ys.append(d['Y'])
        YLs.append(d['YL']); Ss.append(d['S'])
    W = max(x.shape[2] for x in Xs)
    X = np.zeros((sum(x.shape[0] for x in Xs), HF, W), dtype=np.uint8)
    i = 0
    for x in Xs:
        X[i:i + x.shape[0], :, :x.shape[2]] = x
        i += x.shape[0]
    out = BASE / 'dataset-linhas.npz'
    np.savez_compressed(out, X=X, L=np.concatenate(Ls), Y=np.concatenate(Ys),
                        YL=np.concatenate(YLs), S=np.concatenate(Ss))
    print(f'{out.name}: {X.shape[0]} linhas, W={W}, '
          f'{out.stat().st_size / 1e6:.1f} MB')

if __name__ == '__main__':
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    modo = sys.argv[1]
    if modo == 'amostra':
        cmd_amostra()
    elif modo == 'merge':
        cmd_merge()
    elif '..' in modo:
        cmd_chunk(modo, int(sys.argv[2]) if len(sys.argv) > 2 else 5000)
    else:
        raise SystemExit(__doc__)
