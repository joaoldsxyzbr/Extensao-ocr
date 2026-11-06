/* popup.js — painel rápido: contagem da lista salva e atalhos. */

const elContagem = document.getElementById('contagem');
const btnAbrir = document.getElementById('abrir');
const btnCopiar = document.getElementById('copiar');
const btnLimpar = document.getElementById('limpar');

async function obterItens() {
  const { itens = [] } = await chrome.storage.local.get('itens');
  return itens;
}

async function atualizar() {
  const itens = await obterItens();
  elContagem.textContent = itens.length
    ? itens.length + (itens.length === 1 ? ' produto na lista salva' : ' produtos na lista salva')
    : '';
  btnCopiar.style.display = itens.length ? 'block' : 'none';
  btnLimpar.style.display = itens.length ? 'block' : 'none';
}

btnAbrir.addEventListener('click', async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL('ui.html') });
  window.close();
});

btnCopiar.addEventListener('click', async () => {
  const itens = await obterItens();
  await navigator.clipboard.writeText(itens.map(i => i.linha).join('\n'));
  btnCopiar.textContent = '✓ Copiado!';
  setTimeout(() => { btnCopiar.textContent = 'Copiar lista salva'; }, 1200);
});

btnLimpar.addEventListener('click', async () => {
  if (!confirm('Limpar a lista salva?')) return;
  await chrome.storage.local.set({ itens: [] });
  await atualizar();
});

atualizar();
