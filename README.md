# Extrator de Produtos (OCR) — v2.0.0

Extensão Chrome (Manifest V3) que lê prints de telas de ERP e extrai a lista de
produtos no padrão:

```
94940 IOGURTE BATAVO PENSE 1150G ZERO MORANGO UN
104527 BEBIDA LACTEA PARMALAT FIT FLEX CHOCOLATE 250ML UN
96551 DIANTEIRO BOV RESF C/ OSSO KG
```

## Sem dependências — 100% local

A partir da v2.0.0 o OCR é um motor próprio com rede neural embutida no
repositório. Não há mais Tesseract, WASM, CDN, instalador ou workflow de CI:

- `rede-ocr.js` — pesos da rede (MLP 323 → 160 → 71) treinada com glifos
  sintéticos das fontes comuns de tela (Arimo, DejaVu, Roboto, monospace),
  9–25 px, com aumento de dados (deslocamento, borrão, ruído, escala).
- `ocr-comum.js` — motor: tinta → limpeza de grade → bandas de linha →
  segmentação → features do glifo → rede neural → regras de contexto
  (primeiro token = código, só dígitos).
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
| `manifest.json` | Manifest V3 (v2.0.0), sem permissões de rede |
| `ocr-comum.js` | Motor de OCR (rede neural + segmentação) |
| `rede-ocr.js` | Pesos treinados (gerado por `train.py`) |
| `parser.js` | Extração de código + descrição no padrão do ERP |
| `popup.html` / `popup.js` | Extrator rápido (colar, copiar, salvar) |
| `ui.html` / `ui.js` / `ui.css` | Extrator completo (texto bruto, edição) |
| `background.js` | Menu de contexto "Extrair produtos" |
| `tests/test-parser.js` | Testes do parser (Node) |
| `tools/gerar-prints-teste.py` | Gera prints sintéticos para teste |

## Qualidade esperada

Homologação sintética com a tabela real de 10 produtos (14 linhas, fundo
alternado, linhas de grade, divisor de coluna):

| Variante | Códigos | Linhas inteiras |
| --- | --- | --- |
| 13 px (tamanho real do ERP) | 10/10 | 10/10 |
| 13 px + desfoque + ruído | 10/10 | 9/10 |
| 11 px (bem pequeno) | 10/10 | 3/10 |

Textos abaixo de ~12 px degradam a descrição (o código continua correto).
Se algum caractere vier errado, a interface permite editar antes de copiar.

## Limitações

- O motor foi treinado para texto sem serifa (telas de computador);
  manuscritos e fotos de papel não são alvo.
- Se uma letra do print estiver fisicamente colada na outra (kerning
  extremo), a segmentação pode unir os dois glifos.
