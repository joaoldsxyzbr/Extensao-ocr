# Extrator de Produtos (OCR)

Extensão Chrome/Edge (Manifest V3) que lê **prints de tela** e devolve o texto no padrão:

```
94940 IOGURTE BATAVO PENSE 1150G ZERO MORANGO UN
104527 BEBIDA LACTEA PARMALAT FIT FLEX CHOCOLATE 250ML UN
96551 DIANTEIRO BOV RESF C/ OSSO KG
```

O OCR (rede neural LSTM do Tesseract) roda **100% no navegador** — a imagem do print
nunca sai da sua máquina. Os arquivos do modelo ficam embutidos na extensão
(pasta `vendor/`), então funciona offline depois de instalada.

## Instalar

1. Baixe/clone este repositório.
2. Abra `chrome://extensions` (ou `edge://extensions`) e ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e escolha a pasta do projeto.

## Usar

- **Cole um print** (Ctrl+V) na página do extrator;
- **Arraste** imagens para a área tracejada; ou
- **Clique com o botão direito** em qualquer imagem na web → **"Extrair produtos deste print (OCR)"**.

Os itens reconhecidos aparecem em linhas **editáveis** (código e descrição).
Com o print em mãos você pode corrigir eventual erro de OCR na hora.

- **Copiar lista** → copia os itens marcados, um por linha, no padrão acima;
- **Salvar na lista** → acumula itens entre sessões (`chrome.storage.local`);
  o popup da extensão mostra a contagem e copia a lista salva.

## Como o texto vira produto

O `parser.js` aplica estas regras ao texto do OCR:

- código = número isolado de 4–8 dígitos (`250ML` não é código, é colado em letra);
- descrição = texto após o código, **sem acento**, maiúsculo, espaços simples;
- código sozinho na linha → a descrição é procurada nas linhas seguintes,
  pulando rótulos ("Descrição da inconsistência" etc.);
- rótulos de tela e quantidade solta no final da linha são descartados.

## Estrutura

```
manifest.json            MV3; permissões storage/activeTab/contextMenus
background.js             menu de contexto em imagens + ícone desenhado em runtime
popup.html/.js            painel rápido (contagem + copiar lista salva)
ui.html/.css/.js          extrator: colar/arrastar/soltar, OCR, edição, listas
parser.js                 parser de produtos (puro, testável em Node)
vendor/                   Tesseract.js v7 + core LSTM (SIMD) + modelo 'por' (b64)
  origem.json             core/lang: local (padrão) ou cdn (fallback)
tools/                    geradores, instaladores offline e teste de OCR
tests/                    testes do parser (prints sintéticos: gere com tools/)
```

### Ícones

O ícone do botão é desenhado em runtime (`background.js`, OffscreenCanvas) — o
repo não carrega PNGs binários. Se quiser ícones "de arquivo", rode
`python3 tools/gerar-icones.py` (gera `icons/`) e adicione de volta a seção
`"icons"` no `manifest.json`.

## OCR: o que é local e o que é baixado

| Componente | De onde vem | Offline? |
|---|---|---|
| Engine Tesseract (tesseract.min.js, worker.min.js) | embutido no repo | ✅ sempre |
| Modelo do idioma `por` (b64) | embutido no repo → cache IndexedDB | ✅ sempre |
| Core LSTM (wasm, ~4 MB) | CDN por padrão; arquivo local se instalar | 🌐 / ✅ |

**A imagem do print nunca sai do navegador** — só os arquivos do modelo (públicos)
podem ser baixados. O core via CDN fica no cache HTTP do navegador após o
primeiro uso.

### 100% offline (recomendado)

```bash
bash tools/instalar-offline.sh      # Linux/Mac
# ou
powershell -ExecutionPolicy Bypass -File tools\instalar-offline.ps1   # Windows
```

Isso baixa o core para `vendor/` e grava `vendor/origem.json` com
`{"core": "local"}` — a extensão detecta e passa a usar só arquivos locais.
Se o OCR não iniciar com o core via CDN (CSP de rede), rode o script acima.

## Testes

```bash
node tests/test-parser.js           # 8 testes do parser (Node puro)
python3 tools/gerar-prints-teste.py # gera prints sintéticos p/ teste de OCR
python3 tools/gerar-icones.py       # gera icons/ (opcional)
```

O teste de OCR completo (`tools/teste-ocr.js`) precisa do `tesseract.js` instalado
via npm no ambiente de teste; veja o cabeçalho do arquivo.

## Licenças

- Tesseract.js e tesseract.js-core: **Apache-2.0** (arquivos `vendor/LICENSE-*`).
- Modelo `por.traineddata` (tessdata_fast): Apache-2.0 (Tesseract/Google).
- Código da extensão: seu.
