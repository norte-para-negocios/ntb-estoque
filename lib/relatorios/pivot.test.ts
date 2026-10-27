import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pivotar, VAZIO, type Layout, type Linha } from './pivot.ts'

const L = (f: string | null, mes: string, nf: string, v: number, sit = 'Concluído'): Linha => ({ Fornecedor: f, Mês: mes, 'Nota Fiscal': nf, 'Total de Mercadoria': v, Situação: sit })
const dados: Linha[] = [L('A', '2026-09', '1', 100), L('A', '2026-10', '1', 50), L('B', '2026-10', '2', 30), L('A', '2026-10', '3', 20)]
const soma = { campo: 'Total de Mercadoria', agg: 'soma' as const }
const base = (o: Partial<Layout>): Layout => ({ linhas: ['Fornecedor'], colunas: [], medidas: [soma], filtros: {}, ...o })
const k = 'Total de Mercadoria|soma'

test('soma por fornecedor', () => {
  const r = pivotar(dados, base({}))
  assert.deepEqual(r.raizLinhas.filhos.map((n) => [n.rotulo, n.valores[k]]), [['A', 170], ['B', 30]])
  assert.equal(r.total[k], 200)
})

test('linhas aninhadas fornecedor>mes: soma dos filhos = pai', () => {
  const r = pivotar(dados, base({ linhas: ['Fornecedor', 'Mês'] }))
  const a = r.raizLinhas.filhos[0]
  assert.deepEqual(a.filhos.map((n) => [n.rotulo, n.valores[k]]), [['2026-09', 100], ['2026-10', 70]])
  assert.equal(a.filhos.reduce((s, n) => s + n.valores[k], 0), a.valores[k])
})

test('colunas por mes', () => {
  const r = pivotar(dados, base({ colunas: ['Mês'] }))
  assert.deepEqual(r.colunas, ['2026-09', '2026-10'])
  const a = r.raizLinhas.filhos[0]
  assert.equal(a.valores[`2026-09|${k}`], 100)
  assert.equal(a.valores[`2026-10|${k}`], 70)
})

test('contagem_distinta conta notas, nao itens', () => {
  const r = pivotar(dados, base({ medidas: [{ campo: 'Nota Fiscal', agg: 'contagem_distinta' }] }))
  assert.equal(r.raizLinhas.filhos[0].valores['Nota Fiscal|contagem_distinta'], 2)
  assert.equal(r.total['Nota Fiscal|contagem_distinta'], 3)
})

test('media, min, max e contagem', () => {
  const r = pivotar(dados, base({ medidas: [{ campo: 'Total de Mercadoria', agg: 'media' }, { campo: 'Total de Mercadoria', agg: 'min' }, { campo: 'Total de Mercadoria', agg: 'max' }, { campo: 'Total de Mercadoria', agg: 'contagem' }] }))
  const a = r.raizLinhas.filhos[0].valores
  assert.equal(a['Total de Mercadoria|media'], 170 / 3)
  assert.equal(a['Total de Mercadoria|min'], 20)
  assert.equal(a['Total de Mercadoria|max'], 100)
  assert.equal(a['Total de Mercadoria|contagem'], 3)
})

test('filtros excluem linhas', () => {
  const r = pivotar([...dados, L('C', '2026-10', '9', 999, 'Cancelada')], base({ filtros: { Situação: ['Concluído'] } }))
  assert.equal(r.total[k], 200)
  assert.equal(r.raizLinhas.filhos.length, 2)
})

test('nulo vira (vazio)', () => {
  const r = pivotar([L(null, '2026-10', '7', 5)], base({}))
  assert.equal(r.raizLinhas.filhos[0].rotulo, VAZIO)
})

test('entrada vazia nao quebra', () => {
  const r = pivotar([], base({}))
  assert.equal(r.total[k], 0)
  assert.equal(r.raizLinhas.filhos.length, 0)
  assert.deepEqual(r.colunas, [])
})

test('sem linhas escolhidas: so o total', () => {
  const r = pivotar(dados, base({ linhas: [] }))
  assert.equal(r.raizLinhas.filhos.length, 0)
  assert.equal(r.total[k], 200)
})
