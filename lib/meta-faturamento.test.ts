import { test } from 'node:test'
import assert from 'node:assert/strict'
import { periodoDoAtalho, resumirMeta, parseValorBR, periodoDiario } from './meta-faturamento.ts'

test('periodoDoAtalho: hoje, semana (segunda a hoje), mes (dia 1 a hoje)', () => {
  // 2026-10-08 é quinta-feira
  assert.deepEqual(periodoDoAtalho('hoje', '2026-10-08'), { ini: '2026-10-08', fim: '2026-10-08' })
  assert.deepEqual(periodoDoAtalho('semana', '2026-10-08'), { ini: '2026-10-05', fim: '2026-10-08' })
  assert.deepEqual(periodoDoAtalho('mes', '2026-10-08'), { ini: '2026-10-01', fim: '2026-10-08' })
})

test('periodoDoAtalho: semana quando hoje é domingo começa na segunda anterior', () => {
  assert.deepEqual(periodoDoAtalho('semana', '2026-10-11'), { ini: '2026-10-05', fim: '2026-10-11' })
})

const dias = [
  { dia: '2026-10-05', valor: 1200 },
  { dia: '2026-10-06', valor: 800 },
  { dia: '2026-10-07', valor: 1000 },
  { dia: '2026-10-08', valor: 300 }, // hoje, em andamento
  { dia: '2026-10-09', valor: 0 }, // futuro, ignorado
]

test('resumirMeta: usa só dias fechados e separa o dia em andamento', () => {
  const r = resumirMeta(dias, 1000, '2026-10-08')
  assert.equal(r.diasFechados, 3)
  assert.equal(r.realizado, 3000)
  assert.equal(r.metaPeriodo, 3000)
  assert.equal(r.pctAtingido, 100)
  assert.equal(r.media, 1000)
  assert.deepEqual(r.melhor, { dia: '2026-10-05', valor: 1200 })
  assert.deepEqual(r.pior, { dia: '2026-10-06', valor: 800 })
  assert.equal(r.diasBateram, 2)
  assert.deepEqual(r.emAndamento, { dia: '2026-10-08', valor: 300 })
})

test('resumirMeta: meta 0 não divide por zero', () => {
  const r = resumirMeta(dias, 0, '2026-10-08')
  assert.equal(r.pctAtingido, null)
  assert.equal(r.diasBateram, 0) // meta 0 não é meta: nenhum dia "bateu"
})

test('resumirMeta: só hoje no período (nenhum dia fechado)', () => {
  const r = resumirMeta([{ dia: '2026-10-08', valor: 300 }], 1000, '2026-10-08')
  assert.equal(r.diasFechados, 0)
  assert.equal(r.media, null)
  assert.equal(r.melhor, null)
  assert.equal(r.pctAtingido, null)
  assert.deepEqual(r.emAndamento, { dia: '2026-10-08', valor: 300 })
})

test('resumirMeta: dia sem venda conta como não bateu', () => {
  const r = resumirMeta([{ dia: '2026-10-06', valor: 0 }, { dia: '2026-10-07', valor: 1500 }], 1000, '2026-10-08')
  assert.equal(r.diasBateram, 1)
  assert.deepEqual(r.pior, { dia: '2026-10-06', valor: 0 })
})

test('parseValorBR: ponto e vírgula em todos os formatos comuns', () => {
  assert.equal(parseValorBR('5000'), 5000)
  assert.equal(parseValorBR('5000,50'), 5000.5)
  assert.equal(parseValorBR('5000.50'), 5000.5) // teclado numérico com ponto
  assert.equal(parseValorBR('5.000,50'), 5000.5)
  assert.equal(parseValorBR('5.000'), 5000) // milhar
  assert.equal(parseValorBR('1.234.567'), 1234567)
  assert.equal(parseValorBR(' R$ 5.000,5 '), 5000.5)
  assert.ok(Number.isNaN(parseValorBR('abc')))
  assert.ok(Number.isNaN(parseValorBR('')))
})

test('periodoDiario: hoje, ontem, semana, mês e mês passado', () => {
  assert.deepEqual(periodoDiario('hoje', '2026-10-08'), { ini: '2026-10-08', fim: '2026-10-08' })
  assert.deepEqual(periodoDiario('ontem', '2026-10-08'), { ini: '2026-10-07', fim: '2026-10-07' })
  assert.deepEqual(periodoDiario('semana', '2026-10-08'), { ini: '2026-10-05', fim: '2026-10-08' })
  assert.deepEqual(periodoDiario('mes', '2026-10-08'), { ini: '2026-10-01', fim: '2026-10-08' })
  assert.deepEqual(periodoDiario('mes_passado', '2026-10-08'), { ini: '2026-09-01', fim: '2026-09-30' })
})

test('periodoDiario: virada de mês e de ano', () => {
  assert.deepEqual(periodoDiario('ontem', '2026-10-01'), { ini: '2026-09-30', fim: '2026-09-30' })
  assert.deepEqual(periodoDiario('mes_passado', '2027-01-15'), { ini: '2026-12-01', fim: '2026-12-31' })
  assert.deepEqual(periodoDiario('mes_passado', '2026-03-10'), { ini: '2026-02-01', fim: '2026-02-28' })
})
