import { test } from 'node:test'
import assert from 'node:assert/strict'
import { valorDoAjuste } from './ajuste-valor-puro.ts'

test('valorDoAjuste: contagem (SLD) fica fora do R$', () => {
  assert.deepEqual(valorDoAjuste({ tipo: 'SLD', quan: 2720000, valor: 24.9 }), { incluir: false, qtde: 0, valor: 0, valorOmie: 0, foraDoNormal: false })
})

test('valorDoAjuste: valor = |quantidade| × custo unitário (antes somava só o unitário)', () => {
  assert.deepEqual(valorDoAjuste({ tipo: 'SAI', quan: -6, valor: '53.63' }), { incluir: true, qtde: 6, valor: 321.78, valorOmie: 321.78, foraDoNormal: false })
  assert.deepEqual(valorDoAjuste({ tipo: 'ENT', quan: 16, valor: 43.86 }, { referencia: 40, limite: 400 }).valor, 701.76)
})

test('valorDoAjuste: custo acima do limite vale o custo normal (Camarão na Tapioca a R$ 716.068 por unidade)', () => {
  const v = valorDoAjuste({ tipo: 'SAI', quan: -2, valor: 716068.4933 }, { referencia: 9.8915, limite: 98.915 })
  assert.equal(v.foraDoNormal, true)
  assert.equal(v.valor, 19.78)
  assert.equal(v.valorOmie, 1432136.99)
})

test('valorDoAjuste: sem custo confiável (só o teto) vale zero e é marcado; sem referência nenhuma não mexe', () => {
  const v = valorDoAjuste({ tipo: 'SAI', quan: -50, valor: 49.75 }, { referencia: null, limite: 1 })
  assert.equal(v.valor, 0)
  assert.equal(v.foraDoNormal, true)
  assert.equal(valorDoAjuste({ tipo: 'SAI', quan: -1, valor: 1e6 }, null).valor, 1e6)
})
