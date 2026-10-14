import { test } from 'node:test'
import assert from 'node:assert/strict'
import { temPermissao } from './permissao-puro.ts'

test('temPermissao: curinga do admin, nome exato, ausente', () => {
  assert.equal(temPermissao(new Set(['*']), 'Movimentacoes'), true)
  assert.equal(temPermissao(new Set(['Movimentacoes']), 'Movimentacoes'), true)
  assert.equal(temPermissao(new Set(['Movimentacoes']), 'Movimentacoes - Criar'), false)
  assert.equal(temPermissao(new Set(), 'Movimentacoes'), false)
})
