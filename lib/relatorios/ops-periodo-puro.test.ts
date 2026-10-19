import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agregarOps, codigosDoFiltro, filtrarOps, resumoOps, serieOps, type LinhaOpProduto, type MetaOp } from './ops-periodo-puro.ts'

// A RPC 211 já devolve uma linha por papel × produto (ops, quantidade, custo, dias) e a série por dia à parte.
const L = (o: Partial<LinhaOpProduto>): LinhaOpProduto => ({ papel: 'produzido', n_cod_prod: 1, ops: 1, qtde: 1, custo: null, dias: 1, ...o })
const meta = new Map<number, MetaOp>([
  [1, { rotulo: 'Moqueca', codigo: '90133', familia: 'Pratos', tipo: '04', unidade: 'UN' }],
  [2, { rotulo: 'Arroz (PI)', codigo: '70003', familia: 'PI', tipo: '03', unidade: 'KG' }],
  [3, { rotulo: 'Cebola', codigo: '80031', familia: 'Horti', tipo: '01', unidade: 'KG' }],
])
const F = { tipos: [] as string[], familias: [] as string[], q: '' }

test('lista do papel pedido com o cadastro; ordem: mais OPs, depois mais quantidade, depois nome', () => {
  const linhas = [L({ n_cod_prod: 1, ops: 3, qtde: 3, dias: 2 }), L({ n_cod_prod: 2, ops: 3, qtde: 1.5 }), L({ papel: 'consumido', n_cod_prod: 3, ops: 3, qtde: 0.4 })]
  const r = agregarOps(linhas, meta, 'produzido', F)
  assert.deepEqual(r.map((l) => [l.rotulo, l.ops, l.qtde, l.dias, l.unidade]), [['Moqueca', 3, 3, 2, 'UN'], ['Arroz (PI)', 3, 1.5, 1, 'KG']])
  assert.deepEqual(agregarOps(linhas, meta, 'consumido', F).map((l) => l.chave), ['3'])
})

test('filtros de tipo, família e busca; produto sem cadastro', () => {
  const linhas = [L({ n_cod_prod: 1, custo: 15 }), L({ n_cod_prod: 2 }), L({ n_cod_prod: 9 })]
  assert.equal(agregarOps(linhas, meta, 'produzido', F).find((l) => l.chave === '9')?.rotulo, 'Produto 9')
  assert.equal(agregarOps(linhas, meta, 'produzido', F).find((l) => l.chave === '1')?.custo, 15)
  assert.deepEqual(agregarOps(linhas, meta, 'produzido', { ...F, tipos: ['03'] }).map((l) => l.chave), ['2'])
  assert.deepEqual(agregarOps(linhas, meta, 'produzido', { ...F, familias: ['Pratos'] }).map((l) => l.chave), ['1'])
  assert.deepEqual(agregarOps(linhas, meta, 'produzido', { ...F, q: '7000' }).map((l) => l.chave), ['2'])
  assert.equal(filtrarOps(linhas, meta, { ...F, familias: ['Pratos'] }).length, 1)
})

test('códigos para o filtro no banco: null sem filtro; senão os do cadastro que passam', () => {
  assert.equal(codigosDoFiltro(meta, F), null)
  assert.deepEqual(codigosDoFiltro(meta, { ...F, tipos: ['01', '03'] }), [2, 3])
  assert.deepEqual(codigosDoFiltro(meta, { ...F, q: 'zzz' }), [])
})

test('resumo (custo nulo se faltar em alguma linha) e série por dia com zeros', () => {
  const linhas = [L({ ops: 2, custo: 8 }), L({ n_cod_prod: 2, ops: 1, custo: 2 }), L({ papel: 'consumido', n_cod_prod: 3, ops: 2, custo: 1 })]
  assert.deepEqual(resumoOps(linhas), { ops: 3, produtos: 2, insumos: 1, custoProduzido: 10, custoConsumido: 1 })
  assert.equal(resumoOps([L({ custo: 3 }), L({ n_cod_prod: 2, custo: null })]).custoProduzido, null)
  assert.deepEqual(resumoOps([]), { ops: 0, produtos: 0, insumos: 0, custoProduzido: null, custoConsumido: null })
  assert.deepEqual(serieOps([{ dia: '2026-10-01', ops: 2, qtde: 4 }, { dia: '2026-10-03', ops: 1, qtde: 1 }], '2026-10-01', '2026-10-03'), [
    { dia: '2026-10-01', ops: 2, qtde: 4 }, { dia: '2026-10-02', ops: 0, qtde: 0 }, { dia: '2026-10-03', ops: 1, qtde: 1 },
  ])
})
