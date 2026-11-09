/*
 * ocr-comum.js — Núcleo de OCR compartilhado entre o popup e a página do extrator.
 * Versão 2.0.1: motor próprio com rede neural (MLP), SEM dependências externas —
 * nada de Tesseract, WASM, CDN, worker ou instalador. A imagem nunca sai do
 * navegador: ela é lida de um <canvas> e classificada por pesos embutidos.
 *
 * Depende apenas de: rede-ocr.js (REDE_OCR, pesos treinados) e parser.js
 * (ParserProdutos, extração dos itens no padrão do João).
 *
 * Pipeline (espelha a referência Python validada em linetest.py, 67/67
 * linhas corretas nas 7 variantes sintéticas do sweep):
 *   1. imagem → tinta: ink = clamp((1 - cinza - 0.15) / 0.7, 0, 1)
 *   2. limpa linhas de grade (linhas/colunas com cobertura > 60%)
 *   3. bandas de linha por projeção horizontal (mescla folgas <= 2 px)
 *   4. por banda: renormalização pelo fundo (linha azul/tinta realça traços)
 *   5. runs por projeção vertical (limiar 0.50); pares com folga <= 1px são
 *      fundidos se o resultado ficar <= 1.4x a mediana (glifos partidos por
 *      subpixel)
 *   6. runs largos (> 1.75x mediana): segmentação ótima guiada pela rede —
 *      escolhe pelo PRODUTO das confianças TTA de TODOS os pedaços
 *      (branch and bound), com penalidade para leituras fora de [0-9A-Z]
 *      e para hastes estreitas lendo "1"/"I"
 *   7. espaçamento: limiar GLOBAL por imagem, no maior salto da
 *      distribuição de folgas (âncora 0.30 da altura da banda)
 *   8. otimizador de janela para fragmentos (1, I, /, ...): estende até
 *      4px sem invadir o run vizinho, adota leitura maiúscula >= 0.90
 *   9. contexto e reparos por token (código sem espaço interno, glifo
 *      fundido no código redividido etc.)
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
  const LEGIT = new Set('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  let DIG = null; // índices das classes de dígitos

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

  function ehDigito(c) { return c >= '0' && c <= '9'; }
  function ehMaiuscula(c) { return c >= 'A' && c <= 'Z'; }
  function ehMinuscula(c) { return c >= 'a' && c <= 'z'; }
  function ehLetra(c) { return ehMaiuscula(c) || ehMinuscula(c); }

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

  // strip: banda da linha (y0..y1) do ink global. Devolve ft(323) ou null.
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

  /* ---------- probabilidade média de uma janela (TTA) ---------- */

  // TTA: 5 janelas (centro, ±1 e recortes apertados) x (nítido + borrado).
  // tta=false: janela única nítida. Devolve Float64Array(NCLS) ou null.
  function probasJanela(ink, w, y0, hband, w0, w1, tta) {
    const SW = w;
    let janelas;
    if (tta !== false) {
      janelas = [[w0, w1], [Math.max(0, w0 - 1), w1], [w0, Math.min(SW, w1 + 1)]];
      if (w1 - w0 >= 4) {
        janelas.push([w0 + 1, w1]);
        janelas.push([w0, w1 - 1]);
      }
    } else {
      janelas = [[w0, w1]];
    }
    const gridB = new Float64Array(GH * GW);
    let soma = null, n = 0;
    for (const [a0, a1] of janelas) {
      if (a1 <= a0) continue;
      const ft = featuresDoGlifo(ink, w, y0, hband, a0, a1);
      if (!ft) continue;
      if (!soma) soma = new Float64Array(NCLS);
      let q = prever(ft);
      for (let k = 0; k < NCLS; k++) soma[k] += q[k];
      n++;
      const fb = Float64Array.from(ft);
      blurGrid(ft, gridB);
      fb.set(gridB, 0);
      q = prever(fb);
      for (let k = 0; k < NCLS; k++) soma[k] += q[k];
      n++;
    }
    if (!soma) return null;
    for (let k = 0; k < NCLS; k++) soma[k] /= n;
    return soma;
  }

  /* ---------- grade e bandas ---------- */

  // linhas/colunas com cobertura > 60% no binário dado
  function grausBink(bink, w, h) {
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
    return { rows, cols };
  }

  // zera (±1) as linhas/colunas de grade no array dado (linhas já relativas)
  function zerarGradeEm(a, w, h, rows, cols) {
    for (const r of rows) {
      const y0 = Math.max(0, r - 1), y1 = Math.min(h, r + 2);
      for (let y = y0; y < y1; y++) {
        const base = y * w;
        for (let x = 0; x < w; x++) a[base + x] = 0;
      }
    }
    for (const c of cols) {
      const x0 = Math.max(0, c - 1), x1 = Math.min(w, c + 2);
      for (let y = 0; y < h; y++) {
        const base = y * w;
        for (let x = x0; x < x1; x++) a[base + x] = 0;
      }
    }
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

  /* ---------- runs de uma banda (com DP de segmentação) ---------- */

  // ink: Float64Array global; banda [y0, y1)
  function runsDe(ink, w, y0, y1) {
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

    // funde pares com folga <= 1px se o resultado for curto (<= 1.4x mediana):
    // glifos redondos partidos por subpixel voltam a ser um run; pares de
    // letras reais somam ~2x a mediana e não podem fundir
    const med0 = runs.length ? median(runs.map((r) => r[1] - r[0])) : 1.0;
    const fundidos = [];
    for (const r of runs) {
      if (fundidos.length && r[0] - fundidos[fundidos.length - 1][1] <= 1 &&
          (r[1] - fundidos[fundidos.length - 1][0]) <= 1.4 * med0) {
        fundidos[fundidos.length - 1][1] = r[1];
      } else fundidos.push([r[0], r[1]]);
    }
    runs = fundidos;

    const larguras = runs.map((r) => r[1] - r[0]);
    if (larguras.length) {
      const med = median(larguras);
      const limiteL = Math.max(5, pyRound(1.75 * med));

      // score de um pedaço: confiança TTA média x penalidade de legitimidade.
      // TTA é essencial: um corte errado pode ler com confiança altíssima na
      // janela exata (meio-zero lendo "3" com 0.9996) mas desmancha com
      // deslocamentos de 1px (0.58); o conteúdo do ERP é só [0-9A-Z],
      // pedaços que leem pontuação ou minúscula recebem fator 0.7.
      const memo = new Map();
      function confRun(x0, x1) {
        const key = x0 * 100000 + x1;
        let m = memo.get(key);
        if (m) return m;
        const p = probasJanela(ink, w, y0, hband, x0, x1, true);
        if (!p) { m = { v: 0.0, ch: '' }; memo.set(key, m); return m; }
        let k = 0;
        for (let i = 1; i < NCLS; i++) if (p[i] > p[k]) k = i;
        let v = p[k];
        if (!LEGIT.has(CHARS[k])) v *= 0.7;
        m = { v, ch: CHARS[k] };
        memo.set(key, m);
        return m;
      }

      // segmentação ótima guiada pela rede: um fragmento legítimo (haste de
      // T lida "1" com conf 1.000) pode ter confiança MAIOR que o glifo
      // certo ("T" 0.9999), e o primeiro corte errado envenena o resto.
      // Escolhe pelo PRODUTO das confianças de TODOS os pedaços
      // (branch and bound: cortes ordenados por confiança, só desce na
      // recursão onde o produto ainda pode vencer o melhor já encontrado)
      function dividir(r, depth) {
        const rw = r[1] - r[0];
        if (rw <= limiteL || depth >= 8) {
          return { partes: [r], score: confRun(r[0], r[1]).v };
        }
        const n = Math.max(2, pyRound(rw / Math.max(med, 1)));
        const slot = rw / n;
        const c0 = Math.max(1, Math.trunc(slot * 0.45));
        const c1 = Math.max(c0 + 1, Math.min(rw - 1, Math.trunc(slot * 1.6) + 1));
        const cands = [];
        for (let c = c0; c < Math.min(c1, rw - 1); c++) {
          if (r[1] - (r[0] + c + 1) < 3) continue;
          const m = confRun(r[0], r[0] + c);
          let cc = m.v;
          // haste de T/G cortada lê "1" com confiança alta; um "1" real tem
          // side bearings e quase nunca funde com vizinhos. Peça estreita
          // (<0.65 slot) lendo 1/I é quase sempre fragmento: penalidade leve
          if ((m.ch === '1' || m.ch === 'I') && c < 0.65 * slot) cc *= 0.85;
          if (cc >= 0.55) cands.push([cc, c]);
        }
        // ordem do Python: sort(reverse=True) sobre (cc, c)
        cands.sort((a, b) => (b[0] - a[0]) || (b[1] - a[1]));
        let melhor = null, melhorScore = -1.0;
        for (const [cc, c] of cands) {
          if (cc <= melhorScore) break; // o produto só diminui
          const { partes: resto, score: rp } = dividir([r[0] + c + 1, r[1]], depth + 1);
          if (rp < 0.55) continue;
          const score = cc * rp;
          if (score > melhorScore) {
            melhorScore = score;
            melhor = [[r[0], r[0] + c]].concat(resto);
          }
        }
        if (!melhor) return { partes: [r], score: confRun(r[0], r[1]).v };
        return { partes: melhor, score: melhorScore };
      }

      const saida = [];
      for (const r of runs) {
        const { partes, score } = dividir(r, 0);
        saida.push(...(score < 0.55 ? [r] : partes));
      }
      runs = saida;
    }

    const gaps = [];
    for (let j = 1; j < runs.length; j++) gaps.push(runs[j][0] - runs[j - 1][1]);
    return { hband, runs, gaps };
  }

  /* ---------- limiar de espaço global ---------- */

  function limiarEspaco(dados) {
    const gaps = [];
    for (const { hband, gaps: gl } of dados) {
      for (const g of gl) if (g <= 0.75 * hband) gaps.push(g);
    }
    if (!gaps.length) return null;
    const u = Array.from(new Set(gaps)).sort((a, b) => a - b);
    const ancoras = dados.map((d) => Math.max(3, pyRound(0.30 * d.hband)));
    const ancora = ancoras.length ? median(ancoras) : 4.0;
    let melhorMp = null, melhorSalto = 0, melhorD = 1e9;
    for (let i = 0; i + 1 < u.length; i++) {
      const a = u[i], b = u[i + 1];
      const salto = b - a;
      const mp = (a + b) / 2.0;
      const d = Math.abs(mp - ancora);
      if (salto > melhorSalto || (salto === melhorSalto && d < melhorD - 1e-9)) {
        melhorSalto = salto; melhorMp = mp; melhorD = d;
      }
    }
    return melhorMp;
  }

  /* ---------- reconhecimento ---------- */

  // gray: valores 0..1 (Float64Array/Float32Array, w*h row-major)
  function reconhecerGray(gray, w, h) {
    if (DIG === null) {
      DIG = [];
      for (let i = 0; i < NCLS; i++) if (ehDigito(CHARS[i])) DIG.push(i);
    }
    const ink = new Float64Array(w * h);
    for (let i = 0; i < w * h; i++) {
      let v = (1 - gray[i] - 0.15) / 0.7;
      ink[i] = v < 0 ? 0 : (v > 1 ? 1 : v);
    }

    // grade: linhas/colunas com cobertura > 60% (a ink > 0.30)
    const g1 = grausBink((function () {
      const b = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) b[i] = ink[i] > 0.30 ? 1 : 0;
      return b;
    })(), w, h);
    const gRows = g1.rows, gCols = g1.cols;
    zerarGradeEm(ink, w, h, gRows, gCols);

    // binário sem grades para achar as bandas
    const bink = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) bink[i] = ink[i] > 0.30 ? 1 : 0;
    const g2 = grausBink(bink, w, h);
    zerarGradeEm(bink, w, h, g2.rows, g2.cols);

    const bandas = bandasLinha(bink, w, h);

    // por banda: renormaliza pelo fundo (linha azul/tinta realça traços no ink)
    const bandVals = new Float64Array(w * 90);
    for (const [y0, y1] of bandas) {
      const hband = y1 - y0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        const base = y * w;
        for (let x = 0; x < w; x++) bandVals[n++] = gray[base + x];
      }
      const s = Array.from(bandVals.subarray(0, n)).sort((a, b) => a - b);
      const pos = 0.9 * (n - 1);
      const lo = Math.min(n - 1, Math.floor(pos));
      const hi = Math.min(n - 1, lo + 1);
      const bg = s[lo] + (pos - lo) * (s[hi] - s[lo]);
      if (bg < 0.995) {
        const nova = new Float64Array(hband * w);
        for (let y = 0; y < hband; y++) {
          const base = (y0 + y) * w;
          for (let x = 0; x < w; x++) {
            let v = (1 - gray[base + x] / bg - 0.15) / 0.7;
            nova[y * w + x] = v < 0 ? 0 : (v > 1 ? 1 : v);
          }
        }
        // zera as grades dentro da banda (linhas relativas)
        const rowsRel = [];
        for (const r of gRows) if (r >= y0 && r < y1) rowsRel.push(r - y0);
        zerarGradeEm(nova, w, hband, rowsRel, gCols);
        ink.set(nova, y0 * w);
      }
    }

    // passada 1: runs por banda; passada 2: espaços com limiar global
    const dados = bandas.map(([y0, y1]) => runsDe(ink, w, y0, y1));
    const mp = limiarEspaco(dados);

    const linhas = [], confs = [];
    for (let bi = 0; bi < bandas.length; bi++) {
      const [y0, y1] = bandas[bi];
      const { hband, runs } = dados[bi];
      let gapEsp = 3;
      if (mp !== null) {
        gapEsp = Math.max(3, Math.min(Math.floor(mp + 0.5), Math.trunc(0.6 * hband)));
      }
      const SW = w;
      const toks = [];
      for (let j = 0; j < runs.length; j++) {
        if (j > 0 && runs[j][0] - runs[j - 1][1] >= gapEsp) toks.push(' ');
        toks.push(runs[j]);
      }

      const glifos = []; // { c, p, ti, rf }
      const cfs = [];
      let primeira = true, tokIdx = 0;

      for (const t of toks) {
        if (t === ' ') {
          glifos.push({ c: ' ', p: null, ti: -1, rf: null });
          primeira = false;
          tokIdx++;
          continue;
        }
        let p = probasJanela(ink, w, y0, hband, t[0], t[1], true);
        if (!p) continue;
        let runF = [t[0], t[1]];

        // otimização de janela para FRAGMENTOS: se a leitura base é um glifo
        // fino cortado (1, I, parenteses, barra...), a ponta anti-alias de
        // uma barra pode ter caído abaixo do limiar 0.50 e "vazado" para o
        // gap; esticar a janela recupera o glifo inteiro (T lido como 1 -> T).
        // A janela estendida não pode invadir o run vizinho (senão I + perna
        // do A vizinho lê "L"). Glifos normais não esticam: mais largos leem
        // outra classe com confiança maior (0 vira O).
        let kbase = 0;
        for (let i = 1; i < NCLS; i++) if (p[i] > p[kbase]) kbase = i;
        if ('1I()/\\ti'.indexOf(CHARS[kbase]) >= 0 && p[kbase] < 0.99) {
          let melhorP = p, melhorJ = runF;
          let vizEsq = 0, vizDir = SW;
          for (const rr of runs) {
            if (rr[1] <= t[0] && rr[1] > vizEsq) vizEsq = rr[1];
            if (rr[0] >= t[1] && rr[0] < vizDir) vizDir = rr[0];
          }
          const cands = [];
          for (let e = 1; e < 5; e++) {
            if (t[0] - e >= vizEsq) cands.push([t[0] - e, t[1]]);
            if (t[1] + e <= vizDir) cands.push([t[0], t[1] + e]);
          }
          for (const [a0, a1] of cands) {
            const pe = probasJanela(ink, w, y0, hband, a0, a1, false);
            if (!pe) continue;
            let ke = 0;
            for (let i = 1; i < NCLS; i++) if (pe[i] > pe[ke]) ke = i;
            const ce = CHARS[ke];
            if (ehMaiuscula(ce) && pe[ke] >= 0.90 && pe[ke] > p[kbase] + 0.02) {
              melhorP = pe; melhorJ = [a0, a1];
            }
          }
          if (melhorJ[0] !== runF[0] || melhorJ[1] !== runF[1]) {
            p = melhorP;
            runF = melhorJ;
          }
        }

        let k;
        if (primeira) {
          // primeiro token da linha = código do produto: só dígitos
          k = -1;
          for (const i of DIG) if (k < 0 || p[i] > p[k]) k = i;
        } else {
          k = 0;
          for (let i = 1; i < NCLS; i++) if (p[i] > p[k]) k = i;
          const c = CHARS[k];
          // o ERP é caixa alta: entre minúscula e maiúscula parecidas,
          // prefere a maiúscula com probabilidade razoável
          if (ehMinuscula(c)) {
            const ku = CHARS.indexOf(c.toUpperCase());
            if (ku >= 0 && p[ku] >= 0.4 * p[k]) k = ku;
          }
        }
        glifos.push({ c: CHARS[k], p, ti: tokIdx, rf: runF });
        cfs.push(p[k]);
      }

      /* regras de contexto entre glifos do mesmo token */
      for (let j = 0; j < glifos.length; j++) {
        const g = glifos[j];
        if (!g.p) continue;
        const ti = g.ti;
        const antes = (j > 0 && glifos[j - 1].ti === ti) ? glifos[j - 1].c : null;
        const depois = (j + 1 < glifos.length && glifos[j + 1].ti === ti) ? glifos[j + 1].c : null;

        if (ehDigito(g.c)) {
          // dígito entre duas letras maiúsculas do mesmo token → reler como letra
          if (antes && depois && ehLetra(antes) && ehLetra(depois) &&
              !ehMinuscula(antes) && !ehMinuscula(depois)) {
            let kl = -1;
            for (let i = 0; i < NCLS; i++) {
              if (!ehLetra(CHARS[i])) continue;
              if (kl < 0 || g.p[i] > g.p[kl]) kl = i;
            }
            if (kl >= 0 && g.p[kl] > 0.30) g.c = CHARS[kl];
          }
          continue;
        }
        // O/o colado em dígito no mesmo token é quase sempre um 0 mal lido
        // (500G -> 5ooG); palavras reais raramente têm O vizinho de dígito
        if (g.c === 'O' || g.c === 'o') {
          if (((antes && ehDigito(antes)) || (depois && ehDigito(depois))) &&
              g.p[CHARS.indexOf('0')] >= 0.10 * g.p[CHARS.indexOf(g.c)]) {
            g.c = '0';
          }
          continue;
        }
        // letra entre dígitos do mesmo token → reler como dígito
        if (antes && ehDigito(antes)) {
          let depoisG = null;
          for (let q = j + 1; q < glifos.length && glifos[q].ti === ti; q++) {
            if (ehDigito(glifos[q].c)) { depoisG = glifos[q].c; break; }
          }
          if (depoisG !== null) {
            let kd = -1;
            for (const i of DIG) if (kd < 0 || g.p[i] > g.p[kd]) kd = i;
            if (kd >= 0) g.c = CHARS[kd];
          }
        }
      }

      /* ---- reparos por token ---- */
      const tokensDe = (gs) => {
        const tts = [];
        let cur = [];
        for (let gi = 0; gi < gs.length; gi++) {
          if (gs[gi].c === ' ') { tts.push(cur); cur = []; }
          else cur.push(gi);
        }
        tts.push(cur);
        return tts;
      };
      const popEspacoAntes = (idx) => {
        for (let gi = idx - 1; gi >= 0; gi--) {
          if (glifos[gi].c === ' ') { glifos.splice(gi, 1); return; }
        }
      };

      // código (token 0) não tem espaço interno: se um falso espaço o partiu
      // em tokens só de dígitos, junta de volta
      for (let round = 0; round < 3; round++) {
        const tts = tokensDe(glifos);
        if (tts.length >= 2 && tts[0].length && tts[1].length &&
            tts[0].every((i) => ehDigito(glifos[i].c)) &&
            tts[1].every((i) => ehDigito(glifos[i].c))) {
          popEspacoAntes(tts[1][0]);
        } else break;
      }

      // token de UMA letra colado em token anterior terminado em letra:
      // gap de I/1 tem tamanho de palavra, mas palavra de uma letra não
      // existe nessas descrições -> junta
      for (let round = 0; round < 4; round++) {
        const tts = tokensDe(glifos);
        let feito = false;
        for (let t = 1; t < tts.length; t++) {
          if (tts[t].length === 1 && ehLetra(glifos[tts[t][0]].c) &&
              tts[t - 1].length >= 2 && ehLetra(glifos[tts[t - 1][tts[t - 1].length - 1]].c)) {
            popEspacoAntes(tts[t][0]);
            feito = true;
            break;
          }
        }
        if (!feito) break;
      }

      // token 0 (código): glifo dígito mais largo que 1.3x a mediana dos
      // dígitos é provavelmente um par fundido (74 -> 2); redivide com
      // verificação dígito-only da rede
      const confDig = (x0, x1) => {
        const pdg = probasJanela(ink, w, y0, hband, x0, x1, false);
        if (!pdg) return { ch: null, cc: 0.0 };
        let k = 0;
        for (let i = 1; i < DIG.length; i++) if (pdg[DIG[i]] > pdg[DIG[k]]) k = i;
        return { ch: CHARS[DIG[k]], cc: pdg[DIG[k]] };
      };
      const splitDig = (x0, x1, depth) => {
        const wd = x1 - x0;
        if (wd < 5 || depth >= 6) return null;
        let melhorC = -1, melhorCc = -1.0, melhorCh = null;
        const cmin = Math.max(2, Math.trunc(wd * 0.3));
        const cmax = Math.min(wd - 2, Math.trunc(wd * 0.7));
        for (let c = cmin; c <= cmax; c++) {
          const { ch, cc } = confDig(x0, x0 + c);
          if (cc > melhorCc) { melhorCc = cc; melhorC = c; melhorCh = ch; }
        }
        if (melhorC < 0 || melhorCc < 0.6) return null;
        let resto = splitDig(x0 + melhorC + 1, x1, depth + 1);
        if (!resto) {
          const { ch: ch2, cc: cc2 } = confDig(x0 + melhorC + 1, x1);
          if (ch2 === null || cc2 < 0.6 || (x1 - (x0 + melhorC + 1)) < 2) return null;
          resto = [[ch2, [x0 + melhorC + 1, x1]]];
        }
        return [[melhorCh, [x0, x0 + melhorC]]].concat(resto);
      };

      for (let round = 0; round < 2; round++) {
        const tts = tokensDe(glifos);
        if (!tts.length || !tts[0].length) break;
        const idx0 = tts[0];
        if (!idx0.every((i) => ehDigito(glifos[i].c))) break;
        const larg = idx0.map((i) => glifos[i].rf[1] - glifos[i].rf[0]);
        if (larg.length < 2) break;
        const med0 = median(larg);
        let alvo = -1;
        for (const i of idx0) {
          const wd = glifos[i].rf[1] - glifos[i].rf[0];
          if (wd > 1.3 * med0 && wd >= med0 + 3) { alvo = i; break; }
        }
        if (alvo < 0) break;
        const partes = splitDig(glifos[alvo].rf[0], glifos[alvo].rf[1], 0);
        if (!partes) break;
        const novos = partes.map(([ch, run]) => ({ c: ch, p: glifos[alvo].p, ti: 0, rf: run }));
        glifos.splice(alvo, 1, ...novos);
      }

      const txt = glifos.map((g) => g.c).join('').trim();
      linhas.push(txt);
      confs.push(cfs.length ? cfs.reduce((a, b) => a + b, 0) / cfs.length : 0);
    }
    return { linhas, confs };
  }

  /* ---------- API pública ---------- */

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
    const gray = new Float64Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const j = i * 4;
      gray[i] = (d[j] * 0.299 + d[j + 1] * 0.587 + d[j + 2] * 0.114) / 255;
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
  }
  raiz.OCRComum = api;
})(typeof self !== 'undefined' ? self : this);
