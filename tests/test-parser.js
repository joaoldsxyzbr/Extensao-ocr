/*
 * tests/test-parser.js — roda com: node tests/test-parser.js
 * Casos derivados dos prints reais do João (nosso-recibo e grid de bovinos).
 */
const { extrairProdutos } = require('../parser.js');

let falhas = 0, total = 0;

function caso(nome, texto, esperado) {
  total++;
  const obtido = extrairProdutos(texto).map(p => p.linha);
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) {
    falhas++;
    console.log(`✗ ${nome}`);
    console.log(`  esperado: ${JSON.stringify(esperado)}`);
    console.log(`  obtido:   ${JSON.stringify(obtido)}`);
  } else {
    console.log(`✓ ${nome}`);
  }
}

// Print 1: ficha de inconsistência (código na própria linha, descrição abaixo).
caso('ficha com código sozinho na linha', `
Código
104527
Descrição da inconsistência
Quantidade recebida diverge do que consta na nota
Produto
BEBIDA LACTEA PARMALAT FIT FLEX CHOCOLATE 250ML
Descrição
BEBIDA LACTEA PARMALAT FIT FLEX CHOCOLATE 250ML
`, ['104527 BEBIDA LACTEA PARMALAT FIT FLEX CHOCOLATE 250ML']);

// Print 2: grid com numeração de linha (20/25) + código na descrição.
caso('grid com numeração de linha', `
20 96551 DIANTEIRO BOV RESF C/ OSSO KG
25 87601 FILE AMERICANO BOVINO RESFRIADO KG
`, ['96551 DIANTEIRO BOV RESF C/ OSSO KG', '87601 FILE AMERICANO BOVINO RESFRIADO KG']);

// Formato inline com rótulos na mesma linha.
caso('rótulos na mesma linha', `
Código: 94940 Descrição do produto: IOGURTE BATAVO PENSE 1150G ZERO MORANGO UN
`, ['94940 IOGURTE BATAVO PENSE 1150G ZERO MORANGO UN']);

// Acento vindo do OCR deve sumir (padrão do João é sem acento).
caso('remove acentos', '104527 BEBIDA LÁCTEA PARMALAT FIT FLEX CHOCOLATE 250ML UN',
  ['104527 BEBIDA LACTEA PARMALAT FIT FLEX CHOCOLATE 250ML UN']);

// Grade com separador |
caso('grade com pipe', `
| 93202 | IOGURTE BATAVO 110G MORANGO PATRULHA CANINA UN | 3 |
| 95528 | CREME QUARK BATAVO NUV 100G MORANGO UN | 1 |
`, ['93202 IOGURTE BATAVO 110G MORANGO PATRULHA CANINA UN', '95528 CREME QUARK BATAVO NUV 100G MORANGO UN']);

// Ruído puro não gera item.
caso('sem código, sem item', `
Quantidade recebida diverge do que consta na nota
Total do pedido: R$ 1.250,00
`, []);

// "250ML" não é código (colado em letra).
caso('tamanho não vira código', 'PRODUTO 250ML CHOCOLATE KG', []);

// Duplicado (Produto + Descrição repetem) cai em um item só.
caso('deduplica código+descrição', `
104527 BEBIDA LACTEA PARMALAT FIT FLEX 250ML UN
104527 BEBIDA LACTEA PARMALAT FIT FLEX 250ML UN
`, ['104527 BEBIDA LACTEA PARMALAT FIT FLEX 250ML UN']);

console.log(`\n${total - falhas}/${total} testes passaram`);
process.exit(falhas ? 1 : 0);
