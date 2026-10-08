import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addDias, diasEntre, agruparCuponsPorDia, preencherDias, MAX_DIAS } from './faturamento-dias.ts'

test('addDias atravessa mês e ano', () => {
  assert.equal(addDias('2026-01-31', 1), '2026-02-01')
  assert.equal(addDias('2026-12-31', 1), '2027-01-01')
  assert.equal(addDias('2026-03-01', -1), '2026-02-28')
})

test('diasEntre é inclusivo e vazio quando invertido', () => {
  assert.deepEqual(diasEntre('2026-10-06', '2026-10-08'), ['2026-10-06', '2026-10-07', '2026-10-08'])
  assert.deepEqual(diasEntre('2026-10-08', '2026-10-08'), ['2026-10-08'])
  assert.deepEqual(diasEntre('2026-10-09', '2026-10-08'), [])
})

test('diasEntre limita a MAX_DIAS', () => {
  assert.equal(diasEntre('2020-01-01', '2026-01-01').length, MAX_DIAS)
})

test('agruparCuponsPorDia soma por dia, ignora cancelado e arredonda centavos', () => {
  const m = agruparCuponsPorDia([
    { data: '2026-10-06', valor: 10.1, cancelado: false },
    { data: '2026-10-06', valor: 20.2, cancelado: false },
    { data: '2026-10-06', valor: 999, cancelado: true },
    { data: '2026-10-07T03:00:00.000Z', valor: 5, cancelado: false },
  ])
  assert.equal(m.get('2026-10-06'), 30.3)
  assert.equal(m.get('2026-10-07'), 5)
  assert.equal(m.size, 2)
})

test('preencherDias inclui dias sem venda com 0', () => {
  const r = preencherDias('2026-10-06', '2026-10-08', new Map([['2026-10-07', 50]]))
  assert.deepEqual(r, [
    { dia: '2026-10-06', valor: 0 },
    { dia: '2026-10-07', valor: 50 },
    { dia: '2026-10-08', valor: 0 },
  ])
})
