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

// Códigos de tamanhos variados (ERP do João: códigos de 1 a 8 dígitos).
caso('código de 1 dígito', '7 BANANA PRATA KG', ['7 BANANA PRATA KG']);
caso('código de 2 dígitos', '82 ABACATE KG', ['82 ABACATE KG']);
caso('código de 3 dígitos', '282 ABACATE KG', ['282 ABACATE KG']);

// Print hortifruti (representativo): 11 produtos, códigos de 3 a 4 dígitos.
caso('hortifruti com códigos curtos', `
282 ABACATE KG
286 BANANA PRATA KG
292 LARANJA BAHIA KG
296 MAMAO UN
318 MORANGO CX
444 BATATA KG
446 CEBOLA KG
533 COUVE FLOR UN
715 TOMATE SALADA KG
815 ALHO PORO UN
1083 ABACAXI PEROLA UN
`, [
  '282 ABACATE KG', '286 BANANA PRATA KG', '292 LARANJA BAHIA KG', '296 MAMAO UN',
  '318 MORANGO CX', '444 BATATA KG', '446 CEBOLA KG', '533 COUVE FLOR UN',
  '715 TOMATE SALADA KG', '815 ALHO PORO UN', '1083 ABACAXI PEROLA UN'
]);

// "quantidade + unidade" sozinha não é produto.
caso('quantidade+unidade não vira produto', `
282 ABACATE KG
3 CX
296 MAMAO UN
`, ['282 ABACATE KG', '296 MAMAO UN']);

// Numeração de linha antes de código curto: o último token numérico é o código.
caso('numeração antes do código curto', '1 1083 ABACAXI PEROLA UN',
  ['1083 ABACAXI PEROLA UN']);

// Quantidade no fim da linha é descartada da descrição.
caso('quantidade no fim é descartada', '1083 ABACAXI PEROLA UN 3',
  ['1083 ABACAXI PEROLA UN']);

console.log(`\n${total - falhas}/${total} testes passaram`);
process.exit(falhas ? 1 : 0);