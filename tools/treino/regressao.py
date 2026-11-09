# regressao.py — GATE de regressao do OCR. Nenhum retreino sobe sem passar aqui.
# Roda o motor do REPO RAIZ (ocr-comum.js + rede-ocr.js da raiz) em todos os
# bins da grade sintetica e compara com o gabarito (esperado.json).
#
# Regras do gate:
#   - caso VERDE no baseline (motor acertava) que passa a errar  -> REGRESSAO (exit 1)
#   - caso vermelho que passa a acertar                          -> CORRIGIU (bom sinal;
#     atualize o baseline com --gerar-baseline e suba junto com o novo rede-ocr.js)
#
# Uso (a partir de tools/treino/):
#   python gera-grade.py            # 1x por maquina, e apos mudar o gerador
#   python regressao.py             # gate
#   python regressao.py --gerar-baseline   # regravar o baseline apos correcoes
#
# Prints REAIS (opcional): converta com bin-do-print.py para grade_real/ e
# registre o gabarito em esperado-real.json (mesmo formato do esperado.json).
import json, subprocess, sys
from pathlib import Path

BASE = Path(__file__).parent
RAIZ = BASE.parent.parent
OUT = BASE / 'grade'

# (dir dos bins, gabarito, obrigatorio?)
PARES = [(BASE / 'grade', BASE / 'esperado.json', True),
         (BASE / 'grade_real', BASE / 'esperado-real.json', False)]


def roda(binp):
    r = subprocess.run(['node', str(BASE / 'harness.js'), str(RAIZ), str(binp)],
                       capture_output=True, text=True, timeout=120)
    try:
        return json.loads(r.stdout)['linhas']
    except Exception:
        print('ERRO no node/harness:', binp.name, r.stderr[:200])
        return None


def main():
    gerar = '--gerar-baseline' in sys.argv
    bl_path = BASE / 'baseline.json'
    if bl_path.exists():
        bl = json.loads(bl_path.read_text())
        baseline = set(bl['verdes'])
    else:
        baseline = set()
    n_ok = n_reg = n_err = 0
    novos_verdes = []
    faltando = False

    for ddir, esp_path, obrigatorio in PARES:
        if not esp_path.exists():
            if obrigatorio:
                print(f'FALTA {esp_path.name} — rode: python gera-grade.py')
                sys.exit(2)
            continue
        esperado = json.loads(esp_path.read_text())
        for tag, exp in sorted(esperado.items()):
            binp = ddir / f'gray_{tag}.bin'
            if not binp.exists():
                print(f'FALTA {binp.name} — rode: python gera-grade.py')
                faltando = True
                continue
            out = roda(binp)
            if out is None:
                n_err += 1
                continue
            if out == exp:
                n_ok += 1
                novos_verdes.append(tag)
            elif tag in baseline:
                n_reg += 1
                print(f'REGRESSAO em {tag}:')
                for l in out: print('   >', l)
            else:
                n_err += 1
                print(f'ainda errado: {tag}')
                for l in out: print('   >', l)

    print(f'\nacertos {n_ok} | erros remanescentes {n_err} | REGRESSOES {n_reg} | total {n_ok + n_err + n_reg}')
    if gerar:
        bl_path.write_text(json.dumps({'modelo': 'gerado por regressao.py --gerar-baseline',
                                       'verdes': sorted(novos_verdes)}, indent=1), encoding='utf-8')
        print(f'baseline regravado: {bl_path.name} ({len(novos_verdes)} verdes)')
        sys.exit(1 if n_reg else 0)
    if n_reg:
        print('GATE FALHOU: regrediu caso verde. NAO suba este rede-ocr.js.')
        sys.exit(1)
    if faltando:
        sys.exit(2)
    print('GATE OK')


if __name__ == '__main__':
    main()