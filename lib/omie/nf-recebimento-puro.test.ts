import { test } from 'node:test'
import assert from 'node:assert/strict'
import { colunasDaNota, colunasDosItens, faltasDoRecebimento } from './nf-recebimento-puro.ts'

// NF 3999 (loja 5) como o ListarRecebimentos devolve (formato real gravado em notas_fiscais.full_object; fornecedor
// omitido) e a mesma nota no formato documentado do ConsultarRecebimento (omie-rea/endpoints/public-api/
// stock-and-purchase-detail.md, `rcbtoConsultarResponse`: mesmos blocos + `cteCfopEntrada`; a doc escreve `cChaveNfe`
// e infoAdicionais como lista).
const itens = [
  { itensCabec: { nSequencia: 3, nIdItem: 1, nIdPedido: 0, nIdItPedido: 0, nIdProduto: 2657120569, cCodigoProduto: '80104', cDescricaoProduto: 'PEIXE PESCADA AMARELA (MP)', cIgnorarItem: 'N', cAdicionarNovo: 'N', cAssociarExistente: 'S', cItemDevolvido: 'N', cNCM: '0302.89.90', cEAN: '', cCFOP: '5.102', nQtdeNFe: 72, cUnidadeNfe: 'KG', nPrecoUnit: 41.585139 }, itensAjustes: { nQtdeRecebida: 72 } },
  { itensCabec: { nSequencia: 4, nIdItem: 2, nIdPedido: 0, nIdItPedido: 0, nIdProduto: 2459425966, cCodigoProduto: '80107', cDescricaoProduto: 'PEIXE (MP)', cIgnorarItem: 'N', cAdicionarNovo: 'N', cAssociarExistente: 'S', cItemDevolvido: 'N', cNCM: '0302.89.90', cEAN: '', cCFOP: '5.102', nQtdeNFe: 41.1, cUnidadeNfe: 'KG', nPrecoUnit: 74.7 }, itensAjustes: { nQtdeRecebida: 38.073643 } },
]
const cabec = { nIdReceb: 3817713557, nIdFornecedor: 2470796234, cPessoaFisica: 'N', cNome: 'X', cRazaoSocial: 'X LTDA', cInscricao: '', cCNPJ_CPF: '00.000.000/0001-00', cEtapa: '60', cNumeroNFe: '3999', cSerieNFe: '1', cModeloNFe: '55', dEmissaoNFe: '15/09/2026', nValorNFe: 10430.77, cAmbienteNFe: 'P', cNaturezaOperacao: 'VENDA' }
const LISTAR = { cabec: { ...cabec, cChaveNFe: '2926…3999' }, infoCadastro: { dRec: '07/10/2026', cCancelada: 'N' }, infoAdicionais: { dRegistro: '17/09/2026' }, totais: {}, parcelas: {}, transporte: {}, itensRecebimento: itens }
const CONSULTAR = { cabec: { ...cabec, cChaveNfe: '2926…3999' }, infoCadastro: { dRec: '07/10/2026', cCancelada: 'N' }, infoAdicionais: [{ dRegistro: '17/09/2026' }], totais: {}, parcelas: {}, transporte: {}, departamentos: [], categorias: [], observacoes: [], cteCfopEntrada: [], itensRecebimento: itens }

test('ConsultarRecebimento e ListarRecebimentos dão as mesmas colunas', () => {
  assert.deepEqual(faltasDoRecebimento(LISTAR), [])
  assert.deepEqual(faltasDoRecebimento(CONSULTAR), [])
  assert.deepEqual(colunasDaNota(CONSULTAR), colunasDaNota(LISTAR))
  assert.deepEqual(colunasDosItens(CONSULTAR), colunasDosItens(LISTAR))
  const n = colunasDaNota(LISTAR)
  assert.equal(n.n_id_receb, '3817713557'); assert.equal(n.c_chave_nfe, '2926…3999'); assert.equal(n.d_emissao_nfe, '2026-09-15'); assert.equal(n.c_etapa, '60')
  const it = colunasDosItens(CONSULTAR)
  assert.equal(it.length, 2); assert.equal(it[1].n_id_produto, 2459425966); assert.equal(it[1].n_sequencia, 4); assert.equal(it[1].produto_codigo, '2459425966')
})

test('resposta sem campo obrigatório não grava (a cópia do banco fica)', () => {
  assert.deepEqual(faltasDoRecebimento({}), ['cabec'])
  assert.deepEqual(faltasDoRecebimento({ cabec: { ...cabec, cEtapa: '' }, itensRecebimento: itens }), ['cabec.cEtapa'])
  assert.deepEqual(faltasDoRecebimento({ cabec }), ['itensRecebimento'])
  assert.deepEqual(faltasDoRecebimento({ cabec, itensRecebimento: [{ itensCabec: {} }] }), ['itensRecebimento[0].itensCabec.nSequencia'])
  assert.deepEqual(faltasDoRecebimento({ cabec: { ...cabec, nIdReceb: undefined }, itensRecebimento: [] }), ['cabec.nIdReceb'])
})
