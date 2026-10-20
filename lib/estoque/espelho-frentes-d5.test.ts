// D5 (20/10/2026): locais da frente recente, cobertura conferida, retomada e cursor parado.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  estadoInicial, lerEstado, proximaLeitura, aposLeitura, locaisDaFrente, marcarLocalComMovimento, conferidoAte, diaBahia,
  coberturaDoEstado, avisoCoberturaKardex, type ConfigFrentes, type EstadoFrentes,
} from './espelho-frentes.ts'

const CFG: ConfigFrentes = {
  diasRecentes: 2, janelaMaxDias: 30, limite: '2026-07-01', intervaloRecenteMin: 60, diasRevisao: 35, intervaloRevisaoHoras: 24, locaisRecenteDias: 35,
}
const LOCAIS = [300, 100, 200]

test('recente lê só os locais com movimento nos últimos 35 dias; revisão e backfill leem todos', () => {
  let e = estadoInicial()
  assert.deepEqual(locaisDaFrente(e, CFG, 'recente', LOCAIS, '2026-10-20'), LOCAIS) // sem lista: todos
  e = marcarLocalComMovimento(e, 200, '2026-10-19')
  e = marcarLocalComMovimento(e, 300, '2026-08-01') // velho demais
  assert.deepEqual(locaisDaFrente(e, CFG, 'recente', LOCAIS, '2026-10-20'), [200])
  assert.deepEqual(locaisDaFrente(e, CFG, 'revisao', LOCAIS, '2026-10-20'), LOCAIS)
  assert.deepEqual(locaisDaFrente(e, CFG, 'backfill', LOCAIS, '2026-10-20'), LOCAIS)
  const p = proximaLeitura(e, CFG, '2026-10-20', Date.parse('2026-10-20T15:00:00Z'), LOCAIS)!
  assert.equal(p.frente, 'recente')
  assert.equal(p.cursor.local, 200)
  // local 200 sem mais páginas: a janela recente fecha (não passa pelo 300)
  const depois = aposLeitura(p.estado, 'recente', 1, LOCAIS, CFG, '2026-10-20T15:00:00Z')
  assert.equal(depois.recente.cursor, null)
  assert.equal(depois.recente.coberto_ate, '2026-10-20')
})

test('recente: todos os locais "ativos" velhos demais → lê todos (nunca fica sem local)', () => {
  const e = marcarLocalComMovimento(estadoInicial(), 300, '2026-08-01')
  assert.deepEqual(locaisDaFrente(e, CFG, 'recente', LOCAIS, '2026-10-20'), LOCAIS)
})

test('marcarLocalComMovimento guarda a maior data e não regride; nulo não muda nada', () => {
  let e = marcarLocalComMovimento(estadoInicial(), 100, '2026-10-10')
  e = marcarLocalComMovimento(e, 100, '2026-09-01')
  assert.equal(e.ativos?.['100'], '2026-10-10')
  assert.equal(marcarLocalComMovimento(e, null, '2026-10-11'), e)
  assert.equal(marcarLocalComMovimento(e, 100, null), e)
})

test('lerEstado preserva ativos e conferido_ate; descarta data inválida', () => {
  const e = lerEstado({ ativos: { 100: '2026-10-10', 200: 'x' }, conferido_ate: '2026-10-11' })
  assert.deepEqual(e.ativos, { 100: '2026-10-10' })
  assert.equal(e.conferido_ate, '2026-10-11')
})

test('diaBahia: 02:30 UTC ainda é o dia anterior', () => {
  assert.equal(diaBahia('2026-10-14T02:30:00Z'), '2026-10-13')
  assert.equal(diaBahia('2026-10-14T03:00:00Z'), '2026-10-14')
})

// Estado real da loja 5 em produção (espelho desligado em 16/10 ~20:50 UTC), lido em 20/10/2026.
const LOJA5 = {
  recente: { desde: '2026-10-12', cursor: null, coberto_ate: '2026-10-16', concluido_em: '2026-10-16T20:45:05.305Z' },
  revisao: { ate: '2026-10-14', cursor: { fim: '2026-10-11', ini: '2026-09-12', local: 2424369390, pagina: 40, iniciado_em: '2026-10-16T20:00:58.485Z' }, concluido_em: '2026-10-15T19:51:13.880Z' },
  backfill: { cursor: { fim: '2026-09-11', ini: '2026-08-13', local: 2424369390, pagina: 64, iniciado_em: '2026-10-16T18:41:14.999Z' }, concluido: false, proximo_fim: '2026-09-11', coberto_desde: '2026-09-12' },
}
const LOCAIS5 = [2424369390, 3801903927, 3778338070]

test('loja 5: o kardex lido vai até 16/10, mas o conferido só até 13/10 (14–16/10 foram lidos só no dia)', () => {
  const e = lerEstado(LOJA5)
  assert.equal(e.recente.coberto_ate, '2026-10-16')
  assert.equal(conferidoAte(e), '2026-10-13')
})

test('loja 5 religada: a recente relê de 14/10 (buraco) até hoje e só então o conferido avança', () => {
  const agora = Date.parse('2026-10-21T10:05:00Z') // 07:05 na Bahia
  const p = proximaLeitura(lerEstado(LOJA5), CFG, '2026-10-21', agora, LOCAIS5)!
  assert.equal(p.frente, 'recente')
  assert.equal(p.cursor.ini, '2026-10-14')
  assert.equal(p.cursor.fim, '2026-10-21')
  let e = p.estado
  for (let i = 0; i < LOCAIS5.length; i++) e = aposLeitura(e, 'recente', 1, LOCAIS5, CFG, '2026-10-21T10:06:00Z')
  assert.equal(e.recente.cursor, null)
  assert.equal(e.recente.coberto_ate, '2026-10-21')
  assert.equal(conferidoAte(e), '2026-10-19') // lido em 21/10: até 19/10 conta como conferido
})

test('sem parada longa a recente não volta ao conferido (custo normal: ontem + hoje)', () => {
  const e: EstadoFrentes = { ...estadoInicial(), recente: { cursor: null, coberto_ate: '2026-10-20', concluido_em: '2026-10-20T13:00:00Z', desde: '2026-09-01' }, conferido_ate: '2026-10-10' }
  const p = proximaLeitura(e, CFG, '2026-10-20', Date.parse('2026-10-20T14:05:00Z'), [null])!
  assert.equal(p.cursor.ini, '2026-10-19')
})

test('retomada nunca volta mais que diasRevisao', () => {
  const e: EstadoFrentes = { ...estadoInicial(), recente: { cursor: null, coberto_ate: '2026-08-01', concluido_em: '2026-08-01T20:00:00Z', desde: '2026-07-01' }, conferido_ate: '2026-07-20' }
  const p = proximaLeitura(e, CFG, '2026-10-20', Date.parse('2026-10-20T14:00:00Z'), [null])!
  // coberto_ate (01/08) é anterior a hoje − 35: recomeça do coberto_ate, como antes
  assert.equal(p.cursor.ini, '2026-08-01')
  const e2: EstadoFrentes = { ...e, recente: { ...e.recente, coberto_ate: '2026-10-18', concluido_em: '2026-10-18T20:00:00Z' } }
  assert.equal(proximaLeitura(e2, CFG, '2026-10-20', Date.parse('2026-10-20T14:00:00Z'), [null])!.cursor.ini, '2026-09-15')
})

