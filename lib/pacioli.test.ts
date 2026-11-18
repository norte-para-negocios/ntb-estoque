import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pacioliBloqueadoNoAmbiente } from './pacioli.ts'

test('produção (sem trava, NODE_ENV production): Pacioli liberado', () => {
  assert.equal(pacioliBloqueadoNoAmbiente({ NODE_ENV: 'production' }), false)
  assert.equal(pacioliBloqueadoNoAmbiente({}), false)
})

test('cópia local de teste (NTB_OMIE_BLOQUEADO=1): bloqueado, mesmo em production', () => {
  assert.equal(pacioliBloqueadoNoAmbiente({ NTB_OMIE_BLOQUEADO: '1', NODE_ENV: 'production' }), true)
})

test('next dev: bloqueado', () => {
  assert.equal(pacioliBloqueadoNoAmbiente({ NODE_ENV: 'development' }), true)
})

test('NTB_PACIOLI_BLOQUEADO=1 bloqueia; NTB_PACIOLI_LIBERADO=1 reabre de propósito', () => {
  assert.equal(pacioliBloqueadoNoAmbiente({ NTB_PACIOLI_BLOQUEADO: '1', NODE_ENV: 'production' }), true)
  assert.equal(pacioliBloqueadoNoAmbiente({ NODE_ENV: 'development', NTB_PACIOLI_LIBERADO: '1' }), false)
  assert.equal(pacioliBloqueadoNoAmbiente({ NTB_OMIE_BLOQUEADO: '1', NTB_PACIOLI_LIBERADO: '1' }), false)
})
