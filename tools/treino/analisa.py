# analisa.py — classifica os erros da grade: espaço falso vs glifo errado.
# Uso: python analisa.py (a partir do repo-staging/tools/treino)
import json, subprocess, re
from pathlib import Path
from collections import defaultdict

BASE = Path(__file__).parent
RAIZ = BASE.parent.parent
OUT = BASE / 'grade'

def roda(binp):
    r = subprocess.run(['node', str(BASE / 'harness.js'), str(RAIZ), str(binp)],
                       capture_output=True, text=True, timeout=120)
    try:
        return json.loads(r.stdout)['linhas']
    except Exception:
        return None

def normaliza(linhas):
    # codigo + desc sem espaços: compara só os caracteres
    return [re.sub(r'\s+', '', l) for l in linhas]

def main():
    esperado = json.loads((BASE / 'esperado.json').read_text())
    resumo = defaultdict(lambda: defaultdict(int))
    saidas = {}
    tipos = defaultdict(list)
    for tag in sorted(esperado):
        out = roda(OUT / f'gray_{tag}.bin')
        saidas[tag] = out
        grupo = ('bins' if re.match(r'^\d', tag)
                 else 'carlito_nat' if tag.endswith('nat')
                 else 'sweep4' if tag.startswith('ca')
                 else 'sweep3' if '_w' in tag
                 else 'sweep2')
        if out is None:
            resumo[grupo]['erro_node'] += 1
            continue
        if out == esperado[tag]:
            resumo[grupo]['verde'] += 1
        elif normaliza(out) == normaliza(esperado[tag]):
            resumo[grupo]['so_espaco_falso'] += 1  # caracteres certos, espaços errados
            tipos['espaco'].append(tag)
        else:
            resumo[grupo]['glifo_errado'] += 1
            tipos['glifo'].append(tag)
    for g, d in resumo.items():
        print(g, dict(d))
    print()
    print('espaco falso:', len(tipos['espaco']))
    print(tipos['espaco'][:30])
    print()
    print('glifo errado:', len(tipos['glifo']))
    print(tipos['glifo'][:40])
    (BASE / 'saidas-atual.json').write_text(json.dumps(saidas, indent=1))

if __name__ == '__main__':
    main()