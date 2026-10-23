import { test } from 'node:test'
import assert from 'node:assert/strict'
import { totaisFormula, periodoValorMovimento, agruparCmv, cmvFormulaOmie, custoForaDoNormal, custoMedioAtual, escolherFonteCmv, linhaVazia, montarLinhasEstimado, montarLinhasKardex, resumoCmv, textoCustoForaDoNormal, type LinhaCmv } from './cmv-puro.ts'

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

test('totaisFormula: produto com quebra na cadeia sai do total da fórmula e é listado; vendas não mudam', () => {
  const meta = new Map([[9, { rotulo: 'Azeitona', familia: 'Insumos', tipoCod: '01', tipo: 'Matéria-prima' }], [1, { rotulo: 'Moqueca', familia: 'Pratos', tipoCod: '04', tipo: 'Produto acabado' }]])
  const rpc = [
    { n_cod_prod: 1, ei: 10, compras: 0, producao: 90, outras_entradas: 0, vendas: 95, qtd_vendida: 3, consumo_op: 0, outras_saidas: 0, ef: 5, sem_custo: 0, quebra: 0 },
    { n_cod_prod: 9, ei: 99.5, compras: 103.52, producao: 0, outras_entradas: 0, vendas: 0, qtd_vendida: 0, consumo_op: 32.09, outras_saidas: 0, ef: 449706.65, sem_custo: 0, quebra: 2997 },
  ]
  const l = montarLinhasKardex(rpc, [], meta)
  const t = totaisFormula(l, () => true)
  assert.equal(t.semQuebra, 95)
  assert.equal(t.foraDoTotal, -449503.63)
  assert.deepEqual(t.quebrados.map((q) => q.rotulo), ['Azeitona'])
  assert.equal(totaisFormula(l, (tipo) => tipo === '04').quebrados.length, 0)
  assert.equal(resumoCmv(l).cmv, 95)
  assert.equal(agruparCmv(l, 'familia').find((x) => x.rotulo === 'Insumos')!.quebra, 2997)
})

