import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  aposFrente, classificarParada, guardaVazia, lerGuardaFrente, lerGuardaLoja, minutosDePausa, ordemRodizio, pausadoAgora,
  PAUSA_LOJA_MIN, TETO_FALHAS,
} from './espelho-guarda.ts'

const T = Date.parse('2026-10-20T15:00:00Z')

test('classificarParada pelo parouPor dos crons', () => {
  assert.equal(classificarParada(null), null)
  assert.equal(classificarParada('limite do Omie: MISUSE_API_PROCESS'), 'limite')
  assert.equal(classificarParada('erro do Omie: SOAP-ERROR'), 'erro')
  assert.equal(classificarParada('erro interno: kardex_omie: timeout'), 'erro')
  assert.equal(classificarParada('trava (outro ciclo em andamento)'), null)
  assert.equal(classificarParada('intervalo de 30 min'), null)
  assert.equal(classificarParada('filtro de data ignorado pelo Omie: 3 ajuste(s) fora'), null)
})

test('espera cresce 10, 20, 40, 80 e no teto vira 24 h', () => {
  assert.deepEqual([1, 2, 3, 4].map(minutosDePausa), [10, 20, 40, 80])
  assert.equal(minutosDePausa(TETO_FALHAS), 24 * 60)
  assert.equal(minutosDePausa(TETO_FALHAS + 3), 24 * 60)
})

test('no máximo TETO_FALHAS erros por frente em 24 h, longe dos 10 do bloqueio do Omie', () => {
  let g = guardaVazia()
  let t = T
  let erros = 0
  while (t < T + 24 * 3_600_000) {
    if (!pausadoAgora(g.pausado_ate, t)) { g = aposFrente(g, 'erro', 'erro do Omie: x', t).guarda; erros++ }
    t += 10 * 60_000 // um ciclo do cron
  }
  assert.equal(erros, TETO_FALHAS)
})

test('erro de limite pausa a loja inteira por 60 min; erro comum só a frente', () => {
  const lim = aposFrente(guardaVazia(), 'limite', 'limite do Omie: bloqueada', T)
  assert.equal(lim.pausaLojaAte, new Date(T + PAUSA_LOJA_MIN * 60_000).toISOString())
  assert.equal(lim.guarda.falhas, 1)
  const err = aposFrente(guardaVazia(), 'erro', 'erro do Omie: x', T)
  assert.equal(err.pausaLojaAte, null)
  assert.equal(err.guarda.pausado_ate, new Date(T + 10 * 60_000).toISOString())
})

test('sucesso zera a contagem e só grava quando havia algo a zerar', () => {
  const ok = aposFrente(guardaVazia(), null, null, T)
  assert.equal(ok.mudou, false)
  const zerou = aposFrente({ falhas: 3, pausado_ate: '2026-10-20T14:00:00Z', ultimo_erro: 'x' }, null, null, T)
  assert.equal(zerou.mudou, true)
  assert.deepEqual(zerou.guarda, guardaVazia())
})

test('lerGuarda tolera lixo', () => {
  assert.deepEqual(lerGuardaFrente(null), guardaVazia())
  assert.deepEqual(lerGuardaFrente({ falhas: 'abc', pausado_ate: 3 }), guardaVazia())
  assert.deepEqual(lerGuardaLoja({ pausado_ate: '2026-10-20T16:00:00Z' }), { pausado_ate: '2026-10-20T16:00:00Z', motivo: null })
})

test('pausadoAgora', () => {
  assert.equal(pausadoAgora(null, T), false)
  assert.equal(pausadoAgora('2026-10-20T15:00:01Z', T), true)
  assert.equal(pausadoAgora('2026-10-20T15:00:00Z', T), false)
})

test('rodízio gira uma posição por ciclo de 10 min e cobre todas as lojas', () => {
  const lojas = [2, 3, 6]
  const c0 = Math.floor(T / 600_000) * 600_000
  const ordens = [0, 1, 2, 3].map((k) => ordemRodizio(lojas, c0 + k * 600_000))
  assert.deepEqual(new Set(ordens.slice(0, 3).map((o) => o[0])), new Set(lojas))
  assert.deepEqual(ordens[3], ordens[0])
  for (const o of ordens) assert.deepEqual([...o].sort(), lojas)
  assert.deepEqual(ordemRodizio([5], T), [5])
  assert.deepEqual(ordemRodizio([], T), [])
})
