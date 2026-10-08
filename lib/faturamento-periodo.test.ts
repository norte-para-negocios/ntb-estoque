import { test } from 'node:test'
import assert from 'node:assert/strict'
import { periodoDoAtalho, periodoDoMes, mesVizinho, nomeMes, lerPeriodo } from './faturamento-periodo.ts'

test('atalhos', () => {
  assert.deepEqual(periodoDoAtalho('hoje', '2026-10-08'), { ini: '2026-10-08', fim: '2026-10-08' })
  assert.deepEqual(periodoDoAtalho('ontem', '2026-10-08'), { ini: '2026-10-07', fim: '2026-10-07' })
  assert.deepEqual(periodoDoAtalho('7dias', '2026-10-08'), { ini: '2026-10-02', fim: '2026-10-08' })
  assert.deepEqual(periodoDoAtalho('mes', '2026-10-08'), { ini: '2026-10-01', fim: '2026-10-08' })
  assert.deepEqual(periodoDoAtalho('mes_passado', '2026-10-08'), { ini: '2026-09-01', fim: '2026-09-30' })
  assert.deepEqual(periodoDoAtalho('mes_passado', '2027-01-15'), { ini: '2026-12-01', fim: '2026-12-31' })
  assert.deepEqual(periodoDoAtalho('ano', '2026-10-08'), { ini: '2026-01-01', fim: '2026-10-08' })
})

test('periodoDoMes: mês fechado inteiro, mês atual até hoje', () => {
  assert.deepEqual(periodoDoMes('2026-09', '2026-10-08'), { ini: '2026-09-01', fim: '2026-09-30' })
  assert.deepEqual(periodoDoMes('2026-10', '2026-10-08'), { ini: '2026-10-01', fim: '2026-10-08' })
  assert.deepEqual(periodoDoMes('2028-02', '2028-03-01'), { ini: '2028-02-01', fim: '2028-02-29' })
})

test('mesVizinho atravessa o ano', () => {
  assert.equal(mesVizinho('2026-01', -1), '2025-12')
  assert.equal(mesVizinho('2026-12', 1), '2027-01')
  assert.equal(mesVizinho('2026-10', 0), '2026-10')
})

test('nomeMes', () => {
  assert.equal(nomeMes('2026-10'), 'Outubro 2026')
})

test('lerPeriodo: padrão é o mês atual até hoje', () => {
  assert.deepEqual(lerPeriodo({}, '2026-10-08'), { ini: '2026-10-01', fim: '2026-10-08', cortado: false })
})

test('lerPeriodo: mes= e ini/fim', () => {
  assert.deepEqual(lerPeriodo({ mes: '2026-09' }, '2026-10-08'), { ini: '2026-09-01', fim: '2026-09-30', cortado: false })
  assert.deepEqual(lerPeriodo({ ini: '2026-10-03', fim: '2026-10-05' }, '2026-10-08'), { ini: '2026-10-03', fim: '2026-10-05', cortado: false })
  assert.deepEqual(lerPeriodo({ ini: '2026-10-03' }, '2026-10-08'), { ini: '2026-10-03', fim: '2026-10-08', cortado: false })
})

test('lerPeriodo: fim no futuro é limitado a hoje', () => {
  assert.deepEqual(lerPeriodo({ ini: '2026-10-03', fim: '2026-12-31' }, '2026-10-08'), { ini: '2026-10-03', fim: '2026-10-08', cortado: false })
})

test('lerPeriodo: inválido, invertido ou futuro cai no padrão', () => {
  const padrao = { ini: '2026-10-01', fim: '2026-10-08', cortado: false }
  assert.deepEqual(lerPeriodo({ ini: 'abc', fim: 'x' }, '2026-10-08'), padrao)
  assert.deepEqual(lerPeriodo({ ini: '2026-10-05', fim: '2026-10-01' }, '2026-10-08'), padrao)
  assert.deepEqual(lerPeriodo({ ini: '2026-11-01' }, '2026-10-08'), padrao)
  assert.deepEqual(lerPeriodo({ mes: '2026-11' }, '2026-10-08'), padrao)
  assert.deepEqual(lerPeriodo({ mes: '2026-13' }, '2026-10-08'), padrao)
})

test('lerPeriodo: mais de 366 dias mantém o trecho mais recente', () => {
  const r = lerPeriodo({ ini: '2025-01-01', fim: '2026-10-08' }, '2026-10-08')
  assert.equal(r.fim, '2026-10-08')
  assert.equal(r.ini, '2025-10-08')
  assert.equal(r.cortado, true)
})
