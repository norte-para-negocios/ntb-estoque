import { test } from 'node:test'
import assert from 'node:assert/strict'
import { moedaParaCent, lerCartoesPagar, lerCartoesReceber, lerContas } from './tela-puro.ts'

test('moeda pt-BR com espaço duro e negativo', () => {
  assert.equal(moedaParaCent('R$ 1.234,56'), 123456)
  assert.equal(moedaParaCent('-R$ 91,02'), -9102)
  assert.equal(moedaParaCent('R$ 0,00'), 0)
  assert.equal(moedaParaCent('abc'), null)
})
test('cartões de contas a pagar', () => {
  const t = 'Títulos no filtro\n3\nFalta pagar\nR$ 100,00\nAtrasado (1)\nR$ 50,00\nJá pago\nR$ 25,50\n'
  assert.deepEqual(lerCartoesPagar(t), { quantidade: 3, faltaPagarCent: 10000, quantidadeAtrasada: 1, atrasadoCent: 5000, jaPagoCent: 2550 })
  assert.equal(lerCartoesPagar('Nada'), null)
})
test('cartões de contas a receber', () => {
  assert.deepEqual(lerCartoesReceber('Vendido no filtro\nR$ 10,00\n2 contas · taxas R$ 0,00\nA receber'), { quantidade: 2, brutoCent: 1000 })
  assert.equal(lerCartoesReceber('x'), null)
})
test('contas correntes', () => {
  assert.deepEqual(lerContas(['Caixa\nCaixa\nEditar\nSaldo atual\n-R$ 5,00\nSaldo inicial R$ 0,00', 'sem saldo']), [{ nome: 'Caixa', saldoCent: -500 }])
})
