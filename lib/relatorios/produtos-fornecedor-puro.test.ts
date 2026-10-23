import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarProdutosFornecedor, avisoItensNota, type BrutoPF, type MetaPF, type OpcoesPF } from './produtos-fornecedor-puro.ts'

const b = (o: Partial<BrutoPF>): BrutoPF => ({
  n_cod_prod: 1, fornecedor_chave: 'id:1', fornecedor: 'ALFA LTDA', fornecedor_fantasia: null, codigo_fornecedor: 'A1',
  ultima_data: '2026-10-01', ultima_nota: '10', ultima_nota_id: 1, qtde: 2, unidade: 'KG', preco_unit: 10, total: 20,
  custo_unit: 9, compras: 1, total_comprado: 20, primeira_data: '2026-10-01', ...o,
})
const meta = new Map<number, MetaPF>([
  [1, { codigo: '80031', descricao: 'Cebola', familia: 'Horti', tipo: '01', unidade: 'KG', inativo: false, custoMedio: 10, estoque: 5 }],
  [2, { codigo: '80035', descricao: 'Coentro', familia: 'Horti', tipo: '01', unidade: 'KG', inativo: true, custoMedio: null, estoque: 0 }],
])
const op = (o: Partial<OpcoesPF> = {}): OpcoesPF => ({ ver: 'produto', q: '', fornecedor: '', tipos: [], familias: [], inativos: true, ...o })

test('junta o cadastro, conta fornecedores por produto e marca o mais barato só com 2 ou mais', () => {
  const r = montarProdutosFornecedor([
    b({}), b({ fornecedor_chave: 'id:2', fornecedor: 'BETA SA', custo_unit: 8, ultima_data: '2026-09-01' }),
    b({ n_cod_prod: 2, custo_unit: 3 }),
  ], meta, op())
  assert.equal(r.linhas.length, 3)
  const [a, beta, coentro] = r.linhas
  assert.equal(a.descricao, 'Cebola')
  assert.equal(a.fornecedor, 'ALFA LTDA') // mesmo produto: última compra mais recente primeiro
  assert.equal(a.nFornecedores, 2)
  assert.equal(a.maisBarato, false)
  assert.equal(beta.maisBarato, true)
  assert.equal(coentro.nFornecedores, 1)
  assert.equal(coentro.maisBarato, false)
  assert.deepEqual(r.resumo, { produtos: 2, fornecedores: 2, pares: 3, multiFornecedor: 1 })
})

test('variação do custo da última compra contra o custo médio atual; sem custo médio = null', () => {
  const r = montarProdutosFornecedor([b({ custo_unit: 12 }), b({ n_cod_prod: 2 })], meta, op())
  assert.equal(r.linhas[0].variacaoPct, 20)
  assert.equal(r.linhas[1].variacaoPct, null)
})

test('produto sem cadastro continua, com o código interno no lugar do nome', () => {
  const r = montarProdutosFornecedor([b({ n_cod_prod: 99 })], meta, op())
  assert.equal(r.linhas[0].descricao, 'Produto 99')
  assert.equal(r.linhas[0].familia, 'Sem família')
})

test('filtros: fornecedor sem acento/caixa, busca no produto e no código do fornecedor, inativos, tipo e família', () => {
  const linhas = [b({ fornecedor: 'AÇOUGUE SÃO JOSÉ' }), b({ n_cod_prod: 2, fornecedor: 'BETA' })]
  assert.equal(montarProdutosFornecedor(linhas, meta, op({ fornecedor: 'acougue sao' })).linhas.length, 1)
  assert.equal(montarProdutosFornecedor(linhas, meta, op({ q: 'coent' })).linhas.length, 1)
  assert.equal(montarProdutosFornecedor(linhas, meta, op({ q: 'a1' })).linhas.length, 2)
  assert.equal(montarProdutosFornecedor(linhas, meta, op({ inativos: false })).linhas.length, 1)
  assert.equal(montarProdutosFornecedor(linhas, meta, op({ tipos: ['04'] })).linhas.length, 0)
  assert.equal(montarProdutosFornecedor(linhas, meta, op({ familias: ['Horti'] })).linhas.length, 2)
  // nFornecedores e maisBarato contam todos os fornecedores do produto, mesmo os escondidos pelo filtro
  const r = montarProdutosFornecedor([b({}), b({ fornecedor_chave: 'id:2', fornecedor: 'BETA', custo_unit: 1 })], meta, op({ fornecedor: 'alfa' }))
  assert.equal(r.linhas[0].nFornecedores, 2)
})

test('visão por fornecedor ordena pelo nome do fornecedor e depois pelo produto; empate estável', () => {
  const r = montarProdutosFornecedor([
    b({ fornecedor: 'ZETA', fornecedor_chave: 'id:9' }), b({ n_cod_prod: 2, fornecedor: 'ALFA' }), b({ fornecedor: 'ALFA' }),
  ], meta, op({ ver: 'fornecedor' }))
  assert.deepEqual(r.linhas.map((l) => `${l.fornecedor}/${l.descricao}`), ['ALFA/Cebola', 'ALFA/Coentro', 'ZETA/Cebola'])
})

test('lista vazia', () => {
  assert.deepEqual(montarProdutosFornecedor([], meta, op()).resumo, { produtos: 0, fornecedores: 0, pares: 0, multiFornecedor: 0 })
})

// Paridade 20/10/2026 (B8): 60145 SUPRINOX NF 33198 tem 2 itens do produto (Omie: 2 linhas, uma por código do fornecedor).
test('aviso de vários itens do produto na última nota', () => {
  assert.equal(avisoItensNota(2), '2 itens deste produto na nota')
  assert.equal(avisoItensNota(1), null)
  assert.equal(avisoItensNota(null), null)
  assert.equal(avisoItensNota(undefined), null)
})

test('alerta da última compra: unidade sem conversão ou custo 10× fora do médio (auditoria 23/10/2026)', async () => {
  const { alertaCompra } = await import('./produtos-fornecedor-puro.ts')
  assert.equal(alertaCompra('GF', 'ML', 49.75, 49.75), 'Comprado em GF, estoque em ML: confira a conversão no Omie') // Monin 80405
  assert.equal(alertaCompra('ML', 'ML', 28.9, 0.0283), 'Custo da compra 1.021× maior que o custo médio: unidade ou custo errado no Omie') // Vodka 80164
  assert.equal(alertaCompra('UN', 'UN', 0.01, 6.79), 'Custo da compra 679× menor que o custo médio: unidade ou custo errado no Omie') // copo 60260
  assert.equal(alertaCompra('UND', 'UN', 10, 9), null)
  assert.equal(alertaCompra('KG', 'KG', 16.5, 14.13), null)
  assert.equal(alertaCompra(null, 'KG', 16.5, null), null)
})
