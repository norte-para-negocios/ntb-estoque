import { test } from 'node:test'
import assert from 'node:assert/strict'
import { paginasEmOndas } from './paginas-em-ondas.ts'

const fonte = (total: number, falharNa?: number) => {
  const chamadas: number[] = []
  const buscar = async (p: number) => {
    chamadas.push(p)
    if (p === falharNa) return { data: null, error: { message: 'timeout' } }
    const ini = p * 10
    return { data: Array.from({ length: Math.max(0, Math.min(10, total - ini)) }, (_, i) => ini + i), error: null }
  }
  return { buscar, chamadas }
}

test('junta todas as páginas em ordem, em ondas paralelas', async () => {
  const f = fonte(35)
  const r = await paginasEmOndas(f.buscar, 10, 3)
  assert.deepEqual(r.linhas, Array.from({ length: 35 }, (_, i) => i))
  assert.equal(r.falhou, false)
  assert.deepEqual(f.chamadas.slice(0, 3), [0, 1, 2])
})

test('total múltiplo exato da página: para na página vazia', async () => {
  const f = fonte(30)
  const r = await paginasEmOndas(f.buscar, 10, 4)
  assert.equal(r.linhas.length, 30)
})

test('erro numa página: devolve o que leu antes dela e marca falhou', async () => {
  const f = fonte(50, 2)
  const r = await paginasEmOndas(f.buscar, 10, 3)
  assert.equal(r.falhou, true)
  assert.deepEqual(r.linhas, Array.from({ length: 20 }, (_, i) => i))
})
