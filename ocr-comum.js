/*
 * ocr-comum.js — Núcleo de OCR compartilhado entre o popup e a página do extrator.
 * Não tem estado de UI: quem usa define o logger (progresso) e recebe itens prontos.
 * Depende de: vendor/tesseract.min.js (Tesseract) e parser.js (ParserProdutos).
 */

const OCRComum = (function () {
  'use strict';

  const BASE = chrome.runtime.getURL('');
  const CDN_CORE = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@v7.0.0';
  const CDN_LANG = 'https://tessdata.projectnaptha.com/4.0.0_fast';

  const STATUS_PT = {
    'loading tesseract core': 'Carregando engine OCR…',
    'initializing tesseract': 'Inicializando…',
    'loading language traineddata': 'Carregando modelo do idioma…',
    'loading language traineddata (from cache)': 'Carregando modelo do idioma…',
    'initializing api': 'Preparando reconhecimento…',
    'recognizing text': 'Lendo o print…',
  };

  let loggerPadrao = () => {};
  let workerPronto = null;

  function setLogger(cb) { loggerPadrao = cb || (() => {}); }

  /* Preferências em vendor/origem.json:
     core: "auto" (detecta arquivo local) | "local" | "cdn"
     lang:  "auto" (usa o b64 embutido no repo) | "cdn"  */
  async function resolverCaminhos() {
    let pref = {};
    try {
      const r = await fetch(BASE + 'vendor/origem.json');
      if (r.ok) pref = await r.json();
    } catch (e) { /* sem origem.json → auto */ }

    let core = pref.core === 'local' ? 'local' : (pref.core === 'cdn' ? 'cdn' : 'auto');
    let coreAuto = core === 'auto';
    if (coreAuto) {
      const existe = await fetch(BASE + 'vendor/tesseract-core-simd-lstm.wasm.js', { method: 'HEAD' })
        .then((r) => r.ok).catch(() => false);
      core = existe ? 'local' : 'cdn';
    }

    const lang = pref.lang === 'cdn' ? 'cdn' : 'local-b64';
    return { core, coreAuto, lang };
  }

  /* IndexedDB no formato do idb-keyval usado pelo tesseract.js v7:
     banco 'keyval-store', store 'keyval' (ver vendor/worker.min.js, módulo 613).
     É o cache oficial do .traineddata — se o nome do banco não bater, o worker
     nunca acha o modelo e o OCR fica dependendo da rede. */
  const IDB_BANCO = 'keyval-store';
  const IDB_STORE = 'keyval';

  function idbGet(chave) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_BANCO, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(IDB_STORE, 'readonly');
        const get = tx.objectStore(IDB_STORE).get(chave);
        get.onsuccess = () => { db.close(); resolve(get.result); };
        get.onerror = () => { db.close(); reject(get.error); };
      };
      req.onerror = () => reject(req.error);
    });
  }

  function idbSet(chave, valor) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_BANCO, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(valor, chave);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
      req.onerror = () => reject(req.error);
    });
  }

  /* Descompacta gzip usando a API do navegador (DecompressionStream); se não
     existir, cai num decodificador mínimo de gzip (deflate via
     DecompressionStream('deflate-raw') ou erro claro). */
  async function descompactarGzip(gz) {
    if (typeof DecompressionStream === 'function') {
      const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    throw new Error('Este navegador não suporta DecompressionStream (necessário para o modelo local).');
  }

  /* 'local-b64': o modelo 'por' vem embutido como base64 (arquivo de texto no
     repo); decodifica uma vez e grava no cache IndexedDB do tesseract.
     Importante: o worker espera o .traineddata DESCOMPACTADO no cache (ele só
     descompacta o que baixa da rede). Gravar o .gz aqui faz o worker falhar
     no Init e cair na rede — por isso descompactamos antes de gravar. */
  async function garantirIdioma(o) {
    if (o.lang !== 'local-b64') return;
    const jaTem = await idbGet('./por.traineddata').catch(() => undefined);
    if (jaTem && jaTem.length) return;
    const r = await fetch(BASE + 'vendor/langs/por.traineddata.gz.b64');
    if (!r.ok) throw new Error('vendor/langs/por.traineddata.gz.b64 não encontrado (rode tools/instalar-offline)');
    const b64 = (await r.text()).trim();
    const bin = atob(b64.replace(/\s+/g, ''));
    const gz = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) gz[i] = bin.charCodeAt(i);
    const bytes = await descompactarGzip(gz);
    await idbSet('./por.traineddata', bytes);
  }

  async function obterWorker() {
    if (!workerPronto) {
      workerPronto = (async () => {
        const o = await resolverCaminhos();
        /* O Chrome (MV3) bloqueia importScripts de CDN no worker da extensão
           (CSP script-src 'self'). Sem o core na pasta vendor/, o OCR não roda —
           avisa com instrução prática em vez de estourar erro críptico de rede. */
        if (o.coreAuto && o.core === 'cdn') {
          throw new Error(
            'core do OCR não está na pasta vendor/. O Chrome não permite carregar por CDN. ' +
            'Rode tools/instalar-offline.ps1 (Windows) ou bash tools/instalar-offline.sh ' +
            'e atualize a extensão em chrome://extensions.'
          );
        }
        await garantirIdioma(o);
        const opcoes = {
          workerPath: BASE + 'vendor/worker.min.js',
          workerBlobURL: false,
          gzip: true,
          logger: (m) => {
            const texto = STATUS_PT[m.status] || m.status;
            const pct = m.status === 'recognizing text' ? ` ${Math.round((m.progress || 0) * 100)}%` : '';
            loggerPadrao(texto + pct);
          },
        };
        if (o.core === 'local') opcoes.corePath = BASE + 'vendor/tesseract-core-simd-lstm.wasm.js';
        else opcoes.corePath = CDN_CORE;

        /* Idioma:
           - local-b64: já está no IndexedDB (garantirIdioma); langPath CDN é só
             rede de segurança caso o cache seja apagado.
           - cdn: baixa do CDN (a imagem continua local). */
        opcoes.langPath = CDN_LANG;
        if (o.lang === 'cdn') opcoes.cacheMethod = 'refresh';

        const worker = await Tesseract.createWorker('por', Tesseract.OEM.LSTM_ONLY, opcoes);
        /* Print de tela é um bloco único de texto (linhas de uma tabela/grade).
           O PSM padrão do Tesseract (3, automático) fragmenta a página em blocos
           e perde linhas inteiras (homologação 09/11: 3 de 10 lidas). PSM 6 =
           bloco uniforme, lê linha a linha; preserve_interword_spaces mantém
           código e descrição na mesma linha. */
        await worker.setParameters({
          tessedit_pageseg_mode: '6',
          preserve_interword_spaces: '1',
        });
        return worker;
      })().catch((e) => { workerPronto = null; throw e; });
    }
    return workerPronto;
  }

  /* Pré-processamento: upscale (menor lado ~1100px, máx 3x), escala de cinza
     e contraste (percentis 2–98). Devolve dataURL pronto pro recognize. */
  async function prepararImagem(arquivo) {
    const bitmap = await createImageBitmap(arquivo);
    const menor = Math.min(bitmap.width, bitmap.height);
    const fator = Math.min(3, Math.max(1, 1100 / menor));
    const w = Math.round(bitmap.width * fator), h = Math.round(bitmap.height * fator);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const n = w * h;
    const cinza = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const j = i * 4;
      cinza[i] = (d[j] * 0.299 + d[j + 1] * 0.587 + d[j + 2] * 0.114) | 0;
    }
    const hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) hist[cinza[i]]++;
    let acum = 0, pMin = 0, pMax = 255;
    for (let v = 0; v < 256; v++) { acum += hist[v]; if (acum >= n * 0.02) { pMin = v; break; } }
    acum = 0;
    for (let v = 255; v >= 0; v--) { acum += hist[v]; if (acum >= n * 0.02) { pMax = v; break; } }
    const span = Math.max(1, pMax - pMin);
    for (let i = 0; i < n; i++) {
      const g = Math.max(0, Math.min(255, ((cinza[i] - pMin) * 255 / span) | 0));
      const j = i * 4;
      d[j] = d[j + 1] = d[j + 2] = g;
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
  }

  /* extrairDeArquivo(arquivo) → { itens, texto, confianca }
     itens = [{ codigo, descricao, linha }] no padrão do João. */
  async function extrairDeArquivo(arquivo) {
    const worker = await obterWorker();
    const dataUrl = await prepararImagem(arquivo);
    const { data } = await worker.recognize(dataUrl);
    const itens = ParserProdutos.extrairProdutos(data.text);
    return { itens, texto: data.text, confianca: data.confidence };
  }

  return { setLogger, extrairDeArquivo };
})();