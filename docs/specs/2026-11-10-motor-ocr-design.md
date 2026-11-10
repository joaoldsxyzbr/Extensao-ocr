# Spec de design: motor OCR v2.3 — segmentação adaptativa

Data: 2026-11-10
Status: APROVADA pelo João (10/11/2026) — decisões 1, 3*, em andamento
Classificação: mudança arquitetural (motor `ocr-comum.js`)

## Problema

A grade de regressão (140 prints sintéticos) tem 120 vermelhos na v2.2.0. O
experimento v2.2 provou que o **classificador não é mais o gargalo**: retreino
com dataset 2,2× maior (420 mil amostras, val acc 99,60%) produziu saída
**idêntica** nos 140 casos — acertos e erros byte a byte iguais. Os erros
restantes são do motor, em três famílias:

1. **Invisíveis (18 casos)**: texto cinza claro (gray 130) tem tinta ~0,49,
   abaixo do limiar fixo 0,50 de run → o motor não forma run nenhum e devolve
   linha vazia. O glifo nunca chega à rede.
2. **Fragmentos (~92 casos)**: o DP divide runs largos e as metades leem com
   confiança alta (½ "O" lida como "(", porque ela *parece* um "("). Mais
   treino não conserta: o fragmento é inequivocamente aquilo.
3. **Espaço falso (10 casos)**: o limiar global de espaço (maior salto entre
   clusters de gap) cai dentro da variação de gap intra-palavra em fontes
   espaçadas ou renders apertados.

## Decisões (proposta)

| # | Decisão | Alternativa rejeitada | Motivo |
| --- | --- | --- | --- |
| 1 | Instrumentar antes: dump de diagnóstico (runs, gaps, confs por glifo, limiares escolhidos) nos 120 vermelhos | Ajustar limiares no chute | A v2.0.1 ensinou que tuning sem a escala real erra tudo |
| 2 | Tinta relativa por banda: limiar de run proporcional ao contraste da banda (~0,5 × p99 do ink), piso de cobertura por coluna mantido | Baixar o limiar fixo | Limiar fixo baixo transforma ruído/fundo sujo em run; relativo acompanha qualquer contraste |
| 3 | Hipótese de glifo cortado: dois fragmentos adjacentes que leem classes "complementares" (½ O → "(" + ")") num slot de ~2× a mediana → reler a UNIÃO com TTA e aceitar a leitura única se a confiança vencer o corte | Penalizar classes de metade | A penalidade ×0,7 por classe fora [0-9A-Z] já existe e não basta; reler a união ataca a causa |
| 4 | Espaço com histerese: espaço só se gap ≥ max(âncora atual, 1,3× mediana dos gaps intra-palavra da linha) | Só o salto de cluster | O salto único é frágil quando a variação intra-palavra é grande |
| 5 | Gate inalterado (`regressao.py`): nenhum verde pode regredir; sucesso = reduzir os 120 sem perder nenhum dos 20 | Métrica nova | O gate congelado é o juiz; nota nova mentiria |

## Comportamento esperado

- Print do ERP legível em qualquer contraste que o olho humano leia (até gray ~130).
- Metades de glifo deixam de virar "(" ")" etc.
- Menos espaços falsos SEM criar palavras coladas (o gate pega os dois lados).

## Impacto

- `ocr-comum.js` (motor). `rede-ocr.js` NÃO muda — pesos v2.2.0 valem.
- `regressao.py` / `gera-grade.py` inalterados: o gate é o juiz de tudo.
- `gen.py`: se a fórmula do ink mudar, o espelho acompanha e `paridade.py`
  é o teste da fidelidade do espelho.
- Cada mudança entra em commit separado, gate verde entre elas.

## Riscos e mitigações

- **Tinta relativa**: fundo sujo pode virar run fantasma → exigir cobertura
  mínima por banda (critério que já existe) e validar nos 20 verdes primeiro.
- **Reler uniões**: custo extra de TTA → só em candidatos raros (par
  complementar + slot largo), não em todo run.
- **Histerese de espaço**: pode colar palavras em fonte larga → o gate tem
  casos de espaço nos dois sentidos (colado e espaçado) e reprova.
## Instrumentação (passo 1, 10/11/2026) — achados no print real

O print real do hortifruti (`prints/hortifruti.png`, crop 277x114, fonte ~8 px
de banda) reproduziu AO VIVO os erros da homologação (282→12, 286→16, 292→82,
296→86, FUJI→FUX) e revelou a família de erro que a grade sintética não
cobria: **pares de glifos fundidos que escapam das defesas**.

Dump do motor (runs, DP, confianças TTA por glifo):

- O par "28" funde num run de 10 px. O DP não divide porque `rw <= limiteL`
  (1,75×mediana 6 = 10); o reparo do código não dispara porque exigia
  `wd >= med0+3` (10 < 7,5+3). O run lê "X" 0,54-0,61 e o forçador de dígito
  vira "1" — daí "12".
- O corte correto c=5 lê "2" 0,94 + "8" 0,58 — mas o splitDig antigo exigia
  conf >= 0,60 por pedaço e morria no 0,581.
- Na banda do 444, "444" todo fundido (18 px) passava do limite e o DP
  acertava — o buraco era só a janela 8-10 px.
- "JI" fundido (8 px) na descrição lê "X" 0,72; os pedaços leem J 0,99 e
  I 0,98.

Correções aplicadas (v2.3.0): aceitação por PRODUTO de confianças com
comparação contra a leitura do run inteiro (vence em ambos os sentidos:
dígito real largo rejeita a divisão, fusão lê fraco e a divisão vence).
Decisões 2 (tinta relativa) e 4 (histerese de espaço) seguem pendentes —
miram os 120 vermelhos sintéticos, não observados em prints reais.
