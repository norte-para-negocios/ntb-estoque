import { test } from 'node:test'
import assert from 'node:assert/strict'
import { situacaoBate, filtrarNotas, notaParaLinha, itemParaLinha, itensDasNotas, lerOrdem, ordenarNotas, fornecedoresDistintos, type NotaLeve, type ItemCompra } from './notas-compras.ts'
import { rankear, resumir, serieDiaria } from './faturamento-itens.ts'

const N = (o: Partial<NotaLeve>): NotaLeve => ({
  id: 1, dia: '2026-10-01', numero: '100', serie: '1', fornecedor: 'ATACADAO', natureza: 'COMPRA', valor: 100,
  etapa: '60', cancelada: false, manifestada: true, sefazSituacao: null, ...o,
})

const notas = [
  N({ id: 1, dia: '2026-10-01', fornecedor: 'ATACADÃO S.A.', valor: 300, numero: '5531' }),
  N({ id: 2, dia: '2026-10-01', fornecedor: 'Peixaria Mar', valor: 120, etapa: '40', manifestada: false }),
  N({ id: 3, dia: '2026-10-03', fornecedor: 'ATACADÃO S.A.', valor: 80, cancelada: true }),
  N({ id: 4, dia: '2026-10-04', fornecedor: 'Hortifruti Sol', valor: 50, natureza: 'BONIFICACAO' }),
]

test('situação: padrão tira só as canceladas', () => {
  assert.deepEqual(filtrarNotas(notas, {}).map((n) => n.id), [1, 2, 4])
  assert.deepEqual(filtrarNotas(notas, { status: 'TODAS' }).map((n) => n.id), [1, 2, 3, 4])
  assert.deepEqual(filtrarNotas(notas, { status: 'CANCELADA' }).map((n) => n.id), [3])
  assert.deepEqual(filtrarNotas(notas, { status: 'PENDENTE' }).map((n) => n.id), [2])
  assert.deepEqual(filtrarNotas(notas, { status: 'CONCLUIDA' }).map((n) => n.id), [1, 4])
  assert.deepEqual(filtrarNotas(notas, { status: 'C' }).map((n) => n.id), [1, 4])
  assert.deepEqual(filtrarNotas(notas, { status: 'MANIFESTADA' }).map((n) => n.id), [1, 3, 4])
  assert.equal(situacaoBate(N({ etapa: '40' }), '40'), true)
})

test('fornecedor, número e busca ignoram acento e caixa', () => {
  assert.deepEqual(filtrarNotas(notas, { fornecedor: 'atacadao' }).map((n) => n.id), [1])
  assert.deepEqual(filtrarNotas(notas, { fornecedor: 'ATACADÃO S.A.', status: 'TODAS' }).map((n) => n.id), [1, 3])
  assert.deepEqual(filtrarNotas(notas, { numero: '553' }).map((n) => n.id), [1])
  assert.deepEqual(filtrarNotas(notas, { q: 'bonific' }).map((n) => n.id), [4])
  assert.deepEqual(filtrarNotas(notas, { q: 'peixaria' }).map((n) => n.id), [2])
})

test('notas viram ranking de fornecedor, resumo e série do Faturamento', () => {
  const linhas = filtrarNotas(notas, {}).map(notaParaLinha)
  const r = rankear(linhas, 'produto')
  assert.deepEqual(r.map((x) => [x.rotulo, x.valor, x.quant, x.cupons]), [
    ['ATACADÃO S.A.', 300, 1, 1], ['Peixaria Mar', 120, 1, 1], ['Hortifruti Sol', 50, 1, 1],
  ])
  const k = resumir(linhas)
  assert.equal(k.faturado, 470)
  assert.equal(k.cupons, 3)
  assert.equal(k.ticket, 156.67)
  assert.deepEqual(k.melhorDia, { dia: '2026-10-01', valor: 420 })
  assert.deepEqual(serieDiaria(linhas, '2026-10-01', '2026-10-04').map((d) => d.valor), [420, 0, 0, 50])
})

test('itens: só das notas que sobraram e dos tipos/famílias filtrados', () => {
  const I = (o: Partial<ItemCompra>): ItemCompra => ({ notaId: 1, dia: '2026-10-01', idProduto: 10, produto: 'Camarão', tipoCod: '01', tipo: 'MP', familia: 'Pescados', unidade: 'KG', quant: 2, valor: 80, ...o })
  const itens = [I({}), I({ notaId: 1, idProduto: 11, produto: 'Detergente', familia: 'Limpeza', tipoCod: '07' }), I({ notaId: 3 })]
  assert.equal(itensDasNotas(itens, new Set([1, 2]), {}).length, 2)
  assert.deepEqual(itensDasNotas(itens, new Set([1, 2]), { familias: ['Pescados'] }).map((i) => i.produto), ['Camarão'])
  assert.deepEqual(itensDasNotas(itens, new Set([1, 3]), { tipos: ['07'] }).map((i) => i.produto), ['Detergente'])
})

test('ordem: aceita colunas antigas e desempata pelo id', () => {
  assert.deepEqual(lerOrdem(), { ord: 'dia', dir: 'desc' })
  assert.deepEqual(lerOrdem('n_valor_nfe', 'asc'), { ord: 'valor', dir: 'asc' })
  assert.deepEqual(lerOrdem('xyz', 'qualquer'), { ord: 'dia', dir: 'desc' })
  assert.deepEqual(ordenarNotas(notas, 'dia', 'desc').map((n) => n.id), [4, 3, 2, 1])
  assert.deepEqual(ordenarNotas(notas, 'valor', 'desc').map((n) => n.id), [1, 2, 3, 4])
  assert.deepEqual(ordenarNotas(notas, 'fornecedor', 'asc').map((n) => n.id), [3, 1, 4, 2])
  assert.deepEqual(fornecedoresDistintos(notas), ['ATACADÃO S.A.', 'Hortifruti Sol', 'Peixaria Mar'])
})

test('itemParaLinha usa o valor de estoque por padrão', () => {
  const i: ItemCompra = { notaId: 1, dia: '2026-10-13', idProduto: 2657120569, produto: 'Peixe pescada amarela', tipoCod: '01', tipo: 'Matéria-prima', familia: 'PEIXES', unidade: 'KG', quant: 77, valor: 3210.9, valorEstoque: 3197.93 }
  assert.equal(itemParaLinha(i).valor, 3197.93)
  assert.equal(itemParaLinha(i, 'fiscal').valor, 3210.9)
})
