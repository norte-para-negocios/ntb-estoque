import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rankingCompras, matrizCompras, comTipoValor } from './relatorio-compras-visoes.ts'

const L = [
  { rotulo: 'PEIXES', mes: '2026-09', valor: 100 },
  { rotulo: 'PEIXES', mes: '2026-10', valor: 50 },
  { rotulo: 'BEBIDAS', mes: '2026-10', valor: 200 },
  { rotulo: 'Sem classificação', mes: '2026-09', valor: 50 },
]

test('ranking soma os meses, ordena por valor e calcula %', () => {
  const r = rankingCompras(L, (x) => x.toLowerCase())
  assert.deepEqual(r.map((x) => [x.chave, x.rotulo, x.valor]), [['BEBIDAS', 'bebidas', 200], ['PEIXES', 'peixes', 150], ['Sem classificação', 'sem classificação', 50]])
  assert.equal(r[0].pct, 50)
  assert.equal(r.reduce((s, x) => s + x.pct, 0), 100)
})

test('ranking vazio', () => {
  assert.deepEqual(rankingCompras([]), [])
})

test('matriz cobre todos os meses do periodo, corta linhas mas soma tudo', () => {
  const m = matrizCompras(L, '2026-08-15', '2026-10-16', (x) => x, 2)
  assert.deepEqual(m.meses, ['2026-08', '2026-09', '2026-10'])
  assert.equal(m.linhas.length, 2)
  assert.equal(m.total, 400)
  assert.deepEqual(m.totalPorMes, { '2026-08': 0, '2026-09': 150, '2026-10': 250 })
  assert.equal(m.linhas[1].porMes['2026-09'], 100)
  assert.equal(m.linhas[0].pct, 50)
})

test('matriz atravessa a virada do ano', () => {
  assert.deepEqual(matrizCompras([], '2025-11-01', '2026-01-31').meses, ['2025-11', '2025-12', '2026-01'])
})

test('comTipoValor troca o valor pelo de estoque', () => {
  const L = [{ rotulo: 'PEIXES', mes: '2026-10', valor: 3210.9, valor_estoque: 3197.93 }]
  assert.equal(comTipoValor(L, 'estoque')[0].valor, 3197.93)
  assert.equal(comTipoValor(L, 'fiscal')[0].valor, 3210.9)
  assert.equal(rankingCompras(comTipoValor(L, 'estoque'))[0].valor, 3197.93)
})
