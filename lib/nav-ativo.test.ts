import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hrefAtivo } from './nav-ativo.ts'

test('rota mais específica vence', () => {
  assert.equal(hrefAtivo('/estoque/saude', ['/estoque', '/estoque/saude']), '/estoque/saude')
  assert.equal(hrefAtivo('/estoque/saude/x', ['/estoque/saude', '/estoque']), '/estoque/saude')
})
test('subrota sem item próprio cai no pai', () => {
  assert.equal(hrefAtivo('/estoque/produto/1', ['/estoque', '/estoque/saude']), '/estoque')
  assert.equal(hrefAtivo('/estoque', ['/estoque', '/estoque/saude']), '/estoque')
})
test('prefixo sem barra não casa', () => {
  assert.equal(hrefAtivo('/estoquex', ['/estoque']), null)
  assert.equal(hrefAtivo('/', ['/home']), null)
})
