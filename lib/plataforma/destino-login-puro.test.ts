import test from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error: o node --test (type stripping) exige a extensão .ts; o tsc do Next não a aceita
import { destinoDoLogin } from './destino-login-puro.ts'

test('só /porta é aceito como destino', () => {
  assert.equal(destinoDoLogin('/porta'), '/porta')
  for (const v of [null, undefined, '', '/home', '/porta/', '/porta?x=1', 'https://evil.com', '//evil.com', '/PORTA', ' /porta']) {
    assert.equal(destinoDoLogin(v), '/home')
  }
})
