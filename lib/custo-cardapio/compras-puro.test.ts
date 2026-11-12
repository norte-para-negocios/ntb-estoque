import { test } from 'node:test'
import assert from 'node:assert/strict'
import { jaPedidoPorProduto, mensagemFornecedor, sugestaoDeCompra, type EntradaSugestao } from './compras-puro.ts'

const e = (o: Partial<EntradaSugestao>): EntradaSugestao => ({ saldo: 0, minimo: 0, unidade: 'UN', consumoPorDia: null, diasCobertura: 7, reservado: 0, jaPedido: 0, ...o })

test('abaixo do mínimo sem consumo: falta + metade do mínimo (igual à regra antiga)', () => {
  const s = sugestaoDeCompra(e({ saldo: 2, minimo: 10 }))
  assert.equal(s.motivo, 'minimo'); assert.equal(s.quantidade, 13)
})

test('acima do mínimo mas não cobre o consumo dos N dias: entra na lista', () => {
  const s = sugestaoDeCompra(e({ saldo: 12, minimo: 10, consumoPorDia: 2, diasCobertura: 7 }))
  assert.equal(s.motivo, 'consumo'); assert.equal(s.quantidade, 12) // alvo 10 + 14 = 24, tem 12
  assert.equal(sugestaoDeCompra(e({ saldo: 30, minimo: 10, consumoPorDia: 2 })).quantidade, 0)
  // cobertura maior pede mais
  assert.equal(sugestaoDeCompra(e({ saldo: 12, minimo: 10, consumoPorDia: 2, diasCobertura: 14 })).quantidade, 26)
})

test('reserva de evento desconta do saldo; sem mínimo nem consumo compra só o que falta para os eventos', () => {
  const s = sugestaoDeCompra(e({ saldo: 3, reservado: 5, unidade: 'KG' }))
  assert.equal(s.motivo, 'reserva'); assert.equal(s.quantidade, 2)
  assert.equal(sugestaoDeCompra(e({ saldo: 12, minimo: 10, reservado: 5 })).motivo, 'minimo')
})

test('o que já foi pedido soma ao disponível e pode tirar o item da lista', () => {
  assert.equal(sugestaoDeCompra(e({ saldo: 2, minimo: 10, jaPedido: 20 })).quantidade, 0)
  assert.equal(sugestaoDeCompra(e({ saldo: 2, minimo: 10, jaPedido: 5 })).quantidade, 8) // alvo 15 − 7
})

test('saldo negativo conta como zero e a quantidade arredonda pela unidade', () => {
  assert.equal(sugestaoDeCompra(e({ saldo: -4, minimo: 1000, unidade: 'G' })).quantidade, 1500)
  assert.equal(sugestaoDeCompra(e({ saldo: 0.2, minimo: 1, unidade: 'KG' })).quantidade, 1.5)
})

test('jaPedidoPorProduto: soma por produto o que falta chegar, nunca negativo', () => {
  const m = jaPedidoPorProduto([
    { codigoProduto: 1, quantidadeBase: 10, vinculado: 4 },
    { codigoProduto: 1, quantidadeBase: 5, vinculado: 0 },
    { codigoProduto: 2, quantidadeBase: 3, vinculado: 5 },
  ])
  assert.equal(m.get(1), 11); assert.equal(m.has(2), false)
})

test('mensagem do fornecedor', () => {
  const t = mensagemFornecedor({ fornecedor: 'Hortifruti', total: 0, itens: [{ codigo: 1, descricao: 'Tomate', unidade: 'KG', fornecedor: 'Hortifruti', quantidade: 5, custoUnitario: null }] }, 'Donana')
  assert.equal(t, 'Olá! Segue o pedido da Donana:\n\n- 5 kg de Tomate\n\nObrigado!')
})
