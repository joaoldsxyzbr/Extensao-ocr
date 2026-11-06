/* popup.js — extrator rápido no popup: cola o print, OCR roda e copia a linha. */

const $ = (id) => document.getElementById(id);
const zona = $('zona'), inputArquivos = $('arquivos');
const elStatus = $('status'), elContagem = $('contagem'), elResultados = $('resultados');
const elMiniaturas = $('miniaturas');

let itens = [];            // { codigo, descricao, marcado }
let fila = [];
let processando = false;

OCRComum.setLogger((texto) => status(texto));

function status(texto, ok = false) {
  elStatus.classList.remove('oculto');
  elStatus.classList.toggle('ok', ok);
  elStatus.textContent = texto;
}

function toastNoStatus(msg) { status(msg, true); }

/* ---------- lista salva ---------- */
async function obterSalvos() {
  const { itens: salvos = [] } = await chrome.storage.local.get('itens');
  return salvos;
}

async function atualizarContagem() {
  const salvos = await obterSalvos();
  elContagem.textContent = salvos.length
    ? `📂 ${salvos.length} na lista salva (copie pelo botão "Abrir extrator completo")`
    : '';
}

/* ---------- processamento ---------- */
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
      const { itens: novos, confianca } = await OCRComum.extrairDeArquivo(arquivo);
      for (const it of novos) itens.push({ ...it, marcado: true });
      renderizar();
      if (!novos.length) status('Nenhum produto reconhecido — use o extrator completo pra ver o texto bruto.', false);
      else toastNoStatus(`✅ ${novos.length} item(ns) lidos (confiança ${confianca}).`);
    } catch (e) {
      status('Falha no OCR: ' + (e.message || e) + '. Se persistir, rode tools/instalar-offline.', false);
    }
  }
  processando = false;
}

/* ---------- renderização ---------- */
function renderizar() {
  elResultados.innerHTML = '';
  if (!itens.length) {
    elResultados.innerHTML = '<p class="vazio">Cole um print acima 👆</p>';
    return;
  }
  itens.forEach((it, idx) => {
    const div = document.createElement('div');
    div.className = 'item';

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = it.marcado;
    chk.onchange = () => { itens[idx].marcado = chk.checked; };

    const inpCod = document.createElement('input');
    inpCod.className = 'codigo';
    inpCod.value = it.codigo;
    inpCod.spellcheck = false;
    inpCod.oninput = () => { itens[idx].codigo = inpCod.value; };

    const inpDesc = document.createElement('input');
    inpDesc.className = 'descricao';
    inpDesc.value = it.descricao;
    inpDesc.spellcheck = false;
    inpDesc.oninput = () => { itens[idx].descricao = inpDesc.value; };

    const btnRemover = document.createElement('button');
    btnRemover.textContent = '✕';
    btnRemover.title = 'Remover';
    btnRemover.onclick = () => { itens.splice(idx, 1); renderizar(); };

    div.append(chk, inpCod, inpDesc, btnRemover);
    elResultados.appendChild(div);
  });
}

/* ---------- ações ---------- */
function linhasMarcadas() {
  return itens.filter(i => i.marcado).map(i => `${i.codigo} ${i.descricao}`);
}

$('copiar').onclick = async () => {
  const linhas = linhasMarcadas();
  if (!linhas.length) return status('Nenhum item marcado.', false);
  await navigator.clipboard.writeText(linhas.join('\n'));
  status(`✅ ${linhas.length} linha(s) copiada(s)!`, true);
};

$('salvar').onclick = async () => {
  const linhas = itens.filter(i => i.marcado).map(i => ({ linha: `${i.codigo} ${i.descricao}` }));
  if (!linhas.length) return status('Nenhum item marcado.', false);
  const salvos = await obterSalvos();
  const vistos = new Set(salvos.map(i => i.linha));
  let novos = 0;
  for (const l of linhas) if (!vistos.has(l.linha)) { salvos.push(l); vistos.add(l.linha); novos++; }
  await chrome.storage.local.set({ itens: salvos });
  atualizarContagem();
  status(novos ? `✅ ${novos} salvo(s) na lista.` : 'Todos já estavam salvos.', true);
};

$('limpar').onclick = () => {
  itens = [];
  renderizar();
  elMiniaturas.innerHTML = '';
  elStatus.classList.add('oculto');
};

$('abrir').onclick = async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL('ui.html') });
  window.close();
};

/* ---------- entrada ---------- */
zona.addEventListener('click', () => inputArquivos.click());
inputArquivos.addEventListener('change', () => { enfileirar([...inputArquivos.files]); inputArquivos.value = ''; });

// Ctrl+V com o popup aberto
document.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.items || [])]
    .filter(i => i.kind === 'file')
    .map(i => i.getAsFile())
    .filter(Boolean);
  if (files.length) enfileirar(files);
});

// Botão "Colar": lê a imagem direto da área de transferência (print sem salvar em pasta)
$('colar').onclick = async () => {
  try {
    const itensArea = await navigator.clipboard.read();
    for (const item of itensArea) {
      const tipo = item.types.find(t => t.startsWith('image/'));
      if (tipo) {
        const blob = await item.getType(tipo);
        const arquivo = new File([blob], 'print.png', { type: tipo });
        await enfileirar([arquivo]);
        return;
      }
    }
    status('A área de transferência não tem imagem. Tire o print (Win+Shift+S) e clique aqui de novo.', false);
  } catch (e) {
    status('Não consegui ler a área de transferência — use Ctrl+V aqui ou escolha o arquivo.', false);
  }
};

renderizar();
atualizarContagem();