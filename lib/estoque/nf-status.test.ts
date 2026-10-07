import { test } from 'node:test'
import assert from 'node:assert/strict'
import { statusNF, statusBateFiltro } from '../nf-status.ts'

test('nota do Omie: comportamento de sempre (regressão)', () => {
  assert.deepEqual(statusNF('60', { infoCadastro: { cRecebido: 'S' } }), { label: 'Concluída', tom: 'ok' })
  assert.deepEqual(statusNF('40', {}), { label: 'Pendente (etapa 40)', tom: 'warn' })
  assert.deepEqual(statusNF('60', { infoCadastro: { cCancelada: 'S' } }), { label: 'Cancelada', tom: 'err' })
  assert.deepEqual(statusNF(null, null), { label: 'Pendente (etapa ?)', tom: 'warn' })
})

test('nota da SEFAZ: situação da conferência vira o rótulo; lançada continua Concluída; cancelada vence', () => {
  assert.equal(statusNF('40', { sefaz: { situacao: 'a_conferir' } }).label, 'A conferir')
  assert.equal(statusNF('40', { sefaz: { situacao: 'resumo' } }).label, 'Recebida (aguardando XML)')
  assert.equal(statusNF('40', { sefaz: { situacao: 'divergente' } }).tom, 'err')
  assert.equal(statusNF('60', { sefaz: { situacao: 'lancada' } }).label, 'Concluída')
  assert.equal(statusNF('40', { infoCadastro: { cCancelada: 'S' }, sefaz: { situacao: 'a_conferir' } }).label, 'Cancelada')
  assert.ok(statusBateFiltro({ c_etapa: '40', full_object: { sefaz: { situacao: 'parcial' } } }, 'PENDENTE'))
  assert.ok(!statusBateFiltro({ c_etapa: '60', full_object: { sefaz: { situacao: 'lancada' } } }, 'PENDENTE'))
})
