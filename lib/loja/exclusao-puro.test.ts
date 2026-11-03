import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TABELAS_QUE_IMPEDEM_EXCLUSAO, mensagemDeExclusao } from './exclusao-puro.ts'

test('loja sem nada nas tabelas de histórico pode ser excluída', () => {
  assert.equal(mensagemDeExclusao(TABELAS_QUE_IMPEDEM_EXCLUSAO.map((t) => ({ rotulo: t.rotulo, total: 0 }))), null)
})

test('qualquer movimento, nota, OP ou venda impede, citando o que existe', () => {
  const r = TABELAS_QUE_IMPEDEM_EXCLUSAO.map((t) => ({ rotulo: t.rotulo, total: t.rotulo === 'notas fiscais' || t.rotulo === 'vendas' ? 3 : 0 }))
  const m = mensagemDeExclusao(r)
  assert.ok(m)
  assert.match(m!, /notas fiscais/)
  assert.match(m!, /vendas/)
  assert.match(m!, /desative/i)
})

test('não conseguiu conferir uma tabela: recusa (nunca assume vazio)', () => {
  const m = mensagemDeExclusao([{ rotulo: 'movimentos', total: null }])
  assert.match(m!, /não foi possível conferir/i)
})

test('a lista cobre movimento, nota, OP e venda', () => {
  const rotulos = TABELAS_QUE_IMPEDEM_EXCLUSAO.map((t) => t.rotulo).join('|')
  for (const r of ['movimentos', 'notas fiscais', 'ordens de produção', 'vendas']) assert.match(rotulos, new RegExp(r))
})
