/*
 * ocr-comum.js — Núcleo de OCR compartilhado entre o popup e a página do extrator.
 * Versão 2.0.0: motor próprio com rede neural (MLP), SEM dependências externas —
 * nada de Tesseract, WASM, CDN, worker ou instalador. A imagem nunca sai do
 * navegador: ela é lida de um <canvas> e classificada por pesos embutidos.
 *
 * Depende apenas de: rede-ocr.js (REDE_OCR, pesos treinados) e parser.js
 * (ParserProdutos, extração dos itens no padrão do João).
 *
 * Pipeline (espelha a referência Python validada em linetest.py):
 *   1. imagem → tinta: ink = clamp((1 - cinza - 0.15) / 0.7, 0, 1)
 *   2. limpa linhas de grade (linhas/colunas com cobertura > 60%)
 *   3. bandas de linha por projeção horizontal (mescla folgas <= 2 px)
 *   4. segmentos por projeção vertical (limiar 0.50); runs largos são
 *      divididos em "slots" de largura mediana, cortando nos vales
 *   5. espaçamento: limiar adaptativo pela maior quebra nos gaps
 *   6. features do glifo: recorte justo → 16x20 (zoom bilinear) + 3 medidas
 *      relativas à banda de linha
 *   7. TTA: 5 janelas (centro ±1, e recortes apertados) × (nítido + borrado)
 *      → média das probabilidades
 *   8. contexto: 1º token da linha só-dígitos; letra entre dígitos relida
 *      como dígito; dígito entre letras relido como letra; preferência por
 *      maiúscula (o ERP é caixa alta)
 */
