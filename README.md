# Extrator de Produtos (OCR)

Extensão Chrome/Edge (Manifest V3) que lê **prints de tela** e devolve o texto no padrão:

```
94940 IOGURTE BATAVO PENSE 1150G ZERO MORANGO UN
104527 BEBIDA LACTEA PARMALAT FIT FLEX CHOCOLATE 250ML UN
96551 DIANTEIRO BOV RESF C/ OSSO KG
```

O OCR (rede neural LSTM do Tesseract) roda **100% no navegador** — a imagem do print
nunca sai da sua máquina. O modelo do idioma e o core (engine WASM) já vêm embutidos
no repo: todo clone funciona offline, sem passo adicional.

## Instalar

1. Baixe/clone este repositório.
2. Abra `chrome://extensions` (ou `edge://extensions`) e ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e escolha a pasta do projeto.
4. Pronto — o OCR já funciona offline. Não há passo adicional.

> O core do OCR (`vendor/tesseract-core-simd-lstm.wasm.js`, ~4 MB) veio versionado
> no repo, baixado pelo CI (`.github/workflows/baixar-core.yml`). Ele não é buscado
> por CDN porque o Chrome (MV3) bloqueia carregar código externo na extensão.

### Atualizar o core do OCR (opcional)

O instalador continua disponível para forçar origem local ou renovar o core:

```powershell
powershell -ExecutionPolicy Bypass -File tools\instalar-offline.ps1   # Windows
```

```bash
bash tools/instalar-offline.sh       # Linux/Mac
```

O script baixa o core (e o modelo do idioma, se faltar) para `vendor/`, grava
`vendor/origem.json` com `{"core": "local", "lang": "auto"}` e a extensão passa a usar só
arquivos locais. Para trocar a versão do Tesseract, edite a URL no workflow do CI
e rode-o na aba Actions.

## Usar

Caminho rápido (popup): capture o print (ele vai para a área de transferência),
clique no ícone da extensão e use **"📋 Colar print da área de transferência"**
ou **Ctrl+V** — o OCR roda ali mesmo no popup e os itens aparecem editáveis,
prontos para copiar.

Caminho completo (aba do extrator), para vários prints e texto bruto:

- **Cole um print** (Ctrl+V) na página do extrator;
- **Arraste** imagens para a área tracejada; ou
- **Clique com o botão direito** em qualquer imagem na web → **"Extrair produtos deste print (OCR)"**.

Os itens reconhecidos aparecem em linhas **editáveis** (código e descrição).
Com o print em mãos você pode corrigir eventual erro de OCR na hora.

- **Copiar lista** → copia os itens marcados, um por linha, no padrão acima;
- **Salvar na lista** → acumula itens entre sessões (`chrome.storage.local`),
  visível no popup e na aba do extrator.

> Dica: tire o print **antes** de abrir o popup — capturar a tela tira o foco e
> fecha o popup. Com o print já na área de transferência, o fluxo é: ícone → colar → copiar.

## Como o texto vira produto

O `parser.js` aplica estas regras ao texto do OCR:

- código = número isolado de 4–8 dígitos (`250ML` não é código, é colado em letra);
- descrição = texto após o código, **sem acento**, maiúsculo, espaços simples;
- código sozinho na linha → a descrição é procurada nas linhas seguintes,
  pulando rótulos ("Descrição da inconsistência" etc.);
- rótulos de tela e quantidade solta no final da linha são descartados.

## Estrutura

```
manifest.json            MV3; permissões storage/activeTab/contextMenus/clipboard
background.js             menu de contexto em imagens + ícone desenhado em runtime
popup.html/.js            mini-extrator: cola o print e copia a linha no popup
ocr-comum.js              núcleo OCR compartilhado (worker, idioma, pré-processo)
ui.html/.css/.js          extrator completo: colar/arrastar, OCR, edição, listas
parser.js                 parser de produtos (puro, testável em Node)
vendor/                   Tesseract.js v7 + modelo 'por' (b64) + core (versionado no repo)
  origem.json             core/lang: auto (padrão do repo, detecta o core local) ou local (pós-instalador)
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
| Modelo do idioma `por` (b64) | embutido no repo → cache IndexedDB (`keyval-store`) | ✅ sempre |
| Core LSTM (wasm, ~4 MB) | `vendor/`, versionado no repo (baixado pelo CI) | ✅ sempre |

**A imagem do print nunca sai do navegador** — nenhum arquivo é baixado em
execução; engine, modelo e core já vêm no repositório.

> Detalhe do cache: o tesseract.js v7 guarda o `.traineddata` no IndexedDB
> **`keyval-store`** (store `keyval`), já **descompactado**. O `ocr-comum.js`
> descompacta o b64 e grava nesse mesmo banco — se o nome do banco ou o formato
> não baterem, o worker não acha o modelo e o OCR fica pendurado tentando a rede.

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