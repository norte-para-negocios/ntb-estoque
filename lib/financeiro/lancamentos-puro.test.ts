import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validarLancamento, validarTransferencia, saldoConsolidadoCent } from './lancamentos-puro.ts'

const hoje = '2026-11-05'

test('validarLancamento: tipo, valor, data não futura, categoria do mesmo sentido (saída = despesa, entrada = receita)', () => {
  const ok = { tipo: 'saida' as const, valorCent: 150_00, data: '2026-11-04', hoje, categoriaTipo: 'despesa' as const, descricao: 'Gás' }
  assert.equal(validarLancamento(ok), null)
  assert.equal(validarLancamento({ ...ok, tipo: 'entrada', categoriaTipo: 'receita' }), null)
  assert.match(validarLancamento({ ...ok, valorCent: 0 }) ?? '', /valor/)
  assert.match(validarLancamento({ ...ok, data: '2026-11-06' }) ?? '', /futura/)
  assert.match(validarLancamento({ ...ok, categoriaTipo: 'receita' }) ?? '', /despesa/)
  assert.match(validarLancamento({ ...ok, tipo: 'entrada' }) ?? '', /receita/)
  assert.match(validarLancamento({ ...ok, categoriaTipo: null }) ?? '', /categoria/)
  assert.match(validarLancamento({ ...ok, descricao: ' ' }) ?? '', /descrição/)
})

test('validarTransferencia: contas diferentes, valor, data não futura', () => {
  const ok = { origemId: 1, destinoId: 2, valorCent: 500_00, data: hoje, hoje }
  assert.equal(validarTransferencia(ok), null)
  assert.match(validarTransferencia({ ...ok, destinoId: 1 }) ?? '', /mesma conta/)
  assert.match(validarTransferencia({ ...ok, origemId: 0 }) ?? '', /origem/)
  assert.match(validarTransferencia({ ...ok, destinoId: 0 }) ?? '', /destino/)
  assert.match(validarTransferencia({ ...ok, valorCent: -1 }) ?? '', /valor/)
  assert.match(validarTransferencia({ ...ok, data: '2026-12-01' }) ?? '', /futura/)
})

test('saldoConsolidadoCent: transferência e o estorno dela não mudam o consolidado', () => {
  const base = [{ tipo: 'entrada' as const, valorCent: 1000_00 }]
  const transf = [{ tipo: 'saida' as const, valorCent: 300_00 }, { tipo: 'entrada' as const, valorCent: 300_00 }]
  const estorno = [{ tipo: 'entrada' as const, valorCent: 300_00 }, { tipo: 'saida' as const, valorCent: 300_00 }]
  assert.equal(saldoConsolidadoCent(base), 1000_00)
  assert.equal(saldoConsolidadoCent([...base, ...transf]), 1000_00)
  assert.equal(saldoConsolidadoCent([...base, ...transf, ...estorno]), 1000_00)
})
