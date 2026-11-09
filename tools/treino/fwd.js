// fwd.js — forward do MLP a partir de rede-ocr.js (formato do projeto).
// Uso: node fwd.js <rede-ocr.js> <features.txt>
// features.txt: uma linha por amostra, 323 valores separados por vírgula.
const fs = require('fs'), vm = require('vm');
global.self = global;
vm.runInThisContext(fs.readFileSync(process.argv[2], 'utf8'), { filename: 'rede-ocr.js' });
const R = global.REDE_OCR;
const CH = R.chars, NH = R.b1.length, NIN = R.W1.length / NH, NC = R.b2.length;
const W1 = Float64Array.from(R.W1), B1 = Float64Array.from(R.b1);
const W2 = Float64Array.from(R.W2), B2 = Float64Array.from(R.b2);
const lines = fs.readFileSync(process.argv[3], 'utf8').split('\n').filter(l => l.trim());
const saida = [];
for (const l of lines) {
  const ft = l.split(',').map(Number);
  const h = new Float64Array(NH);
  for (let j = 0; j < NH; j++) {
    let s = B1[j];
    for (let i = 0; i < NIN; i++) s += ft[i] * W1[i * NH + j];
    h[j] = s > 0 ? s : 0;
  }
  let best = -Infinity, bk = 0;
  const o = new Float64Array(NC);
  for (let k = 0; k < NC; k++) {
    let s = B2[k];
    for (let j = 0; j < NH; j++) s += h[j] * W2[j * NC + k];
    o[k] = s; if (s > best) { best = s; bk = k; }
  }
  let soma = 0;
  for (let k = 0; k < NC; k++) { o[k] = Math.exp(o[k] - best); soma += o[k]; }
  saida.push({ ch: CH[bk], conf: +(o[bk] / soma).toFixed(4) });
}
console.log(JSON.stringify(saida));