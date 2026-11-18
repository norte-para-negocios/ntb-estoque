// Testes do gabarito da venda do Vendas (ticket 05). Valores esperados calculados à mão, da regra em palavras:
// o prato vendido gera uma OP que consome cada insumo da ficha (líquida x fator x (1 + perda%)) x quantidade ÷ rendimento,
// produz a quantidade vendida do prato e a venda tira o prato; item sem ficha só sai; serviço não mexe no estoque.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { consumoDaFicha, resolverLocal, movimentosEsperados, saldoLiquido, type FichaGab, type LojaGab } from './venda-gabarito.ts'

const aperol: FichaGab = { rendimento: '1', itens: [
  { insumo: '80079', liquida: '60', fator: '1', perda: '0' },
  { insumo: '80080', liquida: '90', fator: '1', perda: '0' },
  { insumo: '80035', liquida: '0.03', fator: '1', perda: '0' },
] }

test('3 Aperol: 180 ML, 270 ML e 0,09 KG de insumo (ficha x quantidade)', () => {
  assert.deepEqual(consumoDaFicha(aperol, '3'), [
    { insumo: '80079', quantidade: '180' }, { insumo: '80080', quantidade: '270' }, { insumo: '80035', quantidade: '0.09' },
  ])
})

test('rendimento 70 (acarajé): 140 vendidos consomem 2 vezes a ficha', () => {
  const f: FichaGab = { rendimento: '70', itens: [{ insumo: 'a', liquida: '1', fator: '1', perda: '0' }, { insumo: 'b', liquida: '0.25', fator: '1', perda: '0' }, { insumo: 'c', liquida: '0.015', fator: '1', perda: '0' }] }
  assert.deepEqual(consumoDaFicha(f, '140'), [{ insumo: 'a', quantidade: '2' }, { insumo: 'b', quantidade: '0.5' }, { insumo: 'c', quantidade: '0.03' }])
})

test('fator de correção 1,25 e perda de 10%: 100 líquidos viram 137,5 brutos; 2 vendidos consomem 275', () => {
  const f: FichaGab = { rendimento: '1', itens: [{ insumo: 'x', liquida: '100', fator: '1.25', perda: '10' }] }
  assert.deepEqual(consumoDaFicha(f, '2'), [{ insumo: 'x', quantidade: '275' }])
})

test('arredonda em 6 casas, meia para longe do zero: 1 a 0,0000005 por 1 = 0,000001', () => {
  const f: FichaGab = { rendimento: '1', itens: [{ insumo: 'x', liquida: '0.0000005', fator: '1', perda: '0' }] }
  assert.deepEqual(consumoDaFicha(f, '1'), [{ insumo: 'x', quantidade: '0.000001' }])
})

const loja: LojaGab = { padrao: 100, cozinha: 200, bar: 300, porSetor: { Pizzaria: 400 }, porProduto: { P9: 500 } }

test('local: produto mapeado vence tudo, depois local escolhido, setor, cozinha/bar e por fim o padrão', () => {
  assert.equal(resolverLocal(loja, { codigo: 'P9', localEstoque: 1, setor: 'Pizzaria', destination: 'bar' }), 500)
  assert.equal(resolverLocal(loja, { codigo: 'a', localEstoque: 7, setor: 'Pizzaria', destination: 'bar' }), 7)
  assert.equal(resolverLocal(loja, { codigo: 'a', setor: 'pizzaria', destination: 'bar' }), 400)
  assert.equal(resolverLocal(loja, { codigo: 'a', destination: 'bar' }), 300)
  assert.equal(resolverLocal(loja, { codigo: 'a', destination: 'kitchen' }), 200)
  assert.equal(resolverLocal(loja, { codigo: 'a' }), 100)
})

test('movimentos esperados: prato com ficha = insumos saem, prato entra e sai; revenda só sai; serviço nada', () => {
  const m = movimentosEsperados([
    { codigo: '90017', quantidade: '3', local: 300, ficha: aperol },
    { codigo: '90059', quantidade: '2', local: 300 },
    { codigo: '50001', quantidade: '1', local: 100, servico: true },
  ])
  assert.deepEqual(m, [
    { codigo: '80079', local: 300, tipo: 'Produção', quantidade: '-180' },
    { codigo: '80080', local: 300, tipo: 'Produção', quantidade: '-270' },
    { codigo: '80035', local: 300, tipo: 'Produção', quantidade: '-0.09' },
    { codigo: '90017', local: 300, tipo: 'Produção', quantidade: '3' },
    { codigo: '90017', local: 300, tipo: 'Saída', quantidade: '-3' },
    { codigo: '90059', local: 300, tipo: 'Saída', quantidade: '-2' },
  ])
})

test('saldo líquido por produto e local: o prato produzido e vendido fica em zero', () => {
  const s = saldoLiquido(movimentosEsperados([{ codigo: '90017', quantidade: '3', local: 300, ficha: aperol }, { codigo: '90017', quantidade: '1', local: 300, ficha: aperol }]))
  assert.equal(s.get('90017:300'), '0')
  assert.equal(s.get('80079:300'), '-240')
  assert.equal(s.get('80035:300'), '-0.12')
})
