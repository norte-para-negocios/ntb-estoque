import { test } from 'node:test'
import assert from 'node:assert/strict'
import { periodoValorMovimento, agruparCmv, cmvFormulaOmie, custoMedioAtual, escolherFonteCmv, linhaVazia, montarLinhasEstimado, montarLinhasKardex, resumoCmv, type LinhaCmv } from './cmv-puro.ts'

test('escolherFonteCmv: próprio, kardex só com o período inteiro coberto, senão estimado', () => {
  const k = { kardexDesde: '2026-09-12', kardexAte: '2026-10-16' }
  assert.equal(escolherFonteCmv({ modo: 'proprio', kardexDesde: null, kardexAte: null, ini: '2026-10-01', fim: '2026-10-19' }), 'proprio')
  assert.equal(escolherFonteCmv({ modo: 'omie', ...k, ini: '2026-09-12', fim: '2026-10-16' }), 'kardex')
  assert.equal(escolherFonteCmv({ modo: 'omie', ...k, ini: '2026-09-11', fim: '2026-10-01' }), 'estimado')
  assert.equal(escolherFonteCmv({ modo: 'omie', ...k, ini: '2026-10-01', fim: '2026-10-17' }), 'estimado')
  assert.equal(escolherFonteCmv({ modo: 'omie', kardexDesde: null, kardexAte: null, ini: '2026-10-01', fim: '2026-10-02' }), 'estimado')
  assert.equal(escolherFonteCmv({ modo: 'nenhum', ...k, ini: '2026-10-01', fim: '2026-10-02' }), 'estimado')
})

test('custoMedioAtual: ponderado pelo saldo positivo; senão sentinela; senão maior CMC válido; absurdo fora', () => {
  const m = custoMedioAtual([
    { n_cod_prod: 1, codigo_local_estoque: 10, n_saldo: 10, n_cmc: 5 },
    { n_cod_prod: 1, codigo_local_estoque: 20, n_saldo: 30, n_cmc: 9 },
    { n_cod_prod: 1, codigo_local_estoque: 0, n_saldo: 0, n_cmc: 99 },
    { n_cod_prod: 2, codigo_local_estoque: 10, n_saldo: -3, n_cmc: 4 },
    { n_cod_prod: 2, codigo_local_estoque: 0, n_saldo: 0, n_cmc: 6 },
    { n_cod_prod: 3, codigo_local_estoque: 10, n_saldo: -1, n_cmc: 7 },
    { n_cod_prod: 3, codigo_local_estoque: 20, n_saldo: 0, n_cmc: 8 },
    { n_cod_prod: 4, codigo_local_estoque: 10, n_saldo: -2, n_cmc: 2.7e10 },
  ])
  assert.equal(m.get(1), 8)
  assert.equal(m.get(2), 6)
  assert.equal(m.get(3), 8)
  assert.equal(m.has(4), false)
})

const vendas = [
  { idProduto: 1, produto: 'Moqueca', familia: 'Pratos', tipoCod: '04', tipo: 'Produto acabado', quant: 2, valor: 200 },
  { idProduto: 1, produto: 'Moqueca', familia: 'Pratos', tipoCod: '04', tipo: 'Produto acabado', quant: 1, valor: 100 },
  { idProduto: 2, produto: 'Refri', familia: 'Bebidas', tipoCod: '00', tipo: 'Revenda', quant: 4, valor: 32 },
  { idProduto: null, produto: 'Taxa de serviço', familia: 'Sem família', tipoCod: '', tipo: 'Não classificado', quant: 1, valor: 30 },
]

test('estimado: quantidade vendida × custo médio de hoje; sem custo conta', () => {
  const l = montarLinhasEstimado(vendas, new Map([[1, 40], [2, 3]]))
  const m = l.find((x) => x.chave === '1')!
  assert.equal(m.quant, 3)
  assert.equal(m.faturamento, 300)
  assert.equal(m.cmv, 120)
  assert.equal(l.find((x) => x.chave === '2')!.cmv, 12)
  const taxa = l.find((x) => x.rotulo === 'Taxa de serviço')!
  assert.equal(taxa.cmv, 0)
  assert.equal(taxa.semCusto, 1)
})

