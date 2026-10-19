import { test } from 'node:test'
import assert from 'node:assert/strict'
import { acoesRequisicao, rotuloEtapaRequisicao, chaveFornecedor, previaGerarPedidos } from './requisicao-puro.ts'

test('acoesRequisicao espelha rc_acao: editar só aberta, aprovar/recusar pelo aprovador, reabrir', () => {
  const todos = { podeEditar: true, podeAprovar: true }
  assert.deepEqual(acoesRequisicao('aberta', todos), ['editar', 'aprovar', 'recusar'])
  assert.deepEqual(acoesRequisicao('aberta', { podeEditar: true, podeAprovar: false }), ['editar'])
  assert.deepEqual(acoesRequisicao('aberta', { podeEditar: false, podeAprovar: true }), ['aprovar', 'recusar'])
  assert.deepEqual(acoesRequisicao('aprovada', todos), ['recusar', 'reabrir'])
  assert.deepEqual(acoesRequisicao('aprovada', { podeEditar: true, podeAprovar: false }), ['reabrir'])
  assert.deepEqual(acoesRequisicao('recusada', todos), ['reabrir'])
  assert.deepEqual(acoesRequisicao('recusada', { podeEditar: false, podeAprovar: true }), [])
  assert.deepEqual(acoesRequisicao('pedido', todos), [])
})

test('rotuloEtapaRequisicao', () => {
  assert.equal(rotuloEtapaRequisicao('aberta').rotulo, 'Aberta')
  assert.equal(rotuloEtapaRequisicao('pedido').rotulo, 'Virou pedido')
  assert.equal(rotuloEtapaRequisicao('recusada').tom, 'erro')
})

test('chaveFornecedor: cadastro > CNPJ > nome sem acento e caixa > vazio (igual a _rc_chave_fornecedor)', () => {
  assert.equal(chaveFornecedor({ fornecedorId: 7, fornecedorCnpj: '11222333000181', fornecedorNome: 'X' }), 'id:7')
  assert.equal(chaveFornecedor({ fornecedorId: null, fornecedorCnpj: '11.222.333/0001-81', fornecedorNome: 'X' }), 'cnpj:11222333000181')
  assert.equal(chaveFornecedor({ fornecedorId: null, fornecedorCnpj: null, fornecedorNome: '  Feira  São Joaquim ' }), 'nome:feira sao joaquim')
  assert.equal(chaveFornecedor({ fornecedorId: null, fornecedorCnpj: null, fornecedorNome: 'FEIRA SAO JOAQUIM' }), 'nome:feira sao joaquim')
  assert.equal(chaveFornecedor({ fornecedorId: null, fornecedorCnpj: '', fornecedorNome: '' }), '')
})

test('previaGerarPedidos: um pedido por fornecedor, mesmo produto somado com preço ponderado, sem fornecedor no fim', () => {
  const base = { unidade: 'KG', fator: 1, descricao: 'X' }
  const r = previaGerarPedidos([
    { ...base, requisicaoNumero: 1, codigoProduto: 701, quantidade: 10, precoSugerido: 5, fornecedorId: 9, fornecedorCnpj: null, fornecedorNome: 'HORTI' },
    { ...base, requisicaoNumero: 1, codigoProduto: 703, quantidade: 2, precoSugerido: 30, fornecedorId: null, fornecedorCnpj: null, fornecedorNome: null },
    { ...base, requisicaoNumero: 2, codigoProduto: 701, quantidade: 5, precoSugerido: 8, fornecedorId: 9, fornecedorCnpj: null, fornecedorNome: 'HORTI' },
    { ...base, requisicaoNumero: 2, codigoProduto: 701, quantidade: 1, precoSugerido: 8, fornecedorId: 9, fornecedorCnpj: null, fornecedorNome: 'HORTI', unidade: 'CX', fator: 10 },
  ])
  assert.equal(r.length, 2)
  assert.equal(r[0].fornecedorNome, 'HORTI')
  assert.deepEqual(r[0].requisicoes, [1, 2])
  assert.equal(r[0].itens.length, 2)
  assert.equal(r[0].itens[0].quantidade, 15)
  assert.equal(r[0].itens[0].preco, 6)
  assert.equal(r[0].total, 15 * 6 + 8)
  assert.equal(r[1].fornecedorNome, 'Fornecedor a definir')
})
