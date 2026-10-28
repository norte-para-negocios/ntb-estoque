// Financeiro A0: quais lojas entram (nunca a 4, nunca teste, só modo Omie; a 7 fora da API por padrão).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listaDeLojas, lojaPodeEspelharFinanceiro, lojasDoFinanceiro } from './lojas.ts'

const loja = (id: number, x: Record<string, unknown> = {}) => ({ id, is_test: false, ativo: true, modo_estoque: 'omie', omie_app_key: 'k', ...x })
const todas = [loja(2), loja(3), loja(4), loja(5), loja(6), loja(7), loja(10, { is_test: true }), loja(15, { modo_estoque: 'proprio' }), loja(16, { ativo: false }), loja(17, { omie_app_key: null })]

test('regra da loja: não exige espelho_completo', () => {
  assert.equal(lojaPodeEspelharFinanceiro(loja(2, { espelho_completo: false })), true)
  assert.equal(lojaPodeEspelharFinanceiro(loja(4)), false)
  assert.equal(lojaPodeEspelharFinanceiro(loja(10, { is_test: true })), false)
  assert.equal(lojaPodeEspelharFinanceiro(loja(15, { modo_estoque: 'proprio' })), false)
})

test('avisos: 2,3,5,6,7; API: sem a 7; a 4 nunca, mesmo listada', () => {
  const r = lojasDoFinanceiro(todas)
  assert.deepEqual(r.avisos.map((l) => l.id), [2, 3, 5, 6, 7])
  assert.deepEqual(r.api.map((l) => l.id), [2, 3, 5, 6])
  const so = lojasDoFinanceiro(todas, { OMIE_FIN_LOJAS: '5, 4,10', OMIE_FIN_API_FORA: '' })
  assert.deepEqual(so.avisos.map((l) => l.id), [5])
  assert.deepEqual(so.api.map((l) => l.id), [5])
  assert.deepEqual(lojasDoFinanceiro(todas, { OMIE_FIN_API_FORA: '3' }).api.map((l) => l.id), [2, 5, 6, 7])
  assert.equal(listaDeLojas('  '), null)
})
