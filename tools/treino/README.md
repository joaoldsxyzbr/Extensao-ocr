# Treino da rede OCR e suíte de regressão

Pipeline que gerou a `rede-ocr.js` v2.1.0 e o **gate de regressão** que todo
retreino futuro precisa passar. A extensão em si continua **zero dependências**:
o que vai pra ela é um único arquivo de texto (`rede-ocr.js` na raiz). Tudo aqui
é ferramenta de trabalho, roda fora do Chrome.

## Arquivos

| Arquivo | Papel |
| --- | --- |
| `gen.py` | Gera o dataset de treino (glifos sintéticos espelhando o preprocessamento do motor) |
| `train.py` | Treina o MLP 323→160→71 e exporta `rede-ocr-v2.1.js` + `pesos-treino.npz` |
| `exporta.py` | Reexporta `rede-ocr-v2.1.js` de `pesos-treino.npz` sem retreinar |
| `paridade.py` | Confere que o espelho Python (gen.py) está fiel ao motor JS |
| `fwd.js` | Forward da rede em Node (valida o arquivo exportado) |
| `harness.js` | Roda o motor completo (`ocr-comum.js` + `rede-ocr.js`) em um `.bin` |
| `gera-grade.py` | Gera a grade canônica de 140 prints sintéticos + gabarito `esperado.json` |
| `regressao.py` | **O GATE**: motor da raiz vs gabarito; falha se regredir caso verde |
| `baseline.json` | Lista de casos verdes (acertos) congelada na versão atual |
| `bin-do-print.py` | Converte print REAL (PNG) no formato `.bin` da suíte |
| `render.py`, `sweep2/3/4.py`, `testa_upscale.py` | Varreduras de diagnóstico (escala, gap, peso, contraste, upscale) |

## Preparo (uma vez por máquina)

1. Python 3.10+ e Node 18+ instalados.
2. `pip install numpy scipy pillow`
3. Fontes TTF em `tools/treino/fonts/` (nomes exatos abaixo). Downloads verificados:
   - `Arimo.ttf` — [Arimo variable](https://github.com/google/fonts/raw/main/ofl/arimo/Arimo%5Bwght%5D.ttf) (é o variable; `set_variation_by_axes` usa os pesos 300-600)
   - `Carlito-Regular.ttf` / `Carlito-Bold.ttf` — [Carlito](https://github.com/google/fonts/raw/main/ofl/carlito/Carlito-Regular.ttf) (fonte-alvo: o ERP usa Calibri/Carlito)
   - `Roboto-Regular.ttf` / `Roboto-Bold.ttf` — [Roboto Regular](https://github.com/googlefonts/roboto/raw/main/src/hinted/Roboto-Regular.ttf) / [Roboto Bold](https://github.com/googlefonts/roboto/raw/main/src/hinted/Roboto-Bold.ttf)
   - `DejaVuSans.ttf`, `DejaVuSans-Bold.ttf`, `DejaVuSansMono.ttf`, `DejaVuSansMono-Bold.ttf` — dentro do [zip oficial 2.37](https://github.com/dejavu-fonts/dejavu-fonts/releases/download/version_2_37/dejavu-fonts-ttf-2.37.zip) (`ttf/` do zip)
4. `python gera-grade.py` — gera os 140 bins da grade em `grade/`.

## Fluxo do retreino (regras)

1. `python gen.py` — gera `dataset.npz` (leva alguns minutos).
2. `python train.py` — treina e exporta `rede-ocr-v2.1.js` (early stop por val acc).
3. Substitua o motor: copie `rede-ocr-v2.1.js` para a **raiz** como `rede-ocr.js`.
4. `python regressao.py` — **zero regressões obrigatório** (caso verde que virou
   erro reprova o modelo na hora).
5. Se corrigiu casos: `python regressao.py --gerar-baseline` (regenera o
   `baseline.json`), confira o diff, atualize a `version` do `manifest.json` e
   suba `rede-ocr.js` + `manifest.json` + `baseline.json` juntos.
6. Diagnóstico fino, se precisar: `sweep2/3/4.py`, `render.py`, `testa_upscale.py`.

**Aviso de formato**: o `rede-ocr.js` exportado usa **linhas de até 100 valores
com vírgula no fim de cada linha intermediária**. Não reformate o arquivo:
leituras por linha truncam linhas longas silenciosamente e o push corrompe.

## Prints reais (a parte que mais vale)

Print real do ERP na suíte = caso de regressão permanente:

1. Coloque o PNG em `prints/` (nome curto, sem espaços).
2. `python bin-do-print.py` — converte para `grade_real/<nome>.bin`.
3. Registre em `esperado-real.json` o que o print **deve** ler (linhas
   `CÓDIGO DESCRIÇÃO`, conferidas por quem tirou o print).
4. `python regressao.py` passa a cobrir o print real junto com a grade sintética.

Sem gabarito o print não vira teste — anotar o esperado é o que faz valer.

## Histórico

- v2.0.0 (09/11/2026): motor próprio, rede de 4 fontes.
- v2.0.1 (09/11/2026): DP de segmentação + escala real 19-23px, rede de 11 fontes.
- v2.1.0 (10/11/2026): retreino com 13 variantes de fonte, gaps colados e AA
  (downscale 2×) — corrige glifos apertados/fundidos (TIROL→MROL, 400G→WOG).
  Val acc 99,38%; grade 140 prints: 5 corrigidos, 0 regressões vs v2.0.1.
  Baseline congelado: **20/140 verdes** — os casos na escala real do ERP
  (Carlito natural 19-25px) estão verdes; os 120 vermelhos (gap colado,
  12-17px, contraste 80/130) são o alvo dos próximos retreinos.