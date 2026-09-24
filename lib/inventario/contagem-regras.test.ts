import { test } from 'node:test'
import assert from 'node:assert/strict'
import { precisaEnviar } from './contagem-regras.ts'

test('não reenvia quantidade igual de item já concluído', () => {
  assert.equal(precisaEnviar({ quan: 5, status: 'Concluido' }, 5), false)
})
test('não reenvia campo vazio que já estava vazio', () => {
  assert.equal(precisaEnviar({ quan: null, status: 'Vazio' }, null), false)
})
test('reenvia quando a quantidade muda', () => {
  assert.equal(precisaEnviar({ quan: 5, status: 'Concluido' }, 6), true)
})
test('reenvia mesma quantidade se o item não está concluído (Erro/Sem CMC/Iniciado)', () => {
  assert.equal(precisaEnviar({ quan: 5, status: 'Erro' }, 5), true)
  assert.equal(precisaEnviar({ quan: 5, status: 'Sem CMC' }, 5), true)
})
test('item desconhecido envia', () => {
  assert.equal(precisaEnviar(undefined, 3), true)
})