(function (raiz) {
  'use strict';

  const REDE = raiz.REDE_OCR;
  if (!REDE) throw new Error('rede-ocr.js não carregado antes de ocr-comum.js');
  const CHARS = REDE.chars;
  const NCLS = CHARS.length;
  const NIN = 323;        // 16*20 + 3
  const NH = 160;         // neurônios ocultos
  const GH = 20, GW = 16; // canvas do glifo: 20 linhas x 16 colunas

  const W1 = Float64Array.from(REDE.W1, Number); // [i*NH + j]
  const B1 = Float64Array.from(REDE.b1, Number);
  const W2 = Float64Array.from(REDE.W2, Number); // [j*NCLS + k]
  const B2 = Float64Array.from(REDE.b2, Number);

  const hbuf = new Float64Array(NH);
  const obuf = new Float64Array(NCLS);
  const DIGITS = '0123456789';

  let loggerPadrao = () => {};
  function setLogger(cb) { loggerPadrao = cb || (() => {}); }

  /* ---------- pequenas ajudantes ---------- */

  // round() do Python (banker's rounding) — mantém paridade com a referência
  function pyRound(x) {
    const f = Math.floor(x), d = x - f;
    if (d < 0.5) return f;
    if (d > 0.5) return f + 1;
    return (f % 2 === 0) ? f : f + 1;
  }

  function median(arr) {
    if (!arr.length) return 0;
    const s = Array.from(arr).sort((a, b) => a - b);
    const m = s.length >> 1;
    return (s.length & 1) ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /* ---------- rede neural (forward + softmax) ---------- */

  function prever(ft) {
    // camada oculta: ReLU
    for (let j = 0; j < NH; j++) {
      let s = B1[j];
      const base = j;
      for (let i = 0; i < NIN; i++) s += ft[i] * W1[i * NH + base];
      hbuf[j] = s > 0 ? s : 0;
    }
    // saída: softmax
    let maxv = -Infinity;
    for (let k = 0; k < NCLS; k++) {
      let s = B2[k];
      for (let j = 0; j < NH; j++) s += hbuf[j] * W2[j * NCLS + k];
      obuf[k] = s;
      if (s > maxv) maxv = s;
    }
    let soma = 0;
    for (let k = 0; k < NCLS; k++) { obuf[k] = Math.exp(obuf[k] - maxv); soma += obuf[k]; }
    const p = new Float64Array(NCLS);
    for (let k = 0; k < NCLS; k++) p[k] = obuf[k] / soma;
    return p;
  }

  /* ---------- gaussian blur (sigma 0.5, modo reflect do SciPy) ---------- */

  const GAUSS = (function () {
    const r = 2, sig = 0.5, k = [];
    let soma = 0;
    for (let i = -r; i <= r; i++) { const v = Math.exp(-0.5 * (i / sig) * (i / sig)); k.push(v); soma += v; }
    return k.map((v) => v / soma);
  })();

  // filtro separável no grid GH x GW; reflect duplica a borda (idx = |i|)
  function blurGrid(ft, destino) {
    const tmp = new Float64Array(GH * GW);
    // horizontal
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        let s = 0;
        for (let d = -2; d <= 2; d++) {
          let xx = x + d;
          if (xx < 0) xx = -xx;
          if (xx >= GW) xx = 2 * GW - 1 - xx;
          s += GAUSS[d + 2] * ft[y * GW + xx];
        }
        tmp[y * GW + x] = s;
      }
    }
    // vertical
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        let s = 0;
        for (let d = -2; d <= 2; d++) {
          let yy = y + d;
          if (yy < 0) yy = -yy;
          if (yy >= GH) yy = 2 * GH - 1 - yy;
          s += GAUSS[d + 2] * tmp[yy * GW + x];
        }
        destino[y * GW + x] = s;
      }
    }
  }

  /* ---------- zoom bilinear (igual ndimage.zoom order=1) ---------- */

  // coordenadas de amostragem: linspace(0, m-1, n)
  function redimensionar(tight, gh, gw, nh, nw) {
    const out = new Float64Array(nh * nw);
    for (let y = 0; y < nh; y++) {
      const cy = (nh === 1) ? 0 : (y * (gh - 1)) / (nh - 1);
      const y0 = Math.min(gh - 1, Math.max(0, Math.floor(cy)));
      const y1 = Math.min(gh - 1, y0 + 1);
      const fy = cy - y0;
      for (let x = 0; x < nw; x++) {
        const cx = (nw === 1) ? 0 : (x * (gw - 1)) / (nw - 1);
        const x0 = Math.min(gw - 1, Math.max(0, Math.floor(cx)));
        const x1 = Math.min(gw - 1, x0 + 1);
        const fx = cx - x0;
        const v =
          tight[y0 * gw + x0] * (1 - fy) * (1 - fx) +
          tight[y0 * gw + x1] * (1 - fy) * fx +
          tight[y1 * gw + x0] * fy * (1 - fx) +
          tight[y1 * gw + x1] * fy * fx;
        out[y * nw + x] = Math.min(1, Math.max(0, v));
      }
    }
    return out;
  }

  /* ---------- features de um glifo ---------- */

  // strip: Float64Array (hband x SW, row-major). Devolve ft(323) ou null.
  function featuresDoGlifo(ink, w, y0, hband, x0, x1) {
    let gy0 = -1, gy1 = -1, gx0 = -1, gx1 = -1;
    for (let y = 0; y < hband; y++) {
      const base = (y0 + y) * w;
      for (let x = x0; x < x1; x++) {
        if (ink[base + x] > 0.08) {
          if (gy0 < 0) { gy0 = y; gx0 = x; gx1 = x + 1; }
          gy1 = y + 1;
          if (x < gx0) gx0 = x;
          if (x + 1 > gx1) gx1 = x + 1;
        }
      }
    }
    if (gy0 < 0) return null;
    const gh = gy1 - gy0, gw = gx1 - gx0;
    const tight = new Float64Array(gh * gw);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) tight[y * gw + x] = ink[(y0 + gy0 + y) * w + (gx0 + x)];
    }
    const f = Math.min((GW - 2) / gw, (GH - 2) / gh, 1.0);
    const nh = Math.max(1, pyRound(gh * f));
    const nw = Math.max(1, pyRound(gw * f));
    const z = redimensionar(tight, gh, gw, nh, nw);
    const ft = new Float64Array(NIN);
    const oy = (GH - nh) >> 1, ox = (GW - nw) >> 1;
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) ft[(oy + y) * GW + (ox + x)] = z[y * nw + x];
    }
    ft[GH * GW + 0] = gh / hband;
    ft[GH * GW + 1] = gy0 / hband;
    ft[GH * GW + 2] = gw / Math.max(gh, 1);
    return ft;
  }

  /* ---------- pipeline de linhas ---------- */

  // zera linhas/colunas de grade no ink contínuo (cobertura > 60% a ink>0.30)
  function limparGradeInk(ink, w, h) {
    const rows = [], cols = [];
    for (let y = 0; y < h; y++) {
      let n = 0;
      for (let x = 0; x < w; x++) if (ink[y * w + x] > 0.30) n++;
      if (n / w > 0.6) rows.push(y);
    }
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let y = 0; y < h; y++) if (ink[y * w + x] > 0.30) n++;
      if (n / h > 0.6) cols.push(x);
    }
    for (const y of rows) {
      const a = Math.max(0, y - 1), b = Math.min(h, y + 2);
      for (let yy = a; yy < b; yy++) for (let x = 0; x < w; x++) ink[yy * w + x] = 0;
    }
    for (const x of cols) {
      const a = Math.max(0, x - 1), b = Math.min(w, x + 2);
      for (let y = 0; y < h; y++) for (let xx = a; xx < b; xx++) ink[y * w + xx] = 0;
    }
  }

  // binário sem as linhas de grade (para achar bandas de linha)
  function binarioSemGrades(ink, w, h) {
    const bink = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) bink[i] = ink[i] > 0.30 ? 1 : 0;
    const rows = [], cols = [];
    for (let y = 0; y < h; y++) {
      let n = 0;
      for (let x = 0; x < w; x++) if (bink[y * w + x]) n++;
      if (n / w > 0.6) rows.push(y);
    }
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let y = 0; y < h; y++) if (bink[y * w + x]) n++;
      if (n / h > 0.6) cols.push(x);
    }
    for (const y of rows) {
      const a = Math.max(0, y - 1), b = Math.min(h, y + 2);
      for (let yy = a; yy < b; yy++) bink.fill(0, yy * w, yy * w + w);
    }
    for (const x of cols) {
      const a = Math.max(0, x - 1), b = Math.min(w, x + 2);
      for (let y = 0; y < h; y++) bink.fill(0, y * w + a, y * w + b);
    }
    return bink;
  }

  function bandasLinha(bink, w, h) {
    const ativos = new Uint8Array(h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (bink[y * w + x]) { ativos[y] = 1; break; }
      }
    }
    const brutas = [];
    let ini = -1;
    for (let y = 0; y < h; y++) {
      if (ativos[y] && ini < 0) ini = y;
      else if (!ativos[y] && ini >= 0) { brutas.push([ini, y]); ini = -1; }
    }
    if (ini >= 0) brutas.push([ini, h]);
    const mescladas = [];
    for (const b of brutas) {
      if (mescladas.length && b[0] - mescladas[mescladas.length - 1][1] <= 2) {
        mescladas[mescladas.length - 1][1] = b[1];
      } else mescladas.push(b);
    }
    return mescladas.filter((b) => b[1] - b[0] >= 5 && b[1] - b[0] <= 90);
  }

  // segmentos de uma banda: runs (limiar 0.50), divisão por slots e espaços
  function segmentos(ink, w, y0, y1) {
    const hband = y1 - y0;
    const colink = new Int32Array(w);
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let y = y0; y < y1; y++) if (ink[y * w + x] > 0.50) n++;
      colink[x] = n;
    }
    let runs = [], ini = -1;
    for (let x = 0; x < w; x++) {
      const v = colink[x] >= 1;
      if (v && ini < 0) ini = x;
      else if (!v && ini >= 0) { runs.push([ini, x]); ini = -1; }
    }
    if (ini >= 0) runs.push([ini, w]);

    // divide runs largos demais em vales de tinta (recursivo)
    if (runs.length) {
      const med = median(runs.map((r) => r[1] - r[0]));
      const limiteL = Math.max(5, pyRound(1.5 * med));
      const dividir = (r) => {
        const rw = r[1] - r[0];
        if (rw <= limiteL) return [r];
        const n = Math.max(2, pyRound(rw / Math.max(med, 1)));
        const slot = rw / n;
        const cortes = [];
        for (let k = 1; k < n; k++) {
          const c0 = Math.max(1, Math.floor(slot * k - slot * 0.35));
          const c1 = Math.max(c0 + 1, Math.min(rw - 1, Math.floor(slot * k + slot * 0.35) + 1));
          let melhor = c0;
          for (let i = c0 + 1; i < c1; i++) if (colink[r[0] + i] < colink[r[0] + melhor]) melhor = i;
          const corte = melhor;
          if (cortes.length && corte <= cortes[cortes.length - 1]) continue;
          cortes.push(corte);
        }
        if (!cortes.length) return [r];
        const partes = [];
        let inicio = 0;
        for (const c of cortes.concat([rw])) {
          if (c - inicio >= 2) partes.push([r[0] + inicio, r[0] + c]);
          inicio = c + 1;
        }
        if (inicio < rw) partes.push([r[0] + inicio, r[1]]);
        let out = [];
        for (const p of partes) out = out.concat(dividir(p));
        return out;
      };
      let saida = [];
      for (const r of runs) saida = saida.concat(dividir(r));
      runs = saida;
    }

    // espaços: limiar adaptativo pela maior quebra na distribuição de gaps
    let gaps = [];
    for (let j = 1; j < runs.length; j++) {
      const g = runs[j][0] - runs[j - 1][1];
      if (g <= hband) gaps.push(g);
    }
    let gapEsp = Math.max(3, pyRound(0.34 * hband));
    if (gaps.length) {
      const u = Array.from(new Set(gaps)).sort((a, b) => a - b);
      let melhorDiff = -1, melhorMp = 0;
      for (let i = 0; i + 1 < u.length; i++) {
        const a = u[i], b = u[i + 1];
        if ((b - a) >= melhorDiff) { melhorDiff = b - a; melhorMp = (a + b) / 2; }
      }
      gapEsp = Math.max(3, Math.min(Math.floor(melhorMp + 0.5), hband));
    }

    const toks = [];
    for (let j = 0; j < runs.length; j++) {
      if (j > 0 && runs[j][0] - runs[j - 1][1] >= gapEsp) toks.push(' ');
      toks.push(runs[j]);
    }
    return { hband, toks };
  }

  /* ---------- reconhecimento de linhas ---------- */

  // ink: Float64Array (h * w, row-major), valores 0..1
  function reconhecerInk(ink, w, h) {
    limparGradeInk(ink, w, h);
    const bink = binarioSemGrades(ink, w, h);
    const bandas = bandasLinha(bink, w, h);
    const linhas = [], confs = [];
    const gridB = new Float64Array(GH * GW);

    for (const [y0, y1] of bandas) {
      const { hband, toks } = segmentos(ink, w, y0, y1);
      const glifos = [];  // { c, p, ti }
      const cfs = [];
      let primeira = true, tokIdx = 0;

      for (const t of toks) {
        if (t === ' ') {
          glifos.push({ c: ' ', p: null, ti: -1 });
          primeira = false;
          tokIdx++;
          continue;
        }
        // TTA: mesmas janelas da referência (centro, ±1, e recortes apertados)
        const wx0 = Math.max(0, t[0] - 1);
        const wx1 = Math.min(w, t[1] + 1);
        const janelas = [[t[0], t[1]], [wx0, t[1]], [t[0], wx1]];
        if (t[1] - t[0] >= 4) {
          janelas.push([t[0] + 1, t[1]]);
          janelas.push([t[0], t[1] - 1]);
        }
        const ps = [];
        for (const [ax0, ax1] of janelas) {
          const ft = featuresDoGlifo(ink, w, y0, hband, ax0, ax1);
          if (!ft) continue;
          ps.push(prever(ft));
          blurGrid(ft, gridB); // borra só o grid 16x20; as 3 medidas ficam
          const fb = Float64Array.from(ft);
          fb.set(gridB, 0);
          ps.push(prever(fb));
        }
        if (!ps.length) continue;
        const p = new Float64Array(NCLS);
        for (const q of ps) for (let k = 0; k < NCLS; k++) p[k] += q[k];
        for (let k = 0; k < NCLS; k++) p[k] /= ps.length;

        let k;
        if (primeira) {
          // primeiro token da linha = código do produto: só dígitos
          k = -1;
          for (let i = 0; i < NCLS; i++) {
            if (DIGITS.indexOf(CHARS[i]) < 0) continue;
            if (k < 0 || p[i] > p[k]) k = i;
          }
        } else {
          k = 0;
          for (let i = 1; i < NCLS; i++) if (p[i] > p[k]) k = i;
          const c = CHARS[k];
          // o ERP é caixa alta: entre minúscula e maiúscula parecidas,
          // prefere a maiúscula com probabilidade razoável
          if (c >= 'a' && c <= 'z') {
            const ku = CHARS.indexOf(c.toUpperCase());
            if (ku >= 0 && p[ku] >= 0.4 * p[k]) k = ku;
          }
        }
        glifos.push({ c: CHARS[k], p, ti: tokIdx });
        cfs.push(p[k]);
      }

      // regras de contexto entre glifos do mesmo token
      for (let j = 0; j < glifos.length; j++) {
        const g = glifos[j];
        if (!g.p) continue;
        if (DIGITS.indexOf(g.c) >= 0) {
          // dígito entre duas letras maiúsculas do mesmo token → reler como letra
          const antes = (j > 0 && glifos[j - 1].ti === g.ti) ? glifos[j - 1].c : null;
          let depois = null;
          if (j + 1 < glifos.length && glifos[j + 1].ti === g.ti) depois = glifos[j + 1].c;
          if (antes && depois && antes >= 'A' && antes <= 'Z' && depois >= 'A' && depois <= 'Z') {
            let kl = -1;
            for (let i = 0; i < NCLS; i++) {
              const c = CHARS[i];
              if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'))) continue;
              if (kl < 0 || g.p[i] > g.p[kl]) kl = i;
            }
            if (kl >= 0 && g.p[kl] > 0.30) g.c = CHARS[kl];
          }
          continue;
        }
        // letra entre dígitos do mesmo token → reler como dígito
        const antesG = (j > 0 && glifos[j - 1].ti === g.ti) ? glifos[j - 1].c : null;
        let depoisG = null;
        for (let q = j + 1; q < glifos.length && glifos[q].ti === g.ti; q++) {
          if (DIGITS.indexOf(glifos[q].c) >= 0) { depoisG = glifos[q].c; break; }
        }
        if (antesG && DIGITS.indexOf(antesG) >= 0 && depoisG) {
          let kd = -1;
          for (let i = 0; i < NCLS; i++) {
            if (DIGITS.indexOf(CHARS[i]) < 0) continue;
            if (kd < 0 || g.p[i] > g.p[kd]) kd = i;
          }
          if (kd >= 0) g.c = CHARS[kd];
        }
      }

      const txt = glifos.map((g) => g.c).join('').replace(/\s+$/, '');
      linhas.push(txt.trim());
      confs.push(cfs.length ? cfs.reduce((a, b) => a + b, 0) / cfs.length : 0);
    }
    return { linhas, confs };
  }

  /* ---------- API pública ---------- */

  // gray: Uint8ClampedArray ou Uint8Array (comprimento w*h), 0..255
  function reconhecerGray(gray, w, h) {
    const ink = new Float64Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const g = gray[i] / 255;
      let v = (1 - g - 0.15) / 0.7;
      ink[i] = v < 0 ? 0 : (v > 1 ? 1 : v);
    }
    return reconhecerInk(ink, w, h);
  }

  /* extrairDeArquivo(arquivo) → { itens, texto, confianca }
     itens = [{ codigo, descricao, linha }] no padrão do João. */
  async function extrairDeArquivo(arquivo) {
    loggerPadrao('Lendo o print…');
    const bitmap = await createImageBitmap(arquivo);
    const w = bitmap.width, h = bitmap.height;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const d = ctx.getImageData(0, 0, w, h).data;
    const gray = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const j = i * 4;
      gray[i] = (d[j] * 0.299 + d[j + 1] * 0.587 + d[j + 2] * 0.114) | 0;
    }
    const { linhas, confs } = reconhecerGray(gray, w, h);
    const texto = linhas.join('\n');
    const confianca = confs.length
      ? Math.round((confs.reduce((a, b) => a + b, 0) / confs.length) * 1000) / 10
      : 0;
    const itens = raiz.ParserProdutos ? raiz.ParserProdutos.extrairProdutos(texto) : [];
    loggerPadrao('Pronto.');
    return { itens, texto, confianca };
  }

  const api = { setLogger, extrairDeArquivo };
  if (typeof raiz.OCR_TESTES !== 'undefined') {
    // pontos de entrada para os testes automatizados (Node), sem afetar a extensão
    api._reconhecerGray = reconhecerGray;
    api._reconhecerInk = reconhecerInk;
  }
  raiz.OCRComum = api;
})(typeof self !== 'undefined' ? self : this);
