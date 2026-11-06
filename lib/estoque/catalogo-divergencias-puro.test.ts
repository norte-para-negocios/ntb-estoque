import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compararCatalogo, planoDivergencias, type ProdutoEstoque, type ProdutoVendas } from './catalogo-divergencias-puro.ts'

const e = (o: Partial<ProdutoEstoque>): ProdutoEstoque => ({ codigo: '90001', vendas_ref: 'v1', descricao: 'Moqueca', valor_unitario: 100, inativo: false, pdv: true, ncm: '21069090', tipo_item: '04', ...o })
const v = (o: Partial<ProdutoVendas>): ProdutoVendas => ({ vendas_ref: 'v1', codigo: '90001', nome: 'Moqueca', preco: 100, ativo: true, ncm: '21069090', ...o })

test('catálogos iguais: nenhuma divergência (maiúscula e espaço não contam)', () => {
  assert.deepEqual(compararCatalogo([e({ descricao: ' moqueca  ' })], [v({})]), [])
})

test('conflito lista cada campo diferente com os dois valores', () => {
  const r = compararCatalogo([e({})], [v({ nome: 'Moqueca G', preco: 110, ativo: false, ncm: '2106.90.10' })])
  assert.equal(r.length, 1)
  assert.equal(r[0].tipo, 'conflito')
  assert.match(r[0].detalhe, /nome: Estoque "Moqueca" × Vendas "Moqueca G"/)
  assert.match(r[0].detalhe, /preço: Estoque R\$\s?100,00 × Vendas R\$\s?110,00/)
  assert.match(r[0].detalhe, /situação: Estoque ativo × Vendas inativo/)
  assert.match(r[0].detalhe, /NCM: Estoque 21069090 × Vendas 21069010/)
})

test('NCM vazio de um lado não é conflito', () => {
  assert.deepEqual(compararCatalogo([e({ ncm: null })], [v({})]), [])
})

test('só no Vendas e só no Estoque', () => {
  const r = compararCatalogo(
    [e({}), e({ codigo: '90002', vendas_ref: null, descricao: 'Pastel' }), e({ codigo: '80001', vendas_ref: null, tipo_item: '01' }), e({ codigo: '90003', vendas_ref: null, inativo: true }), e({ codigo: '90004', vendas_ref: null, pdv: false })],
    [v({}), v({ vendas_ref: 'v9', codigo: null, nome: 'Suco' }), v({ vendas_ref: 'v8', codigo: '90099', nome: 'Água' })],
  )
  assert.deepEqual(r.map((d) => [d.tipo, d.ref]), [['so_vendas', 'vendas:v9'], ['so_vendas', '90099'], ['so_estoque', '90002']])
})

test('plano: insere novas, atualiza texto, resolve as que sumiram', () => {
  const p = planoDivergencias(
    [{ id: 1, ref: '90001', tipo: 'conflito', detalhe: 'velho' }, { id: 2, ref: '90002', tipo: 'so_estoque', detalhe: 'x' }],
    [{ entidade: 'produto', ref: '90001', tipo: 'conflito', detalhe: 'novo' }, { entidade: 'produto', ref: '90005', tipo: 'so_vendas', detalhe: 'y' }],
  )
  assert.deepEqual(p.inserir.map((d) => d.ref), ['90005'])
  assert.deepEqual(p.atualizar, [{ id: 1, detalhe: 'novo' }])
  assert.deepEqual(p.resolver, [2])
})
