import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cupomEntraNoFaturamento, mesPorCupomFaturavel } from './faturamento-cupom-regra.ts'

const c = (n_id_cupom: number, data: string, extra: { cancelado?: boolean; devolvido?: boolean } = {}) => ({
  n_id_cupom, data, cancelado: false, devolvido: false, ...extra,
})

test('cupom normal entra; cancelado e devolvido não (mesma regra do pré-agregado do ano atual)', () => {
  assert.equal(cupomEntraNoFaturamento(c(1, '2025-07-10')), true)
  assert.equal(cupomEntraNoFaturamento(c(2, '2025-07-10', { cancelado: true })), false)
  assert.equal(cupomEntraNoFaturamento(c(3, '2025-07-10', { devolvido: true })), false)
})

test('mapa de mês por cupom ignora o cancelado: os itens dele ficam sem mês e saem da soma', () => {
  const m = mesPorCupomFaturavel([
    c(1, '2025-07-10'),
    c(2, '2025-07-11', { cancelado: true }),
    c(3, '2025-10-02'),
    c(4, '2025-10-03', { devolvido: true }),
  ])
  assert.deepEqual([...m.entries()], [[1, '2025-07'], [3, '2025-10']])
  assert.equal(m.get(2), undefined)
})
