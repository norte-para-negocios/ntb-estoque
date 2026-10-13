import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizarMovOmie, marcarSaltosCmc, deduplicarMovs, type MovOmie } from './kardex-omie-puro.ts'

const mov = (o: Partial<MovOmie>): MovOmie => ({
  idMov: 1, idProd: 9, codigo_local_estoque: 100, dtMov: '16/08/2026', codOrigem: 'PDV', desOrigem: 'Movimento Gerado pelo PDV',
  tipo: 'saida', qtde: -1, valor: 66.56, cmc: 66.56, saldo: 20, numDoc: '000202169/001', numPedido: 'NFC-e 202169',
  idAjuste: 5, idCupom: 7, cancelamento: 'N', ...o,
})

test('normaliza data dd/mm/aaaa para ISO e mantém o sinal da quantidade', () => {
  const l = normalizarMovOmie(mov({}), 5)
  assert.equal(l.data_mov, '2026-08-16')
  assert.equal(l.quantidade, -1)
  assert.equal(l.loja_id, 5)
  assert.equal(l.id_mov, 1)
  assert.equal(l.cancelado, false)
})

test('cancelamento S vira cancelado true; campos ausentes viram null', () => {
  const l = normalizarMovOmie(mov({ cancelamento: 'S', numDoc: undefined, idCupom: undefined }), 5)
  assert.equal(l.cancelado, true)
  assert.equal(l.num_doc, null)
  assert.equal(l.id_cupom, null)
})

test('marca salto de CMC de 10x ou mais em relação ao movimento anterior', () => {
  const ls = [
    normalizarMovOmie(mov({ idMov: 2, dtMov: '17/08/2026', cmc: 700 }), 5),
    normalizarMovOmie(mov({ idMov: 1, dtMov: '16/08/2026', cmc: 66 }), 5),
    normalizarMovOmie(mov({ idMov: 3, dtMov: '17/08/2026', cmc: 710 }), 5),
  ]
  const r = marcarSaltosCmc(ls)
  assert.deepEqual(r.map((x) => [x.id_mov, x.saltoCmc]), [[1, false], [2, true], [3, false]])
})

test('deduplicarMovs: mesmo id_mov no mesmo local fica uma vez só (a última); locais diferentes ficam os dois', () => {
  const ls = [
    normalizarMovOmie(mov({ idMov: 7, codigo_local_estoque: 100, qtde: 1 }), 5),
    normalizarMovOmie(mov({ idMov: 7, codigo_local_estoque: 200, qtde: -1 }), 5),
    normalizarMovOmie(mov({ idMov: 7, codigo_local_estoque: 100, qtde: 2 }), 5),
  ]
  const r = deduplicarMovs(ls)
  assert.equal(r.length, 2)
  assert.equal(r.find((x) => x.codigo_local_estoque === 100)?.quantidade, 2)
})
