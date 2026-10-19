import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tabelaAusente } from './tabela-ausente.ts'

test('tabelaAusente: Postgres (42P01) e PostgREST (PGRST205)', () => {
  assert.equal(tabelaAusente({ code: '42P01' }), true)
  assert.equal(tabelaAusente({ code: 'PGRST205' }), true)
  assert.equal(tabelaAusente({ code: '42501' }), false)
  assert.equal(tabelaAusente(null), false)
})
