import test from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error: o node --test (type stripping) exige a extensão .ts; o tsc do Next não a aceita
import { gravadosDe } from './assinaturas-puro.ts'

test('erro de leitura cai no padrão', () => {
  assert.deepEqual(gravadosDe(null, { message: 'relation does not exist' }), {})
})
test('ignora módulo ou estado desconhecido', () => {
  assert.deepEqual(gravadosDe([{ modulo_id: 'erp', estado: 'suspenso' }, { modulo_id: 'x', estado: 'ativo' }, { modulo_id: 'cozinha', estado: 'talvez' }], null), { erp: 'suspenso' })
})
