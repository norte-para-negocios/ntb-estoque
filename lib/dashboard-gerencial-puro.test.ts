import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rotuloProdutoAgregado } from './dashboard-gerencial-puro.ts'

const nomes = new Map([[8000000001, 'Moqueca de Peixe'], [42, 'Chopp']])

test('rotuloProdutoAgregado: código com cadastro vira o nome', () => {
  assert.equal(rotuloProdutoAgregado('8000000001', nomes), 'Moqueca de Peixe')
  assert.equal(rotuloProdutoAgregado(42, nomes), 'Chopp')
})

test('rotuloProdutoAgregado: código sem cadastro mostra o código, nunca NaN', () => {
  assert.equal(rotuloProdutoAgregado('777', nomes), 'Sem cadastro (777)')
})

test('rotuloProdutoAgregado: item sem código (null, "null", vazio, texto) = "Sem cadastro"', () => {
  for (const r of [null, undefined, 'null', '', '  ', 'abc']) {
    const rot = rotuloProdutoAgregado(r as string | null, nomes)
    assert.ok(!rot.includes('NaN'), `NaN para ${String(r)}`)
    assert.equal(rot, r === 'abc' ? 'Sem cadastro (abc)' : 'Sem cadastro')
  }
})
