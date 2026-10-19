import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agregarOps, filtrarOps, resumoOps, serieOps, type LinhaOpBruta, type MetaOp } from './ops-periodo-puro.ts'

const L = (o: Partial<LinhaOpBruta>): LinhaOpBruta => ({ papel: 'produzido', dia: '2026-10-01', n_cod_prod: 1, ops: 1, qtde: 1, custo: null, ...o })
const meta = new Map<number, MetaOp>([
  [1, { rotulo: 'Moqueca', codigo: '90133', familia: 'Pratos', tipo: '04', unidade: 'UN' }],
  [2, { rotulo: 'Arroz (PI)', codigo: '70003', familia: 'PI', tipo: '03', unidade: 'KG' }],
  [3, { rotulo: 'Cebola', codigo: '80031', familia: 'Horti', tipo: '01', unidade: 'KG' }],
])
const F = { tipos: [] as string[], familias: [] as string[], q: '' }

test('agrega por produto somando os dias; ordem: mais OPs, depois mais quantidade, depois nome', () => {
  const brutas = [
    L({ n_cod_prod: 1, ops: 2, qtde: 2 }), L({ n_cod_prod: 1, dia: '2026-10-02', ops: 1, qtde: 1 }),
    L({ n_cod_prod: 2, ops: 3, qtde: 1.5 }), L({ papel: 'consumido', n_cod_prod: 3, ops: 3, qtde: 0.4 }),
  ]
  const r = agregarOps(brutas, meta, 'produzido', F)
  assert.deepEqual(r.map((l) => [l.rotulo, l.ops, l.qtde, l.dias]), [['Moqueca', 3, 3, 2], ['Arroz (PI)', 3, 1.5, 1]])
  assert.equal(r[0].unidade, 'UN')
  assert.deepEqual(agregarOps(brutas, meta, 'consumido', F).map((l) => l.chave), ['3'])
})

test('custo só existe quando toda linha tem custo; filtros de tipo, família e busca; produto sem cadastro', () => {
  const brutas = [L({ n_cod_prod: 1, custo: 10 }), L({ n_cod_prod: 1, dia: '2026-10-02', custo: 5 }), L({ n_cod_prod: 2, custo: null }), L({ n_cod_prod: 9 })]
  const r = agregarOps(brutas, meta, 'produzido', F)
  assert.equal(r.find((l) => l.chave === '1')?.custo, 15)
  assert.equal(r.find((l) => l.chave === '2')?.custo, null)
  assert.equal(r.find((l) => l.chave === '9')?.rotulo, 'Produto 9')
  assert.deepEqual(agregarOps(brutas, meta, 'produzido', { ...F, tipos: ['03'] }).map((l) => l.chave), ['2'])
  assert.deepEqual(agregarOps(brutas, meta, 'produzido', { ...F, familias: ['Pratos'] }).map((l) => l.chave), ['1'])
  assert.deepEqual(agregarOps(brutas, meta, 'produzido', { ...F, q: '7000' }).map((l) => l.chave), ['2'])
  assert.deepEqual(filtrarOps(brutas, meta, { ...F, familias: ['Pratos'] }).length, 2)
})

test('resumo e série por dia (dias sem produção = 0)', () => {
  const brutas = [L({ ops: 2, qtde: 4, custo: 8 }), L({ dia: '2026-10-03', n_cod_prod: 2, ops: 1, qtde: 1, custo: 2 }), L({ papel: 'consumido', n_cod_prod: 3, ops: 2, qtde: 0.5, custo: 1 })]
  assert.deepEqual(resumoOps(brutas), { ops: 3, produtos: 2, insumos: 1, custoProduzido: 10, custoConsumido: 1 })
  assert.deepEqual(resumoOps([L({ custo: null })]).custoProduzido, null)
  assert.deepEqual(serieOps(brutas, '2026-10-01', '2026-10-03'), [
    { dia: '2026-10-01', ops: 2, qtde: 4 }, { dia: '2026-10-02', ops: 0, qtde: 0 }, { dia: '2026-10-03', ops: 1, qtde: 1 },
  ])
  assert.deepEqual(resumoOps([]), { ops: 0, produtos: 0, insumos: 0, custoProduzido: null, custoConsumido: null })
})
