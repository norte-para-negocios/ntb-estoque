import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validarLinhas, opIdDe, MAX_LINHAS } from './robo.ts'

const base = { lote: 'L1', modulo: 'faxina', acao: 'ajuste', status: 'ok', origem_ts: '2026-10-08T15:00:00Z' }

test('aceita linha mínima e normaliza vazios', () => {
  const r = validarLinhas({ linhas: [base] })
  assert.ok(r.ok)
  if (r.ok) {
    assert.equal(r.linhas[0].produto_cod, '')
    assert.equal(r.linhas[0].omie_ref, '')
    assert.equal(r.linhas[0].data_ref, '2026-10-08')
  }
})

test('data_ref default usa horário de Brasília', () => {
  const r = validarLinhas({ linhas: [{ ...base, origem_ts: '2026-10-09T01:00:00Z' }] })
  assert.ok(r.ok)
  if (r.ok) assert.equal(r.linhas[0].data_ref, '2026-10-08')
})

test('rejeita módulo/status/data inválidos e aponta o índice', () => {
  const r = validarLinhas({ linhas: [base, { ...base, modulo: 'x', status: 'y', data_ref: '2026-02-31' }] })
  assert.ok(!r.ok)
  if (!r.ok) assert.ok(r.erros.every((e) => e.startsWith('linhas[1]')) && r.erros.length === 3)
})

test('limites: vazio e acima de 500', () => {
  assert.ok(!validarLinhas({ linhas: [] }).ok)
  assert.ok(!validarLinhas({ linhas: Array(MAX_LINHAS + 1).fill(base) }).ok)
  assert.ok(validarLinhas({ linhas: Array(MAX_LINHAS).fill(base) }).ok)
  assert.ok(!validarLinhas(null).ok)
})

test('ignora loja_id enviado (a loja vem da chave)', () => {
  const r = validarLinhas({ linhas: [{ ...base, loja_id: 999 }] })
  assert.ok(r.ok)
  if (r.ok) assert.equal('loja_id' in r.linhas[0], false)
})

test('deduplica chave repetida no mesmo envio (última vence)', () => {
  const r = validarLinhas({ linhas: [{ ...base, motivo: 'a' }, { ...base, motivo: 'b' }] })
  assert.ok(r.ok)
  if (r.ok) { assert.equal(r.linhas.length, 1); assert.equal(r.linhas[0].motivo, 'b') }
})

test('números como string são rejeitados', () => {
  assert.ok(!validarLinhas({ linhas: [{ ...base, quantidade: '3' }] }).ok)
})

test('opIdDe', () => {
  assert.equal(opIdDe({ op_id: 12 }), 12)
  assert.equal(opIdDe({ op_id: '12' }), null)
  assert.equal(opIdDe(null), null)
})

import { ligarRoboAosProdutos } from './robo.ts'
test('robô ligado aos produtos pelo código ou pelo codigo_produto', () => {
  const m = ligarRoboAosProdutos([{ produto_cod: '80052' }, { produto_cod: '2459921734' }, { produto_cod: '' }, { produto_cod: 'xx' }], new Map([['80052', 10], ['2459921734', 2459921734]]))
  assert.deepEqual([...m.entries()], [[10, [0]], [2459921734, [1]]])
})
