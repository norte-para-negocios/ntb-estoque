import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore: import com .ts exigido pelo node --test
import { bloqueioPorPeriodo, ehErroPeriodoFechado, filtrosConclusaoOPForaDosFechados, filtrosForaDosFechados, foraDoMesFechado, mesDaData, mesesDaTela, rotuloMes, situacaoDaData, validarFechamento, validarReabertura } from './periodo-fechado-puro.ts'

const SET = { mes: '2026-09', fechadoEm: '2026-10-05T13:00:00Z', fechadoPorNome: 'Ana' }

test('mesDaData aceita ISO, timestamp e dd/mm/aaaa', () => {
  assert.equal(mesDaData('2026-09-15'), '2026-09')
  assert.equal(mesDaData('2026-09-15T23:59:00-03:00'), '2026-09')
  assert.equal(mesDaData('2026-10-01T02:00:00Z'), '2026-09') // 23h de 30/09 na Bahia
  assert.equal(mesDaData('2026-10-01T02:00:00+00:00'), '2026-09')
  assert.equal(mesDaData('05/10/2026'), '2026-10')
  assert.equal(mesDaData(''), null)
  assert.equal(mesDaData(null), null)
  assert.equal(mesDaData('lixo'), null)
})

test('bloqueioPorPeriodo cita o mês e quem fechou; data aberta ou vazia passa', () => {
  const m = bloqueioPorPeriodo(['2026-09-15'], [SET], 'Ajuste')
  assert.ok(m && m.startsWith('Período fechado:'))
  assert.match(m!, /setembro de 2026/)
  assert.match(m!, /Ana/)
  assert.match(m!, /15\/09\/2026/)
  assert.equal(bloqueioPorPeriodo(['2026-10-01', null, undefined], [SET], 'Ajuste'), null)
  assert.equal(bloqueioPorPeriodo(['2026-08-31'], [SET], 'Ajuste'), null)
  assert.ok(bloqueioPorPeriodo(['2026-10-01', '30/09/2026'], [SET], 'Ajuste'))
})

test('situacaoDaData: fechamento formal manda; o aviso antigo continua', () => {
  assert.equal(situacaoDaData('2026-09-15', '2026-10-19', ['2026-09']), 'fechado')
  assert.equal(situacaoDaData('2026-08-31', '2026-10-19', []), 'antigo')
  assert.equal(situacaoDaData('2026-09-01', '2026-10-19', []), 'aberto')
  assert.equal(situacaoDaData('2026-09-15', '2026-10-19', [], '2026-09'), 'antigo')
  assert.equal(situacaoDaData('2026-10-19', '2026-10-19', ['2026-09']), 'aberto')
  assert.equal(situacaoDaData('lixo', '2026-10-19', []), 'antigo')
})

test('validarFechamento: só mês que já terminou', () => {
  assert.ok(validarFechamento('2026-10', '2026-10-19'))
  assert.ok(validarFechamento('2026-11', '2026-10-19'))
  assert.equal(validarFechamento('2026-09', '2026-10-19'), null)
  assert.equal(validarFechamento('2025-12', '2026-01-02'), null)
  assert.ok(validarFechamento('lixo', '2026-10-19'))
  assert.ok(validarFechamento('2026-13', '2026-10-19'))
})

test('validarReabertura exige motivo de verdade', () => {
  assert.ok(validarReabertura('curto'))
  assert.ok(validarReabertura('          '))
  assert.equal(validarReabertura('contador pediu correção'), null)
})

test('mesesDaTela: os 12 meses anteriores ao atual, do mais recente', () => {
  const m = mesesDaTela('2026-01-10')
  assert.equal(m.length, 12)
  assert.equal(m[0], '2025-12')
  assert.equal(m[11], '2025-01')
})

test('rotuloMes', () => {
  assert.equal(rotuloMes('2026-09'), 'setembro de 2026')
  assert.equal(rotuloMes('2026-03'), 'março de 2026')
})

test('ehErroPeriodoFechado reconhece o PF001 e a mensagem', () => {
  assert.equal(ehErroPeriodoFechado({ code: 'PF001', message: 'x' }), true)
  assert.equal(ehErroPeriodoFechado({ message: 'Período fechado: ajuste com data em 01/09/2026' }), true)
  assert.equal(ehErroPeriodoFechado({ code: '22023', message: 'outro' }), false)
  assert.equal(ehErroPeriodoFechado(null), false)
})

test('foraDoMesFechado (filtro dos reenvios ao Omie)', () => {
  const f = new Set(['2026-09'])
  assert.equal(foraDoMesFechado('2026-09-30T12:00:00Z', f), false)
  assert.equal(foraDoMesFechado('2026-10-01', f), true)
  assert.equal(foraDoMesFechado(null, f), true)
  assert.equal(foraDoMesFechado('2026-09-30', new Set()), true)
})

test('filtrosForaDosFechados: um filtro "or" por mês fechado, no fuso da Bahia (revisão I1)', () => {
  assert.deepEqual(filtrosForaDosFechados('data', ['2026-09'], 'timestamp'), ['data.lt.2026-09-01T03:00:00Z,data.gte.2026-10-01T03:00:00Z'])
  assert.deepEqual(filtrosForaDosFechados('data', ['2025-12', '2026-02'], 'timestamp'), [
    'data.lt.2025-12-01T03:00:00Z,data.gte.2026-01-01T03:00:00Z', 'data.lt.2026-02-01T03:00:00Z,data.gte.2026-03-01T03:00:00Z'])
  assert.deepEqual(filtrosForaDosFechados('data_ajuste', ['2026-09'], 'date'), ['data_ajuste.lt.2026-09-01,data_ajuste.gte.2026-10-01'])
  assert.deepEqual(filtrosForaDosFechados('data', [], 'timestamp'), [])
  assert.deepEqual(filtrosForaDosFechados('data', ['lixo'], 'timestamp'), [])
})

test('filtrosConclusaoOPForaDosFechados: data desejada; sem ela, a previsão; sem as duas, passa', () => {
  assert.deepEqual(filtrosConclusaoOPForaDosFechados(['2026-09']), [
    'conclusao_data_desejada.lt.2026-09-01,conclusao_data_desejada.gte.2026-10-01,and(conclusao_data_desejada.is.null,or(identificacao_d_dt_previsao.lt.2026-09-01,identificacao_d_dt_previsao.gte.2026-10-01,identificacao_d_dt_previsao.is.null))',
  ])
})
