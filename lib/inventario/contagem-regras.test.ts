import { test } from 'node:test'
import assert from 'node:assert/strict'
import { precisaEnviar, avisoConclusaoInventario } from './contagem-regras.ts'

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

test('F-17: concluir com itens em erro avisa em alerta, sem dizer "enviado ao Omie"', () => {
  const a = avisoConclusaoInventario({ proprio: false, comErro: 4 })
  assert.equal(a.tipo, 'warning')
  assert.equal(a.titulo, 'Finalizado, mas 4 itens não foram ao Omie')
  assert.doesNotMatch(a.titulo, /enviado ao Omie/)
  assert.equal(avisoConclusaoInventario({ proprio: false, comErro: 1 }).titulo, 'Finalizado, mas 1 item não foi ao Omie')
  assert.equal(avisoConclusaoInventario({ proprio: true, comErro: 2 }).titulo, 'Concluído, mas 2 itens não foram lançados')
})
test('F-17: sem erro o aviso segue verde como antes', () => {
  assert.deepEqual(avisoConclusaoInventario({ proprio: false, comErro: 0 }), { tipo: 'success', titulo: 'Inventário enviado ao Omie' })
  assert.deepEqual(avisoConclusaoInventario({ proprio: true, comErro: 0 }), { tipo: 'success', titulo: 'Inventário concluído' })
  assert.equal(avisoConclusaoInventario({ proprio: false, comErro: undefined }).tipo, 'success')
})
