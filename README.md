# Extrator de Produtos (OCR) — v2.2.0

Extensão Chrome (Manifest V3) que lê prints de telas de ERP e extrai a lista de
produtos no padrão:

```
94940 IOGURTE BATAVO PENSE 1150G ZERO MORANGO UN
104527 BEBIDA LACTEA PARMALAT FIT FLEX CHOCOLATE 250ML UN
96551 DIANTEIRO BOV RESF C/ OSSO KG
```

## Sem dependências — 100% local

A partir da v2.0.0 o OCR é um motor próprio com rede neural embutida no
repositório. Não há Tesseract, WASM, CDN, instalador ou workflow de CI:

- `rede-ocr.js` — pesos da rede (MLP 323 → 160 → 71) treinada com glifos
  sintéticos de 13 variantes de fonte sans (Arimo 300–600, Carlito reg/bold,
  DejaVu reg/bold, Mono reg/bold, Roboto reg/bold), 11–26 px, com
  espaçamento natural até glifos colados, variantes redimensionadas (AA de
  downscale 2x) e fundos claros, além de aumentação (deslocamento, borrão,
  ruído, escala, fase).
- `ocr-comum.js` — motor: tinta → limpeza de grade → bandas de linha →
  runs → divisão ótima de glifos fundidos (programação dinâmica pelo produto
  das confianças) → features do glifo → rede neural → regras de contexto
  (primeiro token = código, só dígitos) → reparos por token.
- Tudo é texto plano (~620 KB no total). Nada para baixar, nenhum antivírus
  reclama do pacote, nenhum passo de instalação.

A imagem nunca sai do navegador: ela é lida em um `<canvas>` e classificada
localmente.

## Como usar

1. Baixe o ZIP (ou clone) e extraia em uma pasta.
2. Em `chrome://extensions`, ative o Modo do desenvolvedor.
3. "Carregar sem compactação" → escolha a pasta extraída.
4. Tire um print da tela de produtos (Win+Shift+S), cole no popup (Ctrl+V)
   ou abra o extrator completo.

## Arquivos

| Arquivo | Papel |
| --- | --- |
| `manifest.json` | Manifest V3 (v2.1.0), sem permissões de rede |
| `ocr-comum.js` | Motor de OCR (rede neural + segmentação) |
| `rede-ocr.js` | Pesos treinados (gerado por `train.py`) |
| `parser.js` | Extração de código + descrição no padrão do ERP |
| `popup.html` / `popup.js` | Extrator rápido (colar, copiar, salvar) |
| `ui.html` / `ui.js` / `ui.css` | Extrator completo (texto bruto, edição) |
| `background.js` | Menu de contexto "Extrair produtos" |
| `tests/test-parser.js` | Testes do parser (Node) |
| `tools/gerar-prints-teste.py` | Gera prints sintéticos para teste |
| `tools/treino/` | Pipeline de treino da rede + suite de regressão (ver `tools/treino/README.md`) |

## Qualidade esperada

Validação sintética na escala real do ERP (19–23 px), com a tabela real de
10 produtos (grade, fundo alternado) e a tabela de 9 produtos com linha de
fundo azul (sem grade). Linhas inteiras corretas, incluindo espaços:

| Variante | Linhas inteiras |
| --- | --- |
| Tabela com grade, 19 px | 10/10 |
| Tabela com grade, 21 px | 10/10 |
| Tabela com grade, 21 px + desfoque + ruído | 10/10 |
| Tabela com linha azul, 19 px | 9/9 |
| Tabela com linha azul, 21 px | 9/9 |
| Tabela com linha azul, 23 px | 9/9 |
| Tabela com linha azul, 21 px + desfoque | 9/9 |

### v2.2.0 — retreino de robustez (hard-example mining)

Dataset 2,2× maior (420 mil amostras: texto claro, gaps até -1,5 px, tamanhos
até 30 px, 12 variantes de fonte). Val acc 99,60% (era 99,38%). A grade de
regressão (140 prints sintéticos) manteve a MESMA nota — 20/140 verdes,
0 regressões, saída idêntica — provando que o classificador não é mais o
gargalo: os erros restantes são do motor (segmentação, espaços, contraste).
Plano do motor: `docs/specs/2026-11-10-motor-ocr-design.md`.

### v2.1.0 — robustez a glifos apertados e anti-aliasing

Retreino da rede (mesma arquitetura, motor inalterado) para corrigir a classe
de falha observada em print real de 09/11 (códigos certos, descrições com
glifos fundidos: TIROL→MROL, BATAVINHO→BMAVINHO, 400G→WOG). O novo treino
inclui glifos quase colados, variantes redimensionadas (AA) e pesos finos a
semibold. Validação:

- Glifos limpos: 99,75% (antes 98,18% na mesma suíte);
- Grade de 133 prints sintéticos (Arimo/Carlito, 9–19 px, fundo branco/azul,
  espaçamento natural a colado): 5 casos corrigidos, 0 regressões;
- Nos casos de espaçamento apertado a rede nova recupera as descrições
  (ex.: "PM8 WGW EA1ATAVINHO" → "PETIT SUISSE BATATAVINHO").

Se algum caractere vier errado, a interface permite editar antes de copiar.

## Limitações

- O motor foi treinado para texto sem serifa (telas de computador);
  manuscritos e fotos de papel não são alvo.
- A fonte alvo é Calibri/Carlito (ERP). Em fontes de outra métrica o núcleo
  de glifos continua correto, mas o espaçamento entre palavras pode gerar
  falsos espaços.
- Kerning extremo com glifos fisicamente colados ainda pode fundir dois
  glifos, mas a janela de falha ficou bem menor na v2.1.0.