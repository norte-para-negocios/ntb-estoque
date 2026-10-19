import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  COLUNAS, normalizarCabecalho, lerCsv, lerTabela, parseNumeroBR, parseSimNao, prepararFornecedores, prepararProdutos,
  validarCest, validarCnpjCpf, validarEan, validarNcm, validarOrigem, type FornecedorExistente, type ProdutoExistente,
} from './planilha-puro.ts'

test('validarEan: dígito verificador GTIN-8/12/13/14', () => {
  assert.deepEqual(validarEan('7891234567895'), { ok: true, valor: '7891234567895' })
  assert.equal(validarEan('7891234567890').ok, false)
  assert.deepEqual(validarEan('96385074'), { ok: true, valor: '96385074' })
  assert.deepEqual(validarEan(' 789-1234567895 '), { ok: true, valor: '7891234567895' })
  assert.deepEqual(validarEan('SEM GTIN'), { ok: true, valor: null })
  assert.deepEqual(validarEan(''), { ok: true, valor: null })
  assert.equal(validarEan('123').ok, false)
})

test('validarCnpjCpf', () => {
  assert.deepEqual(validarCnpjCpf('11.222.333/0001-81'), { ok: true, valor: '11222333000181', pessoaFisica: false })
  assert.equal(validarCnpjCpf('11.222.333/0001-82').ok, false)
  assert.deepEqual(validarCnpjCpf('529.982.247-25'), { ok: true, valor: '52998224725', pessoaFisica: true })
  assert.equal(validarCnpjCpf('111.111.111-11').ok, false)
  assert.deepEqual(validarCnpjCpf(''), { ok: true, valor: null, pessoaFisica: false })
})

test('NCM 8 dígitos, CEST 7 dígitos, origem 0 a 8', () => {
  assert.deepEqual(validarNcm('2106.90.90'), { ok: true, valor: '21069090' })
  assert.equal(validarNcm('2106').ok, false)
  assert.deepEqual(validarCest('01.001.00'), { ok: true, valor: '0100100' })
  assert.equal(validarCest('123').ok, false)
  assert.deepEqual(validarOrigem('0 - Nacional'), { ok: true, valor: '0' })
  assert.deepEqual(validarOrigem('8'), { ok: true, valor: '8' })
  assert.equal(validarOrigem('9').ok, false)
  assert.deepEqual(validarOrigem(''), { ok: true, valor: null })
})

test('parseNumeroBR e parseSimNao', () => {
  assert.equal(parseNumeroBR('1.234,56'), 1234.56)
  assert.equal(parseNumeroBR('1234.56'), 1234.56)
  assert.equal(parseNumeroBR('12,5'), 12.5)
  assert.equal(parseNumeroBR('R$ 3,90'), 3.9)
  assert.equal(parseNumeroBR(''), null)
  assert.ok(Number.isNaN(parseNumeroBR('abc') as number))
  assert.equal(parseSimNao('Sim'), true)
  assert.equal(parseSimNao('não'), false)
  assert.equal(parseSimNao('x'), true)
  assert.equal(parseSimNao(''), null)
  assert.equal(parseSimNao('talvez'), undefined)
})

test('os títulos do modelo voltam para as próprias colunas', () => {
  for (const tipo of ['produtos', 'fornecedores'] as const) {
    for (const c of COLUNAS[tipo]) assert.equal(normalizarCabecalho(c.titulo, tipo), c.chave, `${tipo}: ${c.titulo}`)
  }
})

test('lerCsv: ; ou , , aspas, BOM e quebra de linha dentro de aspas', () => {
  assert.deepEqual(lerCsv('﻿a;b\n1;"x;y"\n'), [['a', 'b'], ['1', 'x;y']])
  assert.deepEqual(lerCsv('a,b\r\n"linha\n2","""aspas"""'), [['a', 'b'], ['linha\n2', '"aspas"']])
})

test('lerTabela: cabeçalho com acento/maiúscula/apelido, linha vazia ignorada, coluna desconhecida avisada', () => {
  const t = lerTabela([['Código', 'DESCRIÇÃO', 'Preço de venda', 'Cor'], ['', '', '', ''], ['A1', 'Tomate', '3,50', 'azul']], 'produtos')
  assert.deepEqual(t.desconhecidas, ['Cor'])
  assert.equal(t.linhas.length, 1)
  assert.equal(t.linhas[0].n, 3)
  assert.deepEqual(t.linhas[0].valores, { codigo: 'A1', descricao: 'Tomate', preco_venda: '3,50' })
})

const existente = (p: Partial<ProdutoExistente>): ProdutoExistente => ({
  codigoProduto: 1, codigo: 'P1', descricao: 'TOMATE', unidade: 'KG', ean: null, ncm: null, tipoItem: '04', valorUnitario: 3,
  estoqueMinimo: null, pdv: false, inativo: false, codigoFamilia: null, validadeDias: null, cest: null, origem: null, ...p,
})
const FAM = [{ codigo: 10, descricao: 'Hortifruti' }]

