import { test } from 'node:test'
import assert from 'node:assert/strict'
import { codIntOPVenda, chaveSaidaVenda, ocorrenciasPorCodigo, decidirOPVenda } from './venda-idempotente.ts'

const REF = '3f6c2a9e-1b7d-4c55-9a0e-2d8f4b6c1e07'

test('código determinístico, ≤ 20, prefixo NTBV', () => {
  const a = codIntOPVenda(REF, 2459363119, 0)
  assert.equal(a, codIntOPVenda(REF.toUpperCase(), 2459363119, 0))
  assert.ok(a.startsWith('NTBV-') && a.length <= 20)
  assert.notEqual(a, codIntOPVenda(REF, 2459363119, 1))
  assert.notEqual(a, codIntOPVenda(REF, 2453427633, 0))
})

test('itens reordenados geram as mesmas chaves', () => {
  const p1 = [{ codigo: 'A' }, { codigo: 'B' }, { codigo: 'A' }], p2 = [{ codigo: 'B' }, { codigo: 'A' }, { codigo: 'A' }]
  assert.deepEqual(ocorrenciasPorCodigo(p1), [0, 0, 1]); assert.deepEqual(ocorrenciasPorCodigo(p2), [0, 0, 1])
})

test('chave da saída ≠ código da OP e cabe no texto', () => {
  const s = chaveSaidaVenda(REF, 2459363119, 0)
  assert.ok(s.startsWith('VND-') && s.length <= 20)
  assert.notEqual(s.slice(4), codIntOPVenda(REF, 2459363119, 0).slice(5))
})

test('decidirOPVenda', () => {
  assert.equal(decidirOPVenda(null), 'incluir')
  assert.equal(decidirOPVenda({ cod_int_op: 'x', n_cod_op: null, estado: 'incluindo' }), 'consultar')
  assert.equal(decidirOPVenda({ cod_int_op: 'x', n_cod_op: 123, estado: 'criada' }), 'concluir')
  assert.equal(decidirOPVenda({ cod_int_op: 'x', n_cod_op: 123, estado: 'concluida' }), 'pronta')
  assert.equal(decidirOPVenda({ cod_int_op: 'x', n_cod_op: 123, estado: 'estornada' }), 'pronta')
})