test('cursor parado mais de 12 h (flag desligada no meio da revisão) recomeça a janela da página 1', () => {
  const agora = Date.parse('2026-10-21T10:05:00Z')
  const base = lerEstado(LOJA5)
  const e: EstadoFrentes = { ...base, recente: { ...base.recente, coberto_ate: '2026-10-21', concluido_em: '2026-10-21T10:00:00Z' } }
  const p = proximaLeitura(e, CFG, '2026-10-21', agora, LOCAIS5)!
  assert.equal(p.frente, 'revisao')
  assert.deepEqual(
    { ini: p.cursor.ini, fim: p.cursor.fim, local: p.cursor.local, pagina: p.cursor.pagina, iniciado_em: p.cursor.iniciado_em },
    { ini: '2026-09-12', fim: '2026-10-11', local: 2424369390, pagina: 1, iniciado_em: '2026-10-21T10:05:00.000Z' },
  )
  // cursor que avançou há pouco segue de onde estava
  const fresco: EstadoFrentes = { ...e, revisao: { ...e.revisao, cursor: { ...e.revisao.cursor!, avancado_em: '2026-10-21T09:00:00Z' } } }
  assert.equal(proximaLeitura(fresco, CFG, '2026-10-21', agora, LOCAIS5)!.cursor.pagina, 40)
})

test('recente normal não confere o dia (lido no próprio dia); a revisão contígua confere até hoje − 2', () => {
  const e0: EstadoFrentes = { ...estadoInicial(), recente: { cursor: null, coberto_ate: '2026-10-19', concluido_em: '2026-10-20T02:50:00Z', desde: '2026-09-01' }, conferido_ate: '2026-10-17' }
  const p = proximaLeitura(e0, CFG, '2026-10-20', Date.parse('2026-10-20T14:00:00Z'), [null])!
  assert.equal(p.frente, 'recente')
  assert.equal(p.cursor.ini, '2026-10-19')
  const e1 = aposLeitura(p.estado, 'recente', 1, [null], CFG, '2026-10-20T14:01:00Z')
  assert.equal(e1.conferido_ate, '2026-10-17')
  const r = proximaLeitura(e1, CFG, '2026-10-20', Date.parse('2026-10-20T14:02:00Z'), [null])!
  assert.equal(r.frente, 'revisao')
  assert.equal(r.cursor.ini, '2026-09-15')
  let e2 = aposLeitura(r.estado, 'revisao', 1, [null], CFG, '2026-10-20T14:03:00Z') // 15/09–14/10
  e2 = aposLeitura(e2, 'revisao', 1, [null], CFG, '2026-10-20T14:04:00Z') // 15/10–18/10
  assert.equal(e2.revisao.cursor, null)
  assert.equal(e2.conferido_ate, '2026-10-18')
})

test('cobertura da loja 5 com o espelho desligado: só até o conferido (13/10), com aviso', () => {
  const c = coberturaDoEstado(lerEstado(LOJA5), false)!
  assert.deepEqual(c, { desde: '2026-09-12', ate: '2026-10-13', lidoAte: '2026-10-16', conferidoAte: '2026-10-13', ligado: false })
  assert.match(avisoCoberturaKardex(c, '2026-10-16')!, /desligado.*13\/10\/2026.*14\/10\/2026 a 16\/10\/2026/)
  assert.equal(avisoCoberturaKardex(c, '2026-10-13'), null)
})

test('cobertura com o espelho ligado: usa o lido e avisa o trecho ainda não relido', () => {
  const c = coberturaDoEstado(lerEstado(LOJA5), true)!
  assert.equal(c.ate, '2026-10-16')
  assert.match(avisoCoberturaKardex(c, '2026-10-16')!, /14\/10\/2026 a 16\/10\/2026.*ainda não foi relido/)
  assert.match(avisoCoberturaKardex(c, '2026-10-20')!, /lido só até 16\/10\/2026/)
  assert.equal(coberturaDoEstado(estadoInicial(), true), null)
  assert.equal(avisoCoberturaKardex(null, '2026-10-20'), null)
})

test('conferidoAte de estado sem revisão = véspera do início da recente; nunca passa do lido', () => {
  const e: EstadoFrentes = { ...estadoInicial(), recente: { cursor: null, coberto_ate: '2026-10-20', concluido_em: null, desde: '2026-10-19' } }
  assert.equal(conferidoAte(e), '2026-10-18')
  assert.equal(conferidoAte({ ...e, conferido_ate: '2026-10-25' }), '2026-10-20')
  assert.equal(conferidoAte(estadoInicial()), null)
})
