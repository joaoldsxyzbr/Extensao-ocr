/* ui.js — extrator: recebe prints, roda OCR local e monta os itens no padrão. */

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

let workerPronto = null;
let itensAtuais = [];
let itensSalvos = [];

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const zona = $('zona'), inputArquivos = $('arquivos');
const elStatus = $('status'), elStatusTexto = $('status-texto');
const elMiniaturas = $('miniaturas');
const elResultados = $('resultados'), elNItens = $('n-itens');
const elListaSalva = $('lista-salva'), elNSalvos = $('n-salvos');
const elBruto = $('bruto'), elTextoBruto = $('texto-bruto');

function toast(msg, ok = true) {
  const t = $('toast');
  t.textContent = msg;
  t.style.background = ok ? '#064e3b' : '#7f1d1d';
  t.style.color = ok ? '#6ee7b7' : '#fca5a5';
  t.classList.remove('oculto');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('oculto'), 2200);
}

function status(texto, ok = false) {
  elStatus.classList.remove('oculto');
  elStatus.classList.toggle('ok', ok);
  elStatusTexto.textContent = texto;
}

function limparStatus() { elStatus.classList.add('oculto'); }

/* ---------- Worker OCR ---------- */
async function origemVendor() {
  try {
    const r = await fetch(BASE + 'vendor/origem.json');
    if (r.ok) return await r.json();
  } catch (e) { /* sem origem.json → tenta local */ }
  return { core: 'local', lang: 'local-b64' };
}

/* IndexedDB no formato do idb-keyval (db 'keyval', store 'keyval') —
   é o cache oficial do tesseract.js para o .traineddata. */
function idbGet(chave) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('keyval', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('keyval');
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('keyval', 'readonly');
      const get = tx.objectStore('keyval').get(chave);
      get.onsuccess = () => { db.close(); resolve(get.result); };
      get.onerror = () => { db.close(); reject(get.error); };
    };
    req.onerror = () => reject(req.error);
  });
}

function idbSet(chave, valor) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('keyval', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('keyval');
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('keyval', 'readwrite');
      tx.objectStore('keyval').put(valor, chave);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
    req.onerror = () => reject(req.error);
  });
}

/* 'local-b64': o modelo 'por' vem embutido como base64 (arquivo de texto no
   repo); decodifica uma vez e grava no cache IndexedDB do tesseract. */
