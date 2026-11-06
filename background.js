/*
 * background.js — service worker (MV3).
 * - Menu de contexto em imagens: "Extrair produtos (OCR)".
 * - Ícone do botão desenhado em runtime (OffscreenCanvas), já que o repo não
 *   carrega PNGs binários; se quiser ícones de verdade, rode tools/gerar-icones.py
 *   e adicione "icons" de volta ao manifest.json.
 */

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'extrair-produtos',
    title: 'Extrair produtos deste print (OCR)',
    contexts: ['image'],
  });
  definirIcone();
});

chrome.runtime.onStartup.addListener(definirIcone);

async function definirIcone() {
  try {
    const imageData = {};
    for (const n of [16, 32, 48]) imageData[n] = desenharIcone(n);
    await chrome.action.setIcon({ imageData });
  } catch (e) {
    console.warn('[Extrator de Produtos] não deu para definir o ícone:', e);
  }
}

function desenharIcone(n) {
  const canvas = new OffscreenCanvas(n, n);
  const ctx = canvas.getContext('2d');

  // fundo escuro arredondado
  const r = n * 0.22;
  ctx.beginPath();
  ctx.roundRect(0, 0, n, n, r);
  ctx.fillStyle = '#1a1b21';
  ctx.fill();

  // "folha" com linhas de texto (o print)
  const m = n * 0.22;
  ctx.fillStyle = '#e8e8ea';
  ctx.beginPath();
  ctx.roundRect(m, m, n - 2 * m, n - 2 * m, n * 0.08);
  ctx.fill();

  ctx.fillStyle = '#2563eb';
  ctx.fillRect(m + n * 0.12, m + n * 0.12, (n - 2 * m) * 0.45, n * 0.09);

  ctx.fillStyle = '#3c3f49';
  const y0 = m + n * 0.32;
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(m + n * 0.12, y0 + i * n * 0.15, (n - 2 * m) * (i === 1 ? 0.55 : 0.76), n * 0.07);
  }

  // marcador verde (extraído)
  ctx.beginPath();
  ctx.arc(n - n * 0.2, n - n * 0.2, n * 0.16, 0, Math.PI * 2);
  ctx.fillStyle = '#6ee7b7';
  ctx.fill();

  return ctx.getImageData(0, 0, n, n);
}

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== 'extrair-produtos') return;
  try {
    const resp = await fetch(info.srcUrl);
    if (!resp.ok) throw new Error('Não foi possível baixar a imagem (HTTP ' + resp.status + ')');
    const blob = await resp.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
    await chrome.storage.local.set({ imagemPendente: dataUrl });
    await chrome.tabs.create({ url: chrome.runtime.getURL('ui.html?via=menu') });
  } catch (e) {
    console.error('[Extrator de Produtos] erro no menu de contexto:', e);
  }
});