test('custo fora do normal (290): o CMV usa o custo trocado, o cru do Omie fica para o aviso', () => {
  const zero = { ei: 0, compras: 0, producao: 0, outras_entradas: 0, outras_saidas: 0, ef: 0, sem_custo: 0 }
  const rpc = [
    // Suco de Morango Jarra, loja 5, 01–23/10/2026: 74 saídas, 4,5 bilhões pelo Omie
    { n_cod_prod: 1, ...zero, vendas: 607.28, qtd_vendida: 74, consumo_op: 0, vendas_omie: 4521358032.05, consumo_op_omie: 0, ajustados: 26, sem_referencia: 0, custo_referencia: 8.2069 },
    // soda artesanal: sem custo confiável (2.488 por unidade, preço 14,90) → zero
    { n_cod_prod: 2, ...zero, vendas: 0, qtd_vendida: 3, consumo_op: 0, vendas_omie: 7464.56, consumo_op_omie: 0, ajustados: 3, sem_referencia: 3, custo_referencia: null },
    // normal, sem troca e sem as colunas da 290 (migration ainda não aplicada)
    { n_cod_prod: 3, ...zero, vendas: 20804.92, qtd_vendida: 321, consumo_op: 0 },
  ]
  const meta = new Map([[1, { rotulo: 'Suco de Morango Jarra 730 ML', familia: 'Sucos', tipoCod: '04', tipo: 'Produto Acabado' }],
    [2, { rotulo: 'SODA ARTESANAL MARACUJA AZUL', familia: 'Drinks', tipoCod: '04', tipo: 'Produto Acabado' }],
    [3, { rotulo: 'Moqueca de Camarão 600 g', familia: 'Pratos', tipoCod: '04', tipo: 'Produto Acabado' }]])
  const vendas = [
    { idProduto: 1, produto: 'Suco', familia: 'Sucos', tipoCod: '04', tipo: 'Produto Acabado', quant: 74, valor: 2123.71 },
    { idProduto: 2, produto: 'Soda', familia: 'Drinks', tipoCod: '04', tipo: 'Produto Acabado', quant: 3, valor: 44.7 },
    { idProduto: 3, produto: 'Moqueca', familia: 'Pratos', tipoCod: '04', tipo: 'Produto Acabado', quant: 321, valor: 59216.16 },
  ]
  const l = montarLinhasKardex(rpc, vendas, meta)
  const suco = l.find((x) => x.chave === '1')!
  assert.equal(suco.cmv, 607.28)
  assert.equal(suco.cmvOmie, 4521358032.05)
  const moq = l.find((x) => x.chave === '3')!
  assert.equal(moq.cmvOmie, moq.cmv)
  assert.equal(moq.ajustados, 0)
  const r = resumoCmv(l)
  assert.equal(r.cmv, 21412.2)
  const f = custoForaDoNormal(l)
  assert.deepEqual(f.produtos.map((p) => p.rotulo), ['Suco', 'Soda']) // rótulo da venda (cupom) quando há venda
  assert.equal(f.movimentos, 29)
  assert.equal(f.semReferencia, 1)
  assert.equal(f.faturamentoSemReferencia, 44.7)
  assert.equal(f.cmvOmie, 4521365496.61)
  const t = textoCustoForaDoNormal(f, (n) => n.toFixed(2))
  assert.match(t, /2 produto\(s\) com custo fora do normal/)
  assert.match(t, /1 sem nenhum custo confiável ficaram com custo zero \(44.70/)
  assert.equal(textoCustoForaDoNormal(custoForaDoNormal([moq]), String), '')
  // agrupar por família soma o cru e as contagens
  const fam = agruparCmv(l, 'familia').find((x) => x.rotulo === 'Drinks')!
  assert.equal(fam.ajustados, 3)
  assert.equal(fam.cmvOmie, 7464.56)
})

test('custo fora do normal (290): troca só no estoque inicial/final aparece no aviso; contagem separa movimento e saldo', () => {
  const zero = { compras: 0, producao: 0, outras_entradas: 0, outras_saidas: 0, sem_custo: 0, vendas: 0, qtd_vendida: 0, consumo_op: 0 }
  // Suco com saldo −32 a CMC 194 milhões no fim do período: EF −6,2 bi pelo Omie, −262,62 usado; sem venda trocada
  const rpc = [{ n_cod_prod: 1, ...zero, ei: 0, ef: -262.62, vendas_omie: 0, consumo_op_omie: 0, ei_omie: 0, ef_omie: -6225057586.84, ajustados: 0, ajustados_estoque: 1, sem_referencia: 0, custo_referencia: 8.2069 }]
  const l = montarLinhasKardex(rpc, [], new Map([[1, { rotulo: 'Suco', familia: 'Sucos', tipoCod: '04', tipo: 'Produto Acabado' }]]))
  const f = custoForaDoNormal(l)
  assert.equal(f.produtos.length, 1)
  assert.equal(f.movimentos, 0)
  assert.equal(f.saldosEstoque, 1)
  assert.equal(f.efOmie, -6225057586.84)
  const t = textoCustoForaDoNormal(f, (n) => n.toFixed(2))
  assert.match(t, /1 saldo\(s\) de estoque inicial\/final/)
  assert.match(t, /estoque final pelo Omie -6225057586.84, usado -262.62/)
  assert.doesNotMatch(t, /CMV pelo Omie/)
  // produto com movimento contado mas sem diferença de valor não entra na lista nem na contagem
  const igual = montarLinhasKardex([{ n_cod_prod: 2, ...zero, ei: 5, ef: 5, vendas_omie: 0, consumo_op_omie: 0, ei_omie: 5, ef_omie: 5, ajustados: 3, ajustados_estoque: 0, sem_referencia: 0, custo_referencia: 1 }], [], new Map())
  assert.equal(custoForaDoNormal(igual).movimentos, 0)
})
