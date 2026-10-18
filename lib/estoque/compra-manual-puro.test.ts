import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chaveIdempotenciaValida, novaChaveIdempotencia } from './compra-manual-puro.ts'

test('chaveIdempotenciaValida', () => {
  assert.equal(chaveIdempotenciaValida('3F6C2A9E-1B7D-4C55-9A0E-2D8F4B6C1E07'), '3f6c2a9e-1b7d-4c55-9a0e-2d8f4b6c1e07')
  assert.equal(chaveIdempotenciaValida(''), null); assert.equal(chaveIdempotenciaValida('abc'), null); assert.equal(chaveIdempotenciaValida(42), null)
})

test('novaChaveIdempotencia funciona sem crypto.randomUUID (página aberta em http na rede local)', () => {
  const semRandomUUID = { getRandomValues: (a: Uint8Array) => { for (let i = 0; i < a.length; i++) a[i] = (i * 37) & 255; return a } }
  const k = novaChaveIdempotencia(semRandomUUID)
  assert.equal(chaveIdempotenciaValida(k), k)
  assert.ok(chaveIdempotenciaValida(novaChaveIdempotencia(undefined)))
})
