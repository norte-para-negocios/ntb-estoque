import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chaveIdempotenciaValida } from './compra-manual-puro.ts'

test('chaveIdempotenciaValida', () => {
  assert.equal(chaveIdempotenciaValida('3F6C2A9E-1B7D-4C55-9A0E-2D8F4B6C1E07'), '3f6c2a9e-1b7d-4c55-9a0e-2d8f4b6c1e07')
  assert.equal(chaveIdempotenciaValida(''), null); assert.equal(chaveIdempotenciaValida('abc'), null); assert.equal(chaveIdempotenciaValida(42), null)
})
