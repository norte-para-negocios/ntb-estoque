import { test } from 'node:test'
import assert from 'node:assert/strict'
import { comEsperaDeCmc } from './saida-com-espera.ts'

test('Sem CMC logo após a OP: espera e tenta de novo até concluir', async () => {
  const respostas = ['Sem CMC', 'Sem CMC', 'Concluido']
  const esperas: number[] = []
  const r = await comEsperaDeCmc(async () => ({ status: respostas.shift()! }), { esperasMs: [10, 20, 30], dormir: async (ms) => { esperas.push(ms) } })
  assert.equal(r.status, 'Concluido')
  assert.deepEqual(esperas, [10, 20])
})

test('concluiu de primeira: não espera nada', async () => {
  const esperas: number[] = []
  const r = await comEsperaDeCmc(async () => ({ status: 'Concluido' }), { esperasMs: [10], dormir: async (ms) => { esperas.push(ms) } })
  assert.equal(r.status, 'Concluido')
  assert.equal(esperas.length, 0)
})

test('erro que não é CMC: não fica tentando', async () => {
  let chamadas = 0
  const r = await comEsperaDeCmc(async () => { chamadas++; return { status: 'Erro', erro: 'x' } }, { esperasMs: [10, 20], dormir: async () => {} })
  assert.equal(r.status, 'Erro')
  assert.equal(chamadas, 1)
})

test('esgotou as esperas: devolve Sem CMC (o cron assume)', async () => {
  let chamadas = 0
  const r = await comEsperaDeCmc(async () => { chamadas++; return { status: 'Sem CMC' } }, { esperasMs: [1, 1], dormir: async () => {} })
  assert.equal(r.status, 'Sem CMC')
  assert.equal(chamadas, 3)
})

import { repetirSeCalculoPendente, ehCalculoPendente } from './saida-com-espera.ts'

test('conclusão da OP: "movimentos pendentes de cálculo" espera e tenta de novo', async () => {
  let n = 0
  const esperas: number[] = []
  await repetirSeCalculoPendente(async () => {
    n++
    if (n < 3) throw new Error('ERROR: O seguinte produto da estrutura possui movimentos de estoque pendentes de cálculo em 29/09/2026')
  }, { esperasMs: [5, 6, 7], dormir: async (ms) => { esperas.push(ms) } })
  assert.equal(n, 3)
  assert.deepEqual(esperas, [5, 6])
})

test('conclusão da OP: outro erro sobe na hora', async () => {
  let n = 0
  await assert.rejects(repetirSeCalculoPendente(async () => { n++; throw new Error('Consumo redundante') }, { esperasMs: [1], dormir: async () => {} }))
  assert.equal(n, 1)
})

test('conclusão da OP: esgotou as esperas, sobe o erro', async () => {
  await assert.rejects(repetirSeCalculoPendente(async () => { throw new Error('ainda não foi concluído o cálculo do saldo de estoque e CMC do produto') }, { esperasMs: [1, 1], dormir: async () => {} }))
  assert.ok(ehCalculoPendente('movimentos de estoque pendentes de cálculo'))
})
