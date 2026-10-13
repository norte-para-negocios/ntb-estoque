import { test } from 'node:test'
import assert from 'node:assert/strict'
import { valorDoAjuste, custoForaDoNormal, ROTULO_ORIGEM_AJUSTE, ROTULO_TIPO_AJUSTE } from './ajustes-tela-puro.ts'

test('valorDoAjuste: |quantidade| x custo; contagem (SLD) não é movimento e vale 0', () => {
  assert.equal(valorDoAjuste({ tipo: 'ENT', quantidade: 3, custoUnit: 2.5 }), 7.5)
  assert.equal(valorDoAjuste({ tipo: 'SAI', quantidade: -4, custoUnit: 2 }), 8)
  assert.equal(valorDoAjuste({ tipo: 'SLD', quantidade: 10, custoUnit: 5 }), 0)
  assert.equal(valorDoAjuste({ tipo: 'ENT', quantidade: 3, custoUnit: null }), 0)
})

test('custoForaDoNormal: R$ 1.000 ou mais; 20x acima ou abaixo do custo médio atual', () => {
  assert.equal(custoForaDoNormal(1000, 900), 'alto')
  assert.equal(custoForaDoNormal(40, 2), 'vezes')
  assert.equal(custoForaDoNormal(0.1, 2), 'vezes')
  assert.equal(custoForaDoNormal(30, 2), null)
  assert.equal(custoForaDoNormal(500, 0), null)
  assert.equal(custoForaDoNormal(500, null), null)
  assert.equal(custoForaDoNormal(null, 2), null)
  assert.equal(custoForaDoNormal(0, 2), null)
})

test('rótulos de origem e tipo', () => {
  for (const o of ['app', 'script', 'pdv', 'api', 'omie']) assert.ok(ROTULO_ORIGEM_AJUSTE[o])
  assert.equal(ROTULO_TIPO_AJUSTE.SLD, 'Contagem (inventário)')
})