async function garantirIdioma(o) {
  if (o.lang !== 'local-b64') return;
  const jaTem = await idbGet('./por.traineddata').catch(() => undefined);
  if (jaTem && jaTem.length) return;
  const r = await fetch(BASE + 'vendor/langs/por.traineddata.gz.b64');
  if (!r.ok) throw new Error('vendor/langs/por.traineddata.gz.b64 não encontrado (rode tools/instalar-offline)');
  const b64 = (await r.text()).trim();
  const bin = atob(b64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  await idbSet('./por.traineddata', bytes);
}

async function obterWorker() {
  if (!workerPronto) {
    workerPronto = (async () => {
      const o = await origemVendor();
      await garantirIdioma(o);
      const opcoes = {
        workerPath: BASE + 'vendor/worker.min.js',
        workerBlobURL: false,
        gzip: true,
        logger: (m) => {
          const texto = STATUS_PT[m.status] || m.status;
          const pct = m.status === 'recognizing text' ? ` ${Math.round((m.progress || 0) * 100)}%` : '';
          status(texto + pct);
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

      return Tesseract.createWorker('por', Tesseract.OEM.LSTM_ONLY, opcoes);
    })().catch((e) => { workerPronto = null; throw e; });
  }
  return workerPronto;
}

/* ---------- Pré-processamento (escala de cinza + contraste + upscale) ---------- */
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
  // Contraste: estica para os percentis 2%–98%.
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

/* ---------- Fila de processamento ---------- */
const fila = [];
let processando = false;

async function enfileirar(arquivos) {
  for (const f of arquivos) {
    if (!f.type.startsWith('image/')) continue;
    fila.push(f);
    const img = document.createElement('img');
    img.src = URL.createObjectURL(f);
    img.title = f.name || 'print';
    elMiniaturas.appendChild(img);
  }
  if (fila.length) await processarFila();
}

async function processarFila() {
  if (processando) return;
  processando = true;
  let worker;
  try { worker = await obterWorker(); }
  catch (e) {
    toast('Falha ao iniciar o OCR: ' + e.message, false);
    fila.length = 0;
    processando = false;
    limparStatus();
    return;
  }
  while (fila.length) {
    const arquivo = fila.shift();
    try {
      const dataUrl = await prepararImagem(arquivo);
      const { data } = await worker.recognize(dataUrl);
      const itens = ParserProdutos.extrairProdutos(data.text);
      for (const it of itens) itensAtuais.push({ ...it, marcado: true });
      renderizarResultados();
      elBruto.classList.remove('oculto');
      elTextoBruto.value += (elTextoBruto.value ? '\n\n' : '') +
        `--- ${arquivo.name || 'print'} (confiança ${data.confidence}) ---\n` + data.text;
      if (!itens.length) toast('Nenhum produto reconhecido nesse print — confira o texto bruto.', false);
    } catch (e) {
      toast('Erro ao processar a imagem: ' + (e.message || e), false);
    }
  }
  processando = false;
  limparStatus();
  toast('Pronto! Itens extraídos no padrão. ✅');
}

/* ---------- Renderização ---------- */
function renderizarResultados() {
  elNItens.textContent = itensAtuais.length ? `(${itensAtuais.length})` : '';
  elResultados.innerHTML = '';
  if (!itensAtuais.length) {
    elResultados.innerHTML = '<p class="vazio">Nada ainda — mande um print. 📋</p>';
    return;
  }
  itensAtuais.forEach((it, idx) => {
    const div = document.createElement('div');
    div.className = 'item';

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = it.marcado;
    chk.onchange = () => { itensAtuais[idx].marcado = chk.checked; };

    const inpCod = document.createElement('input');
    inpCod.className = 'codigo';
    inpCod.value = it.codigo;
    inpCod.spellcheck = false;
    inpCod.oninput = () => { itensAtuais[idx].codigo = inpCod.value; };

    const inpDesc = document.createElement('input');
    inpDesc.className = 'descricao';
    inpDesc.value = it.descricao;
    inpDesc.spellcheck = false;
    inpDesc.oninput = () => { itensAtuais[idx].descricao = inpDesc.value; };

    const btnCopiar = document.createElement('button');
    btnCopiar.className = 'mini';
    btnCopiar.textContent = '📋';
    btnCopiar.title = 'Copiar linha';
    btnCopiar.onclick = async () => {
      await navigator.clipboard.writeText(inpCod.value + ' ' + inpDesc.value);
      toast('Linha copiada!');
    };

    const btnRemover = document.createElement('button');
    btnRemover.className = 'mini';
    btnRemover.textContent = '✕';
    btnRemover.title = 'Remover item';
    btnRemover.onclick = () => { itensAtuais.splice(idx, 1); renderizarResultados(); };

    div.append(chk, inpCod, inpDesc, btnCopiar, btnRemover);
    elResultados.appendChild(div);
  });
}

function renderizarSalvos() {
  elNSalvos.textContent = itensSalvos.length ? `(${itensSalvos.length})` : '';
  elListaSalva.innerHTML = '';
  if (!itensSalvos.length) {
    elListaSalva.innerHTML = '<p class="vazio">A lista salva fica entre sessões — use "Salvar na lista" nos itens extraídos.</p>';
    return;
  }
  itensSalvos.forEach((it, idx) => {
    const div = document.createElement('div');
    div.className = 'linha-salva';
    const span = document.createElement('span');
    span.textContent = it.linha;
    const btn = document.createElement('button');
    btn.className = 'mini';
    btn.textContent = '✕';
    btn.title = 'Remover da lista salva';
    btn.onclick = async () => {
      itensSalvos.splice(idx, 1);
      await chrome.storage.local.set({ itens: itensSalvos });
      renderizarSalvos();
    };
    div.append(span, btn);
    elListaSalva.appendChild(div);
  });
}

/* ---------- Ações ---------- */
function linhasAtuais() {
  return itensAtuais.filter(i => i.marcado).map(i => `${i.codigo} ${i.descricao}`);
}

$('copiar-atual').onclick = async () => {
  const linhas = linhasAtuais();
  if (!linhas.length) return toast('Nenhum item marcado.', false);
  await navigator.clipboard.writeText(linhas.join('\n'));
  toast('Lista copiada! (' + linhas.length + ' itens)');
};

$('salvar').onclick = async () => {
  const linhas = itensAtuais.filter(i => i.marcado)
    .map(i => ({ linha: `${i.codigo} ${i.descricao}` }));
  if (!linhas.length) return toast('Nenhum item marcado.', false);
  const vistos = new Set(itensSalvos.map(i => i.linha));
  let novos = 0;
  for (const l of linhas) if (!vistos.has(l.linha)) { itensSalvos.push(l); vistos.add(l.linha); novos++; }
  await chrome.storage.local.set({ itens: itensSalvos });
  renderizarSalvos();
  toast(novos ? `${novos} novos itens salvos.` : 'Todos já estavam na lista.');
};

$('limpar-atual').onclick = () => {
  itensAtuais = [];
  renderizarResultados();
  elBruto.classList.add('oculto');
  elTextoBruto.value = '';
};

$('copiar-salvos').onclick = async () => {
  if (!itensSalvos.length) return toast('Lista salva vazia.', false);
  await navigator.clipboard.writeText(itensSalvos.map(i => i.linha).join('\n'));
  toast('Lista salva copiada! (' + itensSalvos.length + ' itens)');
};

$('limpar-salvos').onclick = async () => {
  if (!confirm('Limpar a lista salva?')) return;
  itensSalvos = [];
  await chrome.storage.local.set({ itens: itensSalvos });
  renderizarSalvos();
};

/* ---------- Entrada de imagens ---------- */
zona.addEventListener('click', () => inputArquivos.click());
inputArquivos.addEventListener('change', () => { enfileirar([...inputArquivos.files]); inputArquivos.value = ''; });

zona.addEventListener('dragover', (e) => { e.preventDefault(); zona.classList.add('arrastando'); });
zona.addEventListener('dragleave', () => zona.classList.remove('arrastando'));
zona.addEventListener('drop', (e) => {
  e.preventDefault();
  zona.classList.remove('arrastando');
  enfileirar([...e.dataTransfer.files]);
});

document.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.items || [])]
    .filter(i => i.kind === 'file')
    .map(i => i.getAsFile())
    .filter(Boolean);
  if (files.length) enfileirar(files);
});

/* ---------- Início ---------- */
async function iniciar() {
  const { itens = [] } = await chrome.storage.local.get('itens');
  itensSalvos = itens;
  renderizarSalvos();

  // Imagem vinda do menu de contexto (botão direito em uma imagem).
  const { imagemPendente } = await chrome.storage.local.get('imagemPendente');
  if (imagemPendente) {
    await chrome.storage.local.remove('imagemPendente');
    try {
      const blob = await (await fetch(imagemPendente)).blob();
      const arquivo = new File([blob], 'print-menu-contexto.png', { type: blob.type });
      await enfileirar([arquivo]);
    } catch (e) {
      toast('Não foi possível carregar a imagem do menu de contexto.', false);
    }
  }
}

iniciar();
