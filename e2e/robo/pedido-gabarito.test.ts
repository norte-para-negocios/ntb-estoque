// Testes do gabarito do pedido de compra (ticket 07). Valores esperados calculados à mão, com a regra em palavras:
// etapas rascunho -> aguardando aprovação -> aprovado -> cancelado; "recebido" só existe com nota lançada no estoque;
// pedido recebido por completo não se cancela.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { totalPedido, proximaEtapa, recebimento, situacaoNaNota } from './pedido-gabarito.ts'

test('total do pedido: 3 KG a 42 + 2 L a 9,50 + frete 5 = 150,00', () => {
  assert.equal(totalPedido([{ quantidade: '3', preco: '42' }, { quantidade: '2', preco: '9.50' }], '5', '0'), '150')
})
test('total do pedido arredonda em centavos: 7 x 0,333 = 2,331 vira 2,33', () => {
  assert.equal(totalPedido([{ quantidade: '7', preco: '0.333' }], '0', '0'), '2.33')
})

test('etapas: rascunho enviar -> aguardando; aprovar -> aprovado', () => {
  assert.deepEqual(proximaEtapa('rascunho', 'enviar'), { ok: true, etapa: 'aguardando_aprovacao' })
  assert.deepEqual(proximaEtapa('aguardando_aprovacao', 'aprovar'), { ok: true, etapa: 'aprovado' })
})
test('etapas: aprovar direto do rascunho vale; reprovar volta a rascunho; reabrir só de aprovado sem nota', () => {
  assert.deepEqual(proximaEtapa('rascunho', 'aprovar'), { ok: true, etapa: 'aprovado' })
  assert.deepEqual(proximaEtapa('aguardando_aprovacao', 'reprovar'), { ok: true, etapa: 'rascunho' })
  assert.deepEqual(proximaEtapa('aprovado', 'reabrir', { temNota: false }), { ok: true, etapa: 'rascunho' })
  assert.equal(proximaEtapa('aprovado', 'reabrir', { temNota: true }).ok, false)
  assert.equal(proximaEtapa('rascunho', 'reabrir').ok, false)
})
test('etapas: enviar fora do rascunho é recusado; cancelar pedido cancelado é recusado', () => {
  assert.equal(proximaEtapa('aprovado', 'enviar').ok, false)
  assert.equal(proximaEtapa('cancelado', 'cancelar').ok, false)
})
test('cancelar: vale em rascunho, aguardando, aprovado sem recebimento e com recebimento parcial', () => {
  for (const e of ['rascunho', 'aguardando_aprovacao', 'aprovado'] as const) assert.deepEqual(proximaEtapa(e, 'cancelar', { recebidoTotal: false }), { ok: true, etapa: 'cancelado' })
})
test('cancelar pedido recebido por completo é recusado', () => {
  const r = proximaEtapa('aprovado', 'cancelar', { recebidoTotal: true })
  assert.equal(r.ok, false)
})

const pedido = [{ quantidade: '24', fator: '1' }, { quantidade: '750', fator: '1' }]
test('recebimento: nenhuma nota -> aprovado, nada recebido, falta tudo', () => {
  const r = recebimento(pedido, [])
  assert.equal(r.etapaExibida, 'aprovado')
  assert.deepEqual(r.itens.map((i) => [i.recebido, i.falta]), [['0', '24'], ['0', '750']])
  assert.equal(r.recebidoTotal, false)
})
test('recebimento: 10 de 24 e nada do 2º -> recebido parcial', () => {
  const r = recebimento(pedido, [[{ indice: 0, quantidade: '10', fator: '1' }]])
  assert.equal(r.etapaExibida, 'recebido_parcial')
  assert.deepEqual(r.itens.map((i) => [i.recebido, i.falta]), [['10', '14'], ['0', '750']])
})
test('recebimento: segunda nota completa tudo -> recebido', () => {
  const r = recebimento(pedido, [[{ indice: 0, quantidade: '10', fator: '1' }], [{ indice: 0, quantidade: '14', fator: '1' }, { indice: 1, quantidade: '750', fator: '1' }]])
  assert.equal(r.etapaExibida, 'recebido')
  assert.equal(r.recebidoTotal, true)
  assert.deepEqual(r.itens.map((i) => i.falta), ['0', '0'])
})
test('recebimento: fator multiplica (3 KG x 1000 = 3000 G contra pedido 3 KG x 1000)', () => {
  const r = recebimento([{ quantidade: '3', fator: '1000' }], [[{ indice: 0, quantidade: '3', fator: '1000' }]])
  assert.equal(r.itens[0].pedidoBase, '3000')
  assert.equal(r.itens[0].recebido, '3000')
  assert.equal(r.etapaExibida, 'recebido')
})
test('recebimento: um item completo e outro a zero não é recebido total', () => {
  const r = recebimento(pedido, [[{ indice: 0, quantidade: '24', fator: '1' }]])
  assert.equal(r.recebidoTotal, false)
  assert.equal(r.etapaExibida, 'recebido_parcial')
})

test('situação do item na nota: certa, veio menos, veio mais, não veio', () => {
  assert.equal(situacaoNaNota('24', '24'), 'ok')
  assert.equal(situacaoNaNota('24', '10'), 'falta')
  assert.equal(situacaoNaNota('24', '30'), 'excede')
  assert.equal(situacaoNaNota('24', null), 'nao_veio')
})
