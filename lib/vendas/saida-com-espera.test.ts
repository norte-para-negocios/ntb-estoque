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
