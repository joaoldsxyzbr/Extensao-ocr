/* ui.js — extrator: recebe prints, roda OCR local e monta os itens no padrão.
   O motor OCR fica em ocr-comum.js (compartilhado com o popup). */

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

/* Progresso do OCR (worker) vai pro status da página. */
OCRComum.setLogger(status);

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
  while (fila.length) {
    const arquivo = fila.shift();
    try {
      const { itens, texto, confianca } = await OCRComum.extrairDeArquivo(arquivo);
      for (const it of itens) itensAtuais.push({ ...it, marcado: true });
      renderizarResultados();
      elBruto.classList.remove('oculto');
      elTextoBruto.value += (elTextoBruto.value ? '\n\n' : '') +
        `--- ${arquivo.name || 'print'} (confiança ${confianca}) ---\n` + texto;
      if (!itens.length) toast('Nenhum produto reconhecido nesse print — confira o texto bruto.', false);
    } catch (e) {
      toast('Falha no OCR (' + (e.message || e) + '). Verifique se o print mostra a tabela nítida.', false);
      fila.length = 0;
      break;
    }
  }
  processando = false;
  limparStatus();
  if (itensAtuais.length) toast('Pronto! Itens extraídos no padrão. ✅');
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