/*
 * parser.js — Extração de produtos (código + descrição) do texto OCR.
 * Módulo puro, sem dependências: usado pela ui da extensão e pelos testes em Node.
 *
 * Padrão de saída (definido pelo João):
 *   94940 IOGURTE BATAVO PENSE 1150G ZERO MORANGO UN
 *   104527 BEBIDA LACTEA PARMALAT FIT FLEX CHOCOLATE 250ML UN
 *   96551 DIANTEIRO BOV RESF C/ OSSO KG
 *   7 BANANA PRATA KG
 *
 * Regras:
 *  - código: token numérico isolado de 1 a 8 dígitos — os códigos do ERP do
 *    João têm tamanhos variados, até 1 dígito. Colado em letra não é código
 *    ("250ML" e "1150G" ficam na descrição);
 *  - numeração de linha antes do código ("20 96551 DIANTEIRO...") é
 *    descartada: no começo da linha, de uma sequência de tokens numéricos,
 *    o ÚLTIMO é o código e os anteriores são numeração de grade;
 *  - linha "quantidade + unidade" sozinha (ex.: "3 KG", "10 CX") não é produto;
 *  - descrição: texto que segue o código na mesma linha, SEM ACENTO,
 *    maiúsculo, espaços simples, sem rótulos ("Descrição do produto:" etc.)
 *    e sem número de quantidade solto no final;
 *  - código sozinho na linha: procura a descrição nas linhas seguintes,
 *    pulando rótulos de tela, e para na linha com outro código;
 *  - linha de rótulo ("Quantidade recebida diverge...") é ignorada.
 */

(function (raiz) {
  'use strict';

  // Código: 1-8 dígitos, não encostado em letra ou número ("250ML" não é código).
  var RE_CODIGO = /(^|[^A-Z0-9])(\d{1,8})(?![A-Z0-9])/;

  // Sequência de tokens numéricos no começo da linha ("20 96551", "1 1083",
  // "7"). O lookahead impede "250ML" de virar sequência.
  var RE_INICIO_NUM = /^(\d{1,8}(?:\s+\d{1,8})*)(?![A-Z0-9])/;

  // Unidades conhecidas do ERP (coluna de unidade das linhas de produto).
  var RE_SOMENTE_UNIDADE = /^(?:KG|UN|CX|PC|LT|FD|DZ|MT|SC|RL|PAR|BAR)$/;

  // Rótulos de tela: linha/começo de descrição que começa com isto é ruído.
  var ROTULOS = [
    'CODIGO', 'COD', 'DESCRICAO DA INCONSISTENC', 'DESCRICAO', 'PRODUTO',
    'ITEM', 'QUANTIDADE', 'RECEBIDA', 'DIVERGE', 'CONSTA', 'NOTA',
    'INCONSISTENC', 'OBSERVACAO', 'JUSTIFICATIVA', 'DATA', 'HORA',
    'NF-E', 'NFE', 'PEDIDO', 'FORNECEDOR', 'REMESSA', 'MOTIVO', 'UNIDADE',
    'USUARIO', 'SITUACAO', 'STATUS'
  ];

  // Rótulo no MEIO da linha (ex.: "94940 Descrição do produto: IOGURTE...").
  var RE_ROTULO_INTERNO = /\b(?:DESCRICAO\s*(?:DO\s*PRODUTO|DA\s*INCONSISTENCIA)?|PRODUTO|ITEM)\s*[:\-]\s*/g;

  function semAcento(s) {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  // Normaliza uma linha: sem acento, maiúscula, separadores de grade viram
  // espaço, espaços colapsados.
  function normalizarLinha(s) {
    return semAcento(String(s || ''))
      .toUpperCase()
      .replace(/[\u2013\u2014\u2022\u00b7|_*]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Remove rótulo do início da linha (apenas "CODIGO:"/"COD:").
  // Numeração NÃO é arrancada aqui (código pode ter 1 dígito):
  // quem decide código vs. numeração é extrairProdutos.
  function limparRotulos(linha) {
    return linha
      .replace(/^COD(?:IGO|\.)?\s*[:\-.]?\s*/, '')
      .trim();
  }

  function eRuido(desc) {
    if (!desc) return true;
    // Quase sem letras → é número solto, não descrição.
    if (desc.replace(/[^A-Z]/g, '').length < 2) return true;
    // Um token só que é unidade ("3 KG" → descrição "KG") não é produto.
    if (!/\s/.test(desc) && RE_SOMENTE_UNIDADE.test(desc)) return true;
    for (var i = 0; i < ROTULOS.length; i++) {
      if (desc.indexOf(ROTULOS[i]) === 0) return true;
    }
    return false;
  }

  // Linha com letras insuficientes (só números/pontuação) ao redor.
  function quaseSemLetra(s) {
    return s.replace(/[^A-Z]/g, '').length < 2;
  }

  // Limpeza final da descrição: rótulos internos, pontuação das pontas e
  // número de quantidade solto no final ("... MORANGO UN 3" → "... MORANGO UN").
  function limparDescricao(desc) {
    var d = normalizarLinha(desc)
      .replace(RE_ROTULO_INTERNO, ' ')
      .replace(/^[\s:\-.,;]+/, '')
      .replace(/[\s:\-.,;]+$/, '')
      // quantidade solta no final (1 a 4 dígitos, não colada a letra)
      .replace(/\s+\d{1,4}$/, '');
    return normalizarLinha(d);
  }

  /*
   * extrairProdutos(textoOCR) → [{ codigo, descricao, linha }]
   * linha = string já no padrão final "CODIGO DESCRICAO".
   */
  function extrairProdutos(textoOCR) {
    var bruto = String(textoOCR || '').split(/\r?\n/);
    var linhas = bruto.map(normalizarLinha).filter(function (l) { return l.length > 0; });

    var itens = [];
    var vistos = {};

    function adicionar(codigo, desc) {
      var d = limparDescricao(desc);
      if (eRuido(d)) return;
      var chave = codigo + '|' + d;
      if (vistos[chave]) return;
      vistos[chave] = true;
      itens.push({ codigo: codigo, descricao: d, linha: codigo + ' ' + d });
    }

    function temCodigo(linha) {
      return RE_CODIGO.test(linha);
    }

    for (var i = 0; i < linhas.length; i++) {
      var linha = limparRotulos(linhas[i]);

      var codigo, antes, depois;
      var mi = linha.match(RE_INICIO_NUM);
      if (mi) {
        // Começo da linha com tokens numéricos: o último é o código,
        // os anteriores são numeração de linha ("20 96551 DIANTEIRO...").
        var tokens = mi[1].split(/\s+/);
        codigo = tokens[tokens.length - 1];
        var pos = mi[0].length - codigo.length;
        depois = linha.slice(pos + codigo.length);
        antes = linha.slice(0, pos);
      } else {
        // Sem sequência no começo: código em qualquer posição (leftmost).
        var m = linha.match(RE_CODIGO);
        if (!m) continue;
        codigo = m[2];
        var pos2 = linha.indexOf(codigo, m.index);
        depois = linha.slice(pos2 + codigo.length);
        antes = linha.slice(0, pos2);
      }

      // Linha "quantidade + unidade" sozinha ("3 KG", "10 CX") não é produto.
      if (RE_SOMENTE_UNIDADE.test(depois.trim())) continue;

      if (quaseSemLetra(antes) && quaseSemLetra(depois)) {
        // Código sozinho na linha: descrição nas linhas seguintes,
        // pulando rótulos, parando em linha com outro código.
        for (var prox = i + 1; prox < linhas.length; prox++) {
          var cand = limparRotulos(linhas[prox]);
          if (temCodigo(cand)) break;          // outro produto começou
          if (eRuido(cand)) continue;          // rótulo de tela, pula
          adicionar(codigo, cand);             // achou a descrição
          i = prox;
          break;
        }
        continue;
      }

      adicionar(codigo, depois);
    }

    return itens;
  }

  var api = { extrairProdutos: extrairProdutos, normalizarLinha: normalizarLinha, semAcento: semAcento };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  raiz.ParserProdutos = api;
})(typeof self !== 'undefined' ? self : this);