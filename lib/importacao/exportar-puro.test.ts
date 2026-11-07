import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COLUNAS, lerTabela, prepararFornecedores, prepararProdutos, type FornecedorExistente, type ProdutoExistente } from './planilha-puro.ts'
import { linhasExportFornecedores, linhasExportProdutos, numeroBR } from './exportar-puro.ts'

const prod = (x: Partial<ProdutoExistente> & { codigoProduto: number }): ProdutoExistente => ({
  codigo: null, descricao: null, unidade: 'UN', ean: null, ncm: null, tipoItem: '04', valorUnitario: null, estoqueMinimo: null, pdv: false,
  inativo: false, codigoFamilia: null, validadeDias: null, cest: null, origem: null, ...x,
})
// a planilha como o importador lê: cabeçalho com os títulos + linhas na ordem das colunas
const comoPlanilha = (tipo: 'produtos' | 'fornecedores', linhas: Record<string, string>[]) =>
  [COLUNAS[tipo].map((c) => c.titulo), ...linhas.map((l) => COLUNAS[tipo].map((c) => l[c.chave] ?? ''))]

test('numeroBR: vírgula decimal, sem milhar, vazio para nulo', () => {
  assert.equal(numeroBR(1500), '1500')
  assert.equal(numeroBR(12.9), '12,9')
  assert.equal(numeroBR(0.0797193), '0,079719')
  assert.equal(numeroBR(null), '')
})

test('produtos: exportar e importar de volta = tudo "sem mudança"', () => {
  const familias = [{ codigo: 10, descricao: 'Bebidas' }, { codigo: 11, descricao: 'Hortifruti' }]
  const existentes = [
    prod({ codigoProduto: 1, codigo: '90001', descricao: 'Cerveja Long Neck 330ml', unidade: 'UN', tipoItem: '00', codigoFamilia: 10, ncm: '22030000',
      ean: '7891234567895', cest: '0302100', origem: '0', valorUnitario: 12.9, estoqueMinimo: 24, pdv: true, validadeDias: 180 }),
    prod({ codigoProduto: 2, codigo: '80002', descricao: 'Tomate italiano', unidade: 'KG', tipoItem: '01', codigoFamilia: 11, estoqueMinimo: 1500.5, inativo: true }),
    prod({ codigoProduto: 3, codigo: '70003', descricao: 'Molho de tomate (PI)', unidade: 'L', tipoItem: '03' }),
  ]
  const linhas = linhasExportProdutos(existentes, familias)
  assert.equal(linhas[0].descricao, 'Cerveja Long Neck 330ml')
  assert.equal(linhas[0].preco_venda, '12,9')
  assert.equal(linhas[1].familia, '')
  assert.equal(linhas[2].estoque_minimo, '1500,5')
  const previa = prepararProdutos(lerTabela(comoPlanilha('produtos', linhas), 'produtos').linhas, { familias, existentes })
  assert.deepEqual(previa.map((p) => [p.acao, p.alvo, p.erros]), [['sem_mudanca', 1, []], ['sem_mudanca', 3, []], ['sem_mudanca', 2, []]])
})

test('produtos: editar uma célula da planilha exportada = só aquele campo muda', () => {
  const existentes = [prod({ codigoProduto: 1, codigo: '90001', descricao: 'Água 500ml', valorUnitario: 5 })]
  const linhas = linhasExportProdutos(existentes, [])
  linhas[0].preco_venda = '6,5'
  const [p] = prepararProdutos(lerTabela(comoPlanilha('produtos', linhas), 'produtos').linhas, { familias: [], existentes })
  assert.equal(p.acao, 'atualizar')
  assert.deepEqual(p.dados, { valor_unitario: 6.5 })
})

test('fornecedores: exportar e importar de volta = "sem mudança"', () => {
  const f = (x: Partial<FornecedorExistente> & { id: number; razaoSocial: string }): FornecedorExistente => ({
    nomeFantasia: null, cnpjCpf: null, inscricaoEstadual: null, email: null, telefone: null, cep: null, uf: null, cidade: null, bairro: null,
    logradouro: null, numero: null, complemento: null, ...x,
  })
  const existentes = [
    f({ id: 7, razaoSocial: 'Hortifruti Bahia Ltda', cnpjCpf: '11222333000181', uf: 'BA', cidade: 'Salvador', cep: '40000000', email: 'a@b.com.br' }),
    f({ id: 8, razaoSocial: 'Ana Souza', cnpjCpf: '52998224725' }),
  ]
  const linhas = linhasExportFornecedores(existentes)
  const previa = prepararFornecedores(lerTabela(comoPlanilha('fornecedores', linhas), 'fornecedores').linhas, { existentes })
  assert.deepEqual(previa.map((p) => [p.acao, p.alvo]), [['sem_mudanca', 8], ['sem_mudanca', 7]])
})
