import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarLinhas, rotuloCfopEntrada, rotuloCfopSaida, formatarCnpj, formatarNcm, cstIcmsEntrada, rotuloParcelas, situacaoDaNota, diaBahia, type ItemEntrada, type NotaEntrada } from './entradas-contabil-puro.ts'
import { COLUNAS_ENTRADAS_OMIE } from './entradas-colunas.ts'
import { XML_CRBS_131055, CHAVE_CRBS } from '../estoque/fixtures/nfe-crbs-131055.ts'

const nota: NotaEntrada = {
  numero: '131055', serie: '1', chave: CHAVE_CRBS, emissao: '2026-10-20', fornecedorRazao: 'CRBS S/A', fornecedorFantasia: null,
  fornecedorCnpj: '99111222000149', fornecedorIe: '123456789', fornecedorCidade: 'Simões Filho', fornecedorUf: 'BA',
  cancelada: false, canceladaEm: null, registradaEm: '2026-10-21T01:30:00Z', origem: 'sefaz', manifestacao: '210210', xml: XML_CRBS_131055,
}
const item: ItemEntrada = {
  linha: 1, cProd: '0023552', descricao: 'INDAIA AGUA MINERAL S/GAS GFA PET 500ML PACK C/12', ean: '7896445412927', ncm: '22011000', cfop: '5405',
  unidadeCompra: 'cx', quantidade: 10, valorUnitario: 16.299516, valorTotal: 163, desconto: 0, fator: 12, quantidadeRecebida: null,
  unidadeEstoque: 'UN', custoUnitarioBase: 1.47, cfopEntrada: '1403', lancado: true, matchOrigem: 'manual', movimentaEstoque: true,
  geraContaPagar: true, lote: null, validade: null,
  flags: { icms: false, icmsSt: true, ipi: true, pis: false, cofins: false, frete: true, seguro: true, outras: true },
  aliqCredPis: 0, aliqCredCofins: 0,
  produto: { codigo: '90012', descricao: 'AGUA MINERAL 500ML', familia: 'Bebidas', tipoItem: '00' },
  local: { codigo: 'BAR', descricao: 'Bar' }, categoria: 'Compras de Mercadorias para Revenda', cmcAtual: 1.5, estoqueDisponivel: 48,
}

test('toda linha tem as 195 colunas, na ordem do Omie', () => {
  const [l] = montarLinhas(nota, { status: 'lancada', lancadaEm: '2026-10-22T15:00:00Z', obs: null }, [item])
  assert.equal(COLUNAS_ENTRADAS_OMIE.length, 195)
  assert.deepEqual(Object.keys(l), [...COLUNAS_ENTRADAS_OMIE])
  for (const c of COLUNAS_ENTRADAS_OMIE) assert.notEqual(l[c], undefined, c)
})

test('item da nota: dados do XML, do produto interno e da entrada', () => {
  const [l] = montarLinhas(nota, { status: 'lancada', lancadaEm: '2026-10-22T15:00:00Z', obs: null }, [item])
  assert.equal(l['Situação'], 'Concluído')
  assert.equal(l['Etapa'], 'Recebido')
  assert.equal(l['Nota Fiscal'], '000131055')
  assert.equal(l['Fornecedor/Cliente (CNPJ/CPF)'], '99.111.222/0001-49')
  assert.equal(l['Código do Produto'], '90012')
  assert.equal(l['Descrição do Produto (completa)'], '90012 - AGUA MINERAL 500ML')
  assert.equal(l['Código NCM'], '2201.10.00')
  assert.equal(l['CFOP de Entrada'], '1.403 - ' + rotuloCfopEntrada('1403').split(' - ')[1])
  assert.match(String(l['CFOP no Documento Fiscal']), /^5\.405 - Venda de mercadoria/)
  assert.equal(l['Quantidade'], 120) // 10 caixas × 12
  assert.equal(l['Unidade'], 'UN')
  assert.equal(l['Quantidade na Nota Fiscal'], 10)
  assert.equal(l['Unidade na Nota Fiscal'], 'cx')
  assert.equal(l['Outras Despesas Acessórias'], 13.41)
  assert.equal(l['Total do Documento Fiscal'], 176.41)
  assert.match(String(l['Situação Tributária do ICMS']), /^60 - ICMS cobrado anteriormente/)
  assert.match(String(l['Entrada - Situação Tributária do ICMS']), /^60 - /)
  assert.equal(l['Situação Tributária do IPI'], '53 - Saída não-tributada')
  assert.equal(l['Situação Tributária do PIS'], '06 - Operação Tributável (alíquota zero)')
  assert.equal(l['Manifestação do Destinatário'], 'Ciência da Operação')
  assert.equal(l['Tipo da Mercadoria'], '00 - Mercadoria para Revenda')
  assert.equal(l['Local de Estoque (Descrição)'], 'Bar')
  assert.equal(l['Gera Conta a Pagar'], 'Sim')
  assert.deepEqual(l['Data de Registro'], new Date(Date.UTC(2026, 9, 20))) // 01:30 UTC = 22:30 do dia 20 na Bahia
  assert.deepEqual(l['Data do Recebimento'], new Date(Date.UTC(2026, 9, 22)))
})

test('nota pendente, sem XML completo e item sem produto: N/D onde não tem', () => {
  const [l] = montarLinhas({ ...nota, xml: null, manifestacao: null }, { status: 'pendente', lancadaEm: null, obs: null },
    [{ ...item, produto: null, lancado: false, local: null, cfopEntrada: null, flags: null }])
  assert.equal(l['Situação'], 'Faturado pelo Fornecedor')
  assert.equal(l['Data do Recebimento'], 'N/D')
  assert.equal(l['Código do Produto'], 'N/D')
  assert.equal(l['Situação do Item'], 'Não associado')
  assert.equal(l['CFOP de Entrada'], 'N/D')
  assert.equal(l['Número de Parcelas'], 'N/D')
  assert.equal(l['Custo de Estoque - ICMS é Custo'], 'N/D')
  assert.equal(l['Entrada - Situação Tributária do ICMS'], 'N/D')
})

test('rótulos e formatos', () => {
  assert.equal(formatarCnpj('12345678901'), '123.456.789-01')
  assert.equal(formatarCnpj(''), 'N/D')
  assert.equal(formatarNcm('123'), '123')
  assert.equal(rotuloCfopSaida('5102'), '5.102 - Venda de mercadoria adquirida ou recebida de terceiros')
  assert.equal(rotuloCfopSaida('5999'), '5.999')
  assert.match(cstIcmsEntrada('00', null), /^90 - Outros/)
  assert.match(cstIcmsEntrada(null, '500'), /^60 - /)
  assert.equal(rotuloParcelas(0), 'A Vista')
  assert.equal(rotuloParcelas(1), '1 Parcela')
  assert.equal(rotuloParcelas(3), '3 parcelas')
  assert.equal(situacaoDaNota({ cancelada: true }, { status: 'lancada', lancadaEm: null, obs: null }).situacao, 'Cancelado')
  assert.equal(diaBahia('2026-10-01T02:59:00Z'), '2026-09-30')
})