test('prepararProdutos: novo, atualizar, sem mudança e erros por linha', () => {
  const t = lerTabela([
    ['codigo', 'descricao', 'unidade', 'familia', 'preco_venda', 'ean', 'ncm'],
    ['', 'Cebola', 'KG', 'hortifruti', '2,10', '', ''],             // 2: novo
    ['P1', '', '', '', '3,40', '', ''],                              // 3: atualizar preço do P1
    ['P1', 'TOMATE', 'KG', '', '3', '', ''],                         // 4: repetido na planilha
    ['', 'tomate', '', '', '', '', ''],                              // 5: acha por descrição, sem mudança
    ['', 'Alho', '', '', '', '', ''],                                // 6: novo sem unidade = erro
    ['', 'Batata', 'KG', 'Bebidas', '1', '7891234567890', '123'],    // 7: família desconhecida, EAN e NCM inválidos
  ], 'produtos')
  const r = prepararProdutos(t.linhas, { familias: FAM, existentes: [existente({})] })
  const por = (n: number) => r.find((x) => x.n === n)!
  assert.equal(por(2).acao, 'novo')
  assert.deepEqual(por(2).dados, { descricao: 'Cebola', unidade: 'KG', codigo_familia: 10, descricao_familia: 'Hortifruti', valor_unitario: 2.1 })
  assert.equal(por(3).acao, 'atualizar')
  assert.equal(por(3).alvo, 1)
  assert.deepEqual(por(3).dados, { valor_unitario: 3.4 })
  assert.equal(por(4).acao, 'erro')
  assert.match(por(4).erros[0], /repetido na linha 3/)
  assert.equal(por(5).acao, 'sem_mudanca')
  assert.equal(por(6).acao, 'erro')
  assert.match(por(6).erros.join(' '), /unidade/i)
  assert.equal(por(7).acao, 'erro')
  assert.equal(por(7).erros.length, 3)
})

test('prepararProdutos: EAN já usado por outro produto é erro; código novo informado vira novo com esse código', () => {
  const t = lerTabela([['codigo', 'descricao', 'unidade', 'ean'], ['X9', 'Suco', 'UN', '7891234567895']], 'produtos')
  const r = prepararProdutos(t.linhas, { familias: [], existentes: [existente({ ean: '7891234567895' })] })
  assert.equal(r[0].acao, 'erro')
  assert.match(r[0].erros[0], /EAN já é do produto P1/)
  const r2 = prepararProdutos(lerTabela([['codigo', 'descricao', 'unidade'], ['X9', 'Suco', 'UN']], 'produtos').linhas, { familias: [], existentes: [] })
  assert.equal(r2[0].acao, 'novo')
  assert.equal(r2[0].dados.codigo, 'X9')
})

test('prepararProdutos: tipo, CEST, origem, pdv e validade', () => {
  const t = lerTabela([['descricao', 'unidade', 'tipo', 'cest', 'origem', 'pdv', 'validade_dias'], ['Pão', 'UN', '4', '1700100', '0', 'sim', '3']], 'produtos')
  const r = prepararProdutos(t.linhas, { familias: [], existentes: [] })
  assert.deepEqual(r[0].dados, { descricao: 'Pão', unidade: 'UN', tipo_item: '04', cest: '1700100', origem: '0', pdv: true, validade_dias: 3 })
})

const forn = (p: Partial<FornecedorExistente>): FornecedorExistente => ({
  id: 7, razaoSocial: 'HORTI LTDA', nomeFantasia: null, cnpjCpf: '11222333000181', inscricaoEstadual: null, email: null, telefone: null,
  cep: null, uf: null, cidade: null, bairro: null, logradouro: null, numero: null, complemento: null, ...p,
})

test('prepararFornecedores: chave pelo CNPJ (com máscara), senão razão social; validações', () => {
  const t = lerTabela([
    ['Razão social', 'CNPJ', 'UF', 'E-mail', 'CEP'],
    ['Horti Ltda', '11.222.333/0001-81', 'BA', 'a@b.com', '40.000-000'], // 2: atualiza o 7 (uf, email, cep)
    ['Nova Distribuidora', '', 'XX', 'sem-arroba', ''],                // 3: UF e e-mail inválidos
    ['Outra', '11.222.333/0001-82', '', '', ''],                       // 4: CNPJ inválido
    ['Mercado Bom', '529.982.247-25', 'SP', '', ''],                   // 5: novo, pessoa física
  ], 'fornecedores')
  const r = prepararFornecedores(t.linhas, { existentes: [forn({})] })
  assert.equal(r[0].acao, 'atualizar')
  assert.equal(r[0].alvo, 7)
  assert.deepEqual(r[0].dados, { razao_social: 'Horti Ltda', uf: 'BA', email: 'a@b.com', cep: '40000000' })
  assert.equal(r[1].acao, 'erro')
  assert.equal(r[1].erros.length, 2)
  assert.equal(r[2].acao, 'erro')
  assert.equal(r[3].acao, 'novo')
  assert.deepEqual(r[3].dados, { razao_social: 'Mercado Bom', cnpj_cpf: '52998224725', pessoa_fisica: true, uf: 'SP' })
})
