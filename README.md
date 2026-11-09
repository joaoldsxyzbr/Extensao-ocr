# Extrator de Produtos (OCR) — v2.0.1

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
  sintéticos de 11 fontes sans de tela, 11–25 px, com aumento de dados
  (deslocamento, borrão, ruído, escala).
- `ocr-comum.js` — motor: tinta → limpeza de grade → bandas de linha →
  runs → divisão ótima de glifos fundidos (programação dinâmica pelo produto
  das confianças) → features do glifo → rede neural → regras de contexto
  (primeiro token = código, só dígitos) → reparos por token.
- Tudo é texto plano (~450 KB no total). Nada para baixar, nenhum antivírus
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
| `manifest.json` | Manifest V3 (v2.0.1), sem permissões de rede |
| `ocr-comum.js` | Motor de OCR (rede neural + segmentação) |
| `rede-ocr.js` | Pesos treinados (gerado por `train.py`) |
| `parser.js` | Extração de código + descrição no padrão do ERP |
| `popup.html` / `popup.js` | Extrator rápido (colar, copiar, salvar) |
| `ui.html` / `ui.js` / `ui.css` | Extrator completo (texto bruto, edição) |
| `background.js` | Menu de contexto "Extrair produtos" |
| `tests/test-parser.js` | Testes do parser (Node) |
| `tools/gerar-prints-teste.py` | Gera prints sintéticos para teste |

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

O motor JavaScript produz exatamente a mesma saída da referência de treino
(66/66 linhas idênticas na suíte automatizada). Se algum caractere vier
errado, a interface permite editar antes de copiar.

## Limitações

- O motor foi treinado para texto sem serifa (telas de computador);
  manuscritos e fotos de papel não são alvo.
- A fonte alvo é Calibri/Carlito (ERP). Em fontes de outra métrica o núcleo
  de glifos continua correto, mas o espaçamento entre palavras pode gerar
  falsos espaços.
- Se uma letra do print estiver fisicamente colada na outra (kerning
  extremo), a segmentação pode unir os dois glifos.
