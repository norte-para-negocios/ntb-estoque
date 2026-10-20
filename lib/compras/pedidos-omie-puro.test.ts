import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dataOmieParaIso, saldoPedidosOmie, leituraPedidosOmieLigada, resumirPedidosOmie } from './pedidos-omie-puro.ts'

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

test('resumirPedidosOmie: pedido do NTB reconhecido pelo código de integração, recebido e sem duplicar', () => {
  const forn = new Map([[3011223344, 'DISTRIBUIDORA ATLANTICO']])
  const r = resumirPedidosOmie([
    { cabecalho_consulta: { nCodPed: 9988776655, cNumero: '123', cCodIntPed: 'NTB-PC-1532', nCodFor: 3011223344, dDtPrevisao: '27/10/2026', dIncData: '20/10/2026', cEtapa: '15' },
      produtos_consulta: [{ nCodProd: 1, nQtde: 36, nValUnit: 29.95, nQtdeRec: 10 }, { nCodProd: 2, nQtde: 40, nValMerc: 275, nQtdeRec: 0 }] },
    { cabecalho_consulta: { nCodPed: 9988776655 }, produtos_consulta: [] },
    { cabecalho_consulta: { nCodPed: 1, cNumero: '7', nCodFor: 5 }, produtos_consulta: [{ nCodProd: 1, nQtde: 2, nValUnit: 3, nQtdeRec: 2 }] },
    { cabecalho_consulta: {} },
  ], forn)
  assert.equal(r.length, 2)
  assert.deepEqual(r[0], { nCodPed: 9988776655, numero: '123', pedidoNtbId: 1532, fornecedor: 'DISTRIBUIDORA ATLANTICO', previsao: '2026-10-27',
    inclusao: '2026-10-20', etapa: '15', itens: 2, valor: 1353.2, quantidade: 76, recebido: 10, situacao: 'recebido_parcial' })
  assert.equal(r[1].pedidoNtbId, null)
  assert.equal(r[1].fornecedor, 'Fornecedor 5')
  assert.equal(r[1].situacao, 'recebido')
})
