import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rankear, ordenarRanking, filtrarPorNome, resumir, serieDiaria, posicaoNoRanking } from './faturamento-itens.ts'

const L = (o: Partial<Parameters<typeof rankear>[0][number]>) => ({
  dia: '2026-10-01', cupom: 1, idProduto: 1, produto: 'Moqueca', tipoCod: '04', tipo: 'Produto acabado',
  familia: 'Pratos', quant: 1, valor: 100, ...o,
})

const linhas = [
  L({ cupom: 1, idProduto: 1, produto: 'Moqueca', quant: 2, valor: 200 }),
  L({ cupom: 2, idProduto: 1, produto: 'Moqueca (nome velho)', quant: 1, valor: 100, dia: '2026-10-02' }),
  L({ cupom: 2, idProduto: 2, produto: 'Casquinha de siri', familia: 'Entradas', quant: 3, valor: 90, dia: '2026-10-02' }),
  L({ cupom: 3, idProduto: null, produto: 'Produto não identificado', tipoCod: '', tipo: 'Não classificado', familia: 'Sem família', quant: 1, valor: 10, dia: '2026-10-03' }),
]

test('rankear por produto agrupa por id (não por nome), soma e conta cupons', () => {
  const r = rankear(linhas, 'produto')
  assert.equal(r.length, 3)
  assert.equal(r[0].rotulo, 'Moqueca')
  assert.equal(r[0].valor, 300)
  assert.equal(r[0].quant, 3)
  assert.equal(r[0].cupons, 2)
  assert.equal(r[0].pct, 75)
  assert.equal(r[1].rotulo, 'Casquinha de siri')
  assert.equal(r[2].rotulo, 'Produto não identificado')
})

test('rankear por família e por tipo', () => {
  const f = rankear(linhas, 'familia')
  assert.deepEqual(f.map((x) => [x.rotulo, x.valor]), [['Pratos', 300], ['Entradas', 90], ['Sem família', 10]])
  const t = rankear(linhas, 'tipo')
  assert.deepEqual(t.map((x) => [x.rotulo, x.valor]), [['Produto acabado', 390], ['Não classificado', 10]])
})

test('ordenarRanking: mais/menos vendidos por valor ou quantidade', () => {
  const r = rankear(linhas, 'produto')
  assert.equal(ordenarRanking(r, 'valor', 'mais')[0].rotulo, 'Moqueca')
  assert.equal(ordenarRanking(r, 'valor', 'menos')[0].rotulo, 'Produto não identificado')
  assert.equal(ordenarRanking(r, 'quant', 'mais')[0].rotulo, 'Casquinha de siri') // 3 un cada; empate desempata pelo nome
  assert.equal(ordenarRanking(r, 'quant', 'menos')[0].rotulo, 'Produto não identificado')
})

test('filtrarPorNome ignora acento e caixa', () => {
  const r = rankear(linhas, 'produto')
  assert.deepEqual(filtrarPorNome(r, 'SIRI').map((x) => x.rotulo), ['Casquinha de siri'])
  assert.deepEqual(filtrarPorNome(r, 'nao identificado').map((x) => x.rotulo), ['Produto não identificado'])
  assert.equal(filtrarPorNome(r, '').length, 3)
})

test('resumir: faturado, cupons distintos, ticket, melhor dia', () => {
  const k = resumir(linhas)
  assert.equal(k.faturado, 400)
  assert.equal(k.cupons, 3)
  assert.equal(k.ticket, 133.33)
  assert.deepEqual(k.melhorDia, { dia: '2026-10-01', valor: 200 })
  assert.equal(k.itens, 7)
})

test('resumir: sem linhas', () => {
  const k = resumir([])
  assert.equal(k.faturado, 0)
  assert.equal(k.ticket, null)
  assert.equal(k.melhorDia, null)
})

test('serieDiaria preenche dias sem venda', () => {
  const s = serieDiaria(linhas, '2026-10-01', '2026-10-04')
  assert.deepEqual(s, [
    { dia: '2026-10-01', valor: 200 },
    { dia: '2026-10-02', valor: 190 },
    { dia: '2026-10-03', valor: 10 },
    { dia: '2026-10-04', valor: 0 },
  ])
})

test('posicaoNoRanking é 1-based e null quando não existe', () => {
  const r = rankear(linhas, 'produto')
  assert.equal(posicaoNoRanking(r, '1'), 1)
  assert.equal(posicaoNoRanking(r, '2'), 2)
  assert.equal(posicaoNoRanking(r, '999'), null)
})
