import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dataDoMovimento } from './data-movimento.ts'

test('lançado no mesmo dia: mostra dia e hora do lançamento, sem segunda linha', () => {
  assert.deepEqual(dataDoMovimento('2026-11-05', '2026-11-05T20:04:00Z'), { data: '05/11, 17:04', lancado: null })
})
test('lançado com data passada: mostra o dia do movimento e quando foi lançado', () => {
  assert.deepEqual(dataDoMovimento('2026-10-21', '2026-11-05T20:04:00Z'), { data: '21/10', lancado: 'lançado em 05/11, 17:04' })
})
test('dia comparado no fuso da Bahia: 01:00 UTC de 06/11 ainda é 05/11', () => {
  assert.deepEqual(dataDoMovimento('2026-11-05', '2026-11-06T01:00:00Z'), { data: '05/11, 22:00', lancado: null })
})
test('com ano', () => {
  assert.deepEqual(dataDoMovimento('2026-10-21', '2026-11-05T20:04:00Z', true), { data: '21/10/26', lancado: 'lançado em 05/11/26, 17:04' })
  assert.deepEqual(dataDoMovimento('2026-11-05', '2026-11-05T20:04:00Z', true), { data: '05/11/26, 17:04', lancado: null })
})
test('sem data_ref cai no lançamento', () => {
  assert.deepEqual(dataDoMovimento(null, '2026-11-05T20:04:00Z'), { data: '05/11, 17:04', lancado: null })
})
