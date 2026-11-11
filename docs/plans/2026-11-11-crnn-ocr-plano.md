# Plano: OCR de linha inteira com CRNN (v3.0)

Spec: docs/specs/2026-11-11-crnn-ocr-design.md
Branch: crnn-v3

## Tarefas

### Tarefa 1: Gerador de linhas sintéticas (gen-linhas.py)

- Arquivos: tools/treino/gen-linhas.py
- Mudança: renderiza LINHAS inteiras (codigo + espacos + descricao em caixa
  alta, vocabulario dos prints reais do ERP + aleatorio nas 71 classes) nas
  mesmas 13 variantes de fonte do gen.py, tamanhos 11-26px, gaps naturais a
  colados, fundos branco/cinza/azul-claro, augment (blur, downscale/upscale
  0.7-1.4x, jitter). Espelha o preprocessamento do motor: banda recortada,
  ink = clip((1-gray-0.15)/0.7), redimensiona p/ altura fixa 32px preservando
  proporcao, pad p/ bucket de largura (multiplo de 16). Saida: partes .npz
  chunked por fonte + merge em dataset-linhas.npz (X float16 N x 32 x W,
  larguras reais, labels por indice com blank reservado no 0). Modos:
  '<ini>..<fim>' (chunk de fontes), 'merge', 'amostra' (24 PNGs + stats).
- Verificacao: 'python gen-linhas.py amostra' com Carlito -> 24 PNGs
  inspecionaveis, shapes e larguras coerentes; seed fixa = regeravel.
- Criterio de pronto: dataset completo gera sem erro; PNG de amostra legivel.

### Tarefa 2: Treino CRNN em PyTorch (treino-crnn.py)

- Arquivos: tools/treino/treino-crnn.py
- Mudanca: modelo Conv(1->32,s1)->Conv(32->64,s2)->Conv(64->64,s1)->
  Conv(64->96,s2) -> BiLSTM(96) x2 -> Linear -> 72 classes (71 chars + blank
  no 0); alvo <= 600k params. CTCLoss do torch, Adam, batches por bucket de
  largura, seed fixa. Flags: --epocas, --n (subamostra), --peso-entrada.
  Saida: pesos-crnn.pt + log de custo/epoca + CER de validacao.
- Verificacao: rodada local com --epocas 1 --n 2000 -> loss cai e CER val
  < 5%; tempo/linha medido e projetado p/ dataset cheio no runner.
- Criterio de pronto: custo por epoca estimado dentro do limite do runner.

### Tarefa 3: Exportador de pesos (exporta-crnn.py)

- Arquivos: tools/treino/exporta-crnn.py
- Mudanca: pesos-crnn.pt -> rede-crnn.js em TEXTO (float com 4 decimais,
  linhas de 100 valores com VIRGULA no fim de cada linha), header com
  arquitetura (dims dos convs, hidden do LSTM) lido pelo motor JS.
- Verificacao: arquivo regerado byte-a-byte de .pt iguais (round-trip);
  node --check na rede-crnn.js.
- Criterio de pronto: rede-crnn.js carrega em Node sem erro.

### Tarefa 4: Motor JS de inferencia + paridade (motor-crnn.js)

- Arquivos: tools/treino/motor-crnn.js, tools/treino/paridade-crnn.py
- Mudanca: forward CRNN em JS puro (conv por im2col+matmul, BiLSTM manual,
  greedy CTC decode) lendo rede-crnn.js; entrada = banda gray 0..1 w,h.
  paridade-crnn.py: exporta 60 bins de linhas + saidas esperadas do Python;
  motor-crnn.js roda os bins e compara.
- Verificacao: node tools/treino/motor-crnn.js -> 60/60 linhas IDENTICAS
  ao Python (protocolo do motor.js 66/66).
- Criterio de pronto: 60/60; tempo/linha < 100ms em Node.

### Tarefa 5: Treino no CI (treino-crnn.yml)

- Arquivos: .github/workflows/treino-crnn.yml
- Mudanca: workflow_dispatch (branch via ref), baixa as 10 fontes (mesmo
  bloco validado do treino.yml), pip install torch CPU, gen-linhas (n
  conforme input), treino, exporta, paridade 60/60 no runner, artifacts
  (rede-crnn.js, pesos, logs). Primeiro run: --epocas 1 --n reduzido =
  MEDIÇÃO de custo no runner antes do treino completo.
- Verificacao: run verde; log com tempo/epoca; artifact baixavel.
- Criterio de pronto: custo total projetado cabe no timeout (240 min).

### Tarefa 6: Gate comparativo (compara-crnn.py)

- Arquivos: tools/treino/compara-crnn.py
- Mudanca: roda a grade (141 sinteticos + prints reais do esperado-real.json)
  nos DOIS motores no MESMO ambiente: atual (ocr-comum.js da raiz, via node)
  vs CRNN (motor-crnn.js); relatorio por caso; exit 0 sse CRNN >= motor atual
  em acertos E todo print real verde.
- Verificacao: relatorio com diff caso a caso; rodada no runner via workflow.
- Criterio de pronto: decisao de troca e mecanica, pronta p/ decidir.

### Tarefa 7: Troca na extensao (SO quando o gate comparativo passar)

- Arquivos: ocr-comum.js, manifest.json, README.md, popup/ui se preciso.
- Mudanca: leitura vira banda -> CRNN -> CTC decode; segmentacao/DP/TTA/
  splitDig removidos; rede-ocr.js (MLP) sai da extensao; manifest 3.0.0.
- Verificacao: gate comparativo verde + parser 15/15 + node --check +Release
  ZIP v3.0.0 + homologacao do Joao com prints reais no Chrome.
- Criterio de pronto: Joao valida no Chrome com print FULL do hortifruti.

## Ordem e dependencias

1 -> 2 -> 3 -> 4 estritamente sequenciais (cada uma consume a anterior).
5 depende da 2 (roda com amostra reduzida em paralelo a 3/4 se der).
6 depende de 4 + 5. 7 so depois de 6 verde + OK do Joao.

## Validacao final

1. python gen-linhas.py amostra + merge (shapes coerentes)
2. treino completo no CI: run verde, CER val e custo dentro do previsto
3. paridade JS=Python 60/60 NO RUNNER (job do treino-crnn.yml)
4. gate comparativo no runner: relatorio + decisao registrada
5. (se trocar) parser 15/15 + node --check + release ZIP + homologacao Joao
CI verde: gate.yml em cada push; treino-crnn.yml via dispatch na crnn-v3.
