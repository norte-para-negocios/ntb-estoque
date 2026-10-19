import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dataOmieParaIso, saldoPedidosOmie, leituraPedidosOmieLigada } from './pedidos-omie-puro.ts'

test('dataOmieParaIso', () => {
  assert.equal(dataOmieParaIso('01/03/2027'), '2027-03-01')
  assert.equal(dataOmieParaIso(''), null)
  assert.equal(dataOmieParaIso('2027-03-01'), null)
})

test('saldoPedidosOmie: falta receber por produto, só com previsão até o fim da estimativa', () => {
  const m = saldoPedidosOmie([
    { cabecalho_consulta: { dDtPrevisao: '20/10/2026' }, produtos_consulta: [{ nCodProd: 1, nQtde: 10, nQtdeRec: 4 }, { nCodProd: 2, nQtde: 5, nQtdeRec: 6 }] },
    { cabecalho_consulta: { dDtPrevisao: '30/11/2026' }, produtos_consulta: [{ nCodProd: 1, nQtde: 100 }] },
    { cabecalho_consulta: {}, produtos_consulta: [{ nCodProd: 1, nQtde: 1.5 }] },
  ], '2026-10-31')
  assert.equal(m.get(1), 7.5)
  assert.equal(m.has(2), false)
})

test('leitura desligada por padrão', () => {
  assert.equal(leituraPedidosOmieLigada({}), false)
  assert.equal(leituraPedidosOmieLigada({ OMIE_LER_PEDIDOS_COMPRA: '0' }), false)
  assert.equal(leituraPedidosOmieLigada({ OMIE_LER_PEDIDOS_COMPRA: '1' }), true)
})