test('estimado: custo de hoje acima do preço de venda fica de fora e é contado', () => {
  const l = montarLinhasEstimado(vendas, new Map([[1, 774], [2, 3]]))
  const m = l.find((x) => x.chave === '1')!
  assert.equal(m.cmv, 0)
  assert.equal(m.custoSuspeito, 1)
  assert.equal(m.semCusto, 0)
  const r = resumoCmv(l)
  assert.equal(r.custoSuspeito, 1)
  assert.equal(r.faturamentoSuspeito, 300)
})

test('kardex: custo e quantidade do kardex, faturamento das vendas; produto só de consumo entra', () => {
  const meta = new Map([[1, { rotulo: 'Moqueca', familia: 'Pratos', tipoCod: '04', tipo: 'Produto acabado' }], [9, { rotulo: 'Camarão', familia: 'Insumos', tipoCod: '01', tipo: 'Matéria-prima' }]])
  const rpc = [
    { n_cod_prod: 1, ei: 10, compras: 0, producao: 90, outras_entradas: 0, vendas: 95, qtd_vendida: 3, consumo_op: 0, outras_saidas: 0, ef: 5, sem_custo: 0 },
    { n_cod_prod: 9, ei: 100, compras: 50, producao: 0, outras_entradas: 0, vendas: 0, qtd_vendida: 0, consumo_op: 80, outras_saidas: 5, ef: 65, sem_custo: 0 },
  ]
  const l = montarLinhasKardex(rpc, vendas, meta)
  const m = l.find((x) => x.chave === '1')!
  assert.equal(m.cmv, 95)
  assert.equal(m.quant, 3)
  assert.equal(m.faturamento, 300)
  assert.equal(cmvFormulaOmie(m), 95)
  const c = l.find((x) => x.chave === '9')!
  assert.equal(c.consumo, 80)
  assert.equal(c.rotulo, 'Camarão')
  assert.equal(cmvFormulaOmie(c), 85)
  // venda sem linha no kardex (taxa de serviço, refri sem movimento): faturamento sem custo
  assert.equal(l.find((x) => x.chave === '2')!.cmv, 0)
  assert.equal(l.find((x) => x.rotulo === 'Taxa de serviço')!.faturamento, 30)
  assert.equal(l.find((x) => x.chave === '2')!.semCusto, 1)
  assert.equal(m.semCusto, 0)
})

test('agruparCmv por família e resumo', () => {
  const l = montarLinhasEstimado(vendas, new Map([[1, 40], [2, 3]]))
  const f = agruparCmv(l, 'familia')
  assert.deepEqual(f.map((x) => x.rotulo), ['Pratos', 'Bebidas', 'Sem família'])
  assert.equal(f[0].cmv, 120)
  const r = resumoCmv(l)
  assert.equal(r.faturamento, 362)
  assert.equal(r.cmv, 132)
  assert.equal(r.margem, 230)
  assert.equal(r.margemPct, 63.5)
  assert.equal(resumoCmv([]).margemPct, null)
  const v: LinhaCmv = linhaVazia('x', 'x')
  assert.equal(v.cmv, 0)
})

test('periodoValorMovimento: própria = pedido; Omie = parte coberta pelo kardex; nada coberto = null', () => {
  const k = { kardexDesde: '2026-09-12', kardexAte: '2026-10-16' }
  assert.deepEqual(periodoValorMovimento({ modo: 'proprio', kardexDesde: null, kardexAte: null, ini: '2026-01-01', fim: '2026-10-19' }), { ini: '2026-01-01', fim: '2026-10-19', cortado: false })
  assert.deepEqual(periodoValorMovimento({ modo: 'omie', ...k, ini: '2026-01-01', fim: '2026-10-19' }), { ini: '2026-09-12', fim: '2026-10-16', cortado: true })
  assert.deepEqual(periodoValorMovimento({ modo: 'omie', ...k, ini: '2026-09-20', fim: '2026-09-30' }), { ini: '2026-09-20', fim: '2026-09-30', cortado: false })
  assert.equal(periodoValorMovimento({ modo: 'omie', ...k, ini: '2026-01-01', fim: '2026-08-31' }), null)
  assert.equal(periodoValorMovimento({ modo: 'omie', kardexDesde: null, kardexAte: null, ini: '2026-01-01', fim: '2026-08-31' }), null)
})
