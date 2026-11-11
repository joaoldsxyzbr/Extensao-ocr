# Spec de design: OCR de linha inteira com CRNN (v3.0)

Data: 2026-11-11
Status: aprovado (arquitetura e critério de troca decididos pelo Joao em conversa)
Classificacao: mudanca arquitetural

## Problema

O motor de segmentacao de glifos e a fonte de ~100% dos erros remanescentes:
dos 120 vermelhos sinteticos, ~92 sao glifo cortado, 10 espaco falso e 18 tinta
invisivel — nenhum e do classificador (99,60% e esgotado, v2.2). Cada correcao
v2.x foi um reparo pontual (DP, TTA, splitDig, Fix B); o proximo erro de
segmentacao repete o padrao. A CRNN elimina a classe inteira: lê a LINHA de
uma vez, sem cortar glifo e sem limiar de espaco.

## Decisoes

| # | Decisao | Alternativa rejeitada | Motivo |
| --- | --- | --- | --- |
| 1 | CRNN (CNN + BiLSTM x2 + CTC), leitura por linha | B: CNN por colunas sem RNN | contexto do vizinho recupera glifo degradado (caso do fundo azul); teto maior; B fica de fallback aprovado se o treino estourar o runner |
| 2 | Treino com PyTorch CPU no runner do CI | numpy puro; treino local | CTC e gradientes prontos e estaveis; runner 2-core cabe com modelo pequeno |
| 3 | Inferencia JS pura, zero dependencias | ONNX Runtime Web / TF.js | regra do projeto: sem dependencias; conv+LSTM manual e so mais um motor de forward |
| 4 | Dataset de LINHAS sinteticas (mesmas 13 fontes/variantes, 11-26px, gaps naturais a colados, fundos claros, AA/blur/downscale) | reaproveitar dataset de glifos | a entrada da CRNN e a linha, nao o glifo |
| 5 | GATE COMPARATIVO: a CRNN so substitui o motor na extensao quando os acertos na grade (141 sinteticos + prints reais) ficarem >= os do motor atual, com todo print REAL verde | entrar direto com gate proprio | decisao do Joao; a extensao que funciona hoje nao regride |
| 6 | Motor de bandas (projecao horizontal), normalizacao de fundo e parser.js PERMANECEM | reescrever tudo | essas partes nao sao a fonte de erro |
| 7 | Pre-processamento de tinta relativa por banda (decisao 2 da spec do motor) e INCORPORADO; histerese de espaco (decisao 4) MORRE | manter as duas | CTC decide espaco sozinho; tinta relativa segue necessaria p/ achar bandas em fundo degradado |
| 8 | Pesos exportados em TEXTO (rede-crnn.js, linhas de 100 valores com virgula no fim de cada linha) | binario | limites do conector/sandbox e antivírus |
| 9 | Decode CTC em JS: greedy primeiro | beam search | greedy costuma bastar p/ caixa alta espaçada; beam entra so se um caso real mostrar falta |
| 10 | Pipeline novo em tools/treino/ (gen-linhas.py, train-crnn.py, exporta-crnn.py, paridade-crnn.py) + job proprio treino-crnn.yml | esticar gen.py/train.py | entrada, batch e custo de treino sao outro mundo |

## Comportamento esperado

- Extensao: MESMA API OCRComum.extrairDeArquivo -> {itens, texto, confianca};
  UI nao muda. confianca = media das probs do CTC por linha.
- Durante o desenvolvimento a extensao segue no motor atual (v2.3.x) ate o
  gate comparativo passar; depois, bump p/ v3.0.0.

## Impacto

- NOVOS: rede-crnn.js, tools/treino/{gen-linhas.py, train-crnn.py,
  exporta-crnn.py, paridade-crnn.py}, .github/workflows/treino-crnn.yml,
  gate comparativo (compara os dois motores na mesma grade).
- MUDAM so no dia do gate: ocr-comum.js (leitura vira banda -> CRNN -> CTC
  decode; segmentacao/DP/TTA/splitDig saem), manifest.json (3.0.0), README.
- NAO MUDAM: parser.js, tests/test-parser.js (15), popup/ui HTML/CSS,
  motor de bandas, treino.yml do MLP (valid ate o dia do gate).
- O motor per-glifo (rede-ocr.js + segmentacao) sai da extensao no gate e e
  removido do repo so apos a homologacao real do Joao com prints do ERP.

## Riscos e mitigacoes

| Risco | Mitigacao |
| --- | --- |
| Treino estourar o limite do runner (6h em 2 nucleos) | modelo pequeno (hidden 128-192), medir 1 época antes de rodar todas; se estourar, plano B (CNN por colunas) ja aprovado como fallback |
| Divergencia FreeType vs Chrome (a mesma dos verdes que divergem por ambiente) | augment forte (blur, downscale, AA, fundos); gate comparativo roda os DOIS motores no MESMO ambiente; homologacao real no Chrome decide |
| LSTM manual em JS com bug de precisao | teste de paridade JS=Python no mesmo protocolo do motor.js (66/66): forward identico antes de qualquer gate |
| CRNN perder caso que o motor atual acerta | e exatamente o gate comparativo: nao entra ate empatar ou ganhar na grade inteira + print real |
| So ha 1 print real no repo (hortifruti) | sintetico cobre o treino; cada print novo em prints/ (web UI do Joao) vira caso de regressao permanente |
| Iteracao lenta (~1-3h por treino vs 2min30 do MLP) | experimentos planejados em lote; grade congelada decide, sem tentativa as cegas |
