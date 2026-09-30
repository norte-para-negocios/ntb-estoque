import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarObsTransferencia, limparObservacao } from './transferencia-obs.ts'

const carimbo = 'NTB Estoque · Carlos Marinho'

test('sem observação: só o carimbo (como sempre foi)', () => {
  assert.equal(montarObsTransferencia(carimbo, null, null), carimbo)
  assert.equal(montarObsTransferencia(carimbo, '  ', ''), carimbo)
})

test('motivo do item vem primeiro, depois a observação geral e o carimbo', () => {
  assert.equal(
    montarObsTransferencia(carimbo, 'Avarias do bar', 'Garrafa quebrada'),
    'Garrafa quebrada · Avarias do bar · NTB Estoque · Carlos Marinho'
  )
})

test('só observação geral', () => {
  assert.equal(montarObsTransferencia(carimbo, 'Vencido', null), 'Vencido · NTB Estoque · Carlos Marinho')
})

test('texto longo é cortado sem perder o carimbo', () => {
  const r = montarObsTransferencia(carimbo, null, 'x'.repeat(900))
  assert.ok(r.length <= 500)
  assert.ok(r.endsWith(carimbo))
})

test('limparObservacao: tira espaços e quebra de linha, vazio vira null', () => {
  assert.equal(limparObservacao('  Garrafa\n quebrada  '), 'Garrafa quebrada')
  assert.equal(limparObservacao('   '), null)
  assert.equal(limparObservacao(null), null)
  assert.equal(limparObservacao('a'.repeat(400))?.length, 300)
})
