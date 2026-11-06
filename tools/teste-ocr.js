/*
 * tools/teste-ocr.js — validação do pipeline completo nos prints reais.
 * Roda com: NODE_PATH=/tmp/nodeenv/node_modules node tools/teste-ocr.js
 *
 * Uso: node tools/teste-ocr.js [arquivo1.png arquivo2.png ...]
 * Sem argumentos, testa os prints padrão em /home/user/uploads/.
 */
const fs = require('fs');
const path = require('path');
const { extrairProdutos } = require('../parser.js');

async function main() {
  const args = process.argv.slice(2);
  const arquivos = args.length ? args : [
    '/home/user/uploads/image.png',
    '/home/user/uploads/image-2.png',
  ].filter(f => fs.existsSync(f));

  const { createWorker, OEM } = require('tesseract.js');

  console.log('Criando worker (por, LSTM)...');
  // Nota: no tesseract.js v7, `initialize` trata langs-objeto incorretamente
  // (usa l.data como nome do idioma). Usamos langPath apontando para a pasta
  // local com o .gz — caminho suportado também no browser com chrome-extension://
  const worker = await createWorker('por', OEM.LSTM_ONLY, {
    langPath: path.join(__dirname, '..', 'vendor', 'langs'),
    gzip: true,
    cacheMethod: 'none',
  });

  let falhas = 0;
  for (const arq of arquivos) {
    const { data } = await worker.recognize(arq);
    const itens = extrairProdutos(data.text);
    console.log('\n=== ' + path.basename(arq) + ' (confiança ' + (data.confidence ?? '?') + ') ===');
    console.log('--- texto OCR bruto ---');
    console.log(data.text.trim());
    console.log('--- extraído no padrão ---');
    if (!itens.length) { falhas++; console.log('(nenhum produto extraído!)'); }
    for (const it of itens) console.log(it.linha);
  }

  await worker.terminate();
  process.exit(falhas ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
