// Harness Node: lê gray_*.bin e roda o motor OCR (ocr-comum.js v2.0.1) nele.
// Uso: node harness.js <dir_com_os_js> <arquivo.bin>
const fs = require('fs'), vm = require('vm');
global.self = global;
global.OCR_TESTES = {};
vm.runInThisContext(fs.readFileSync(process.argv[2] + '/rede-ocr.js', 'utf8'), { filename: 'rede-ocr.js' });
vm.runInThisContext(fs.readFileSync(process.argv[2] + '/ocr-comum.js', 'utf8'), { filename: 'ocr-comum.js' });
const buf = fs.readFileSync(process.argv[3]);
const w = buf.readUInt32LE(0), h = buf.readUInt32LE(4);
const px = new Float32Array(buf.buffer, buf.byteOffset + 8, w * h);
const t0 = Date.now();
const { linhas, confs } = global.OCRComum._reconhecerGray(Array.from(px), w, h);
console.log(JSON.stringify({ w, h, ms: Date.now() - t0, linhas, confs }));