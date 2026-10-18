import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lerNfe } from './nfe-xml.ts'
import { itensDaNota, cabecalhoDaNota, alertasDaNota, ratearFrete, cabecalhoDoResumo, itensComDespesasDoTotal, totalEsperadoDaNota, itemCompraSefaz } from './nf-sefaz-mapa.ts'
import { flagsDeTexto } from './nf-item-regras.ts'
import { XML_CRBS_131055 } from './fixtures/nfe-crbs-131055.ts'

const CHAVE = '29102611222333000144550010000012341000012342'
const XML = `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${CHAVE}">
 <ide><tpNF>1</tpNF><mod>55</mod><serie>1</serie><nNF>1234</nNF><dhEmi>2026-10-05T10:30:00-03:00</dhEmi><natOp>Venda</natOp></ide>
 <emit><CNPJ>11222333000144</CNPJ><xNome>Horti</xNome><IE>123</IE></emit><dest><CNPJ>66764497000122</CNPJ><xNome>ODARA</xNome></dest>
 <det nItem="1"><prod><cProd>L1</cProd><cEAN>SEM GTIN</cEAN><xProd>Limao</xProd><NCM>08055000</NCM><CFOP>5102</CFOP><uCom>KG</uCom><qCom>10</qCom><vUnCom>6</vUnCom><vProd>60.00</vProd></prod></det>
 <det nItem="2"><prod><cProd>C1</cProd><cEAN>7891234567895</cEAN><xProd>Cerveja</xProd><NCM>22030000</NCM><CFOP>5405</CFOP><uCom>UN</uCom><qCom>20</qCom><vUnCom>2</vUnCom><vProd>40.00</vProd></prod></det>
 <total><ICMSTot><vProd>100.00</vProd><vFrete>10.00</vFrete><vDesc>0.00</vDesc><vNF>110.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`

test('frete é rateado por valor líquido e fecha no total', () => {
  const n = lerNfe(XML)
  const f = ratearFrete(n)
  assert.deepEqual(f, [6, 4])
  const it = itensDaNota(n)
  assert.equal(it[0].total, 66); assert.equal(it[1].total, 44); assert.equal(it[0].preco_unit, 6)
})

test('cabeçalho no formato do Omie: cabec, infoCadastro, totais e bloco sefaz', () => {
  const n = lerNfe(XML)
  const c = cabecalhoDaNota(n, { ambiente: '1', origem: 'sefaz', alertas: [] })
  assert.equal(c.valor, 110); assert.equal(c.fornecedor_cnpj, '11222333000144'); assert.equal(c.emissao, '2026-10-05')
  const fo = c.full_object as any
  assert.equal(fo.cabec.cCNPJ_CPF, '11222333000144'); assert.equal(fo.infoCadastro.cRecebido, 'N'); assert.equal(fo.totais.vTotalProdutos, 100)
  assert.equal(fo.sefaz.completo, true); assert.equal(fo.sefaz.origem, 'sefaz')
})

test('alertas: destinatário diferente e total que não fecha', () => {
  const n = lerNfe(XML)
  assert.deepEqual(alertasDaNota(n, '66764497000122'), [])
  assert.equal(alertasDaNota(n, '00000000000191').length, 1)
  const ruim = lerNfe(XML.replace('<vNF>110.00</vNF>', '<vNF>150.00</vNF>'))
  assert.ok(alertasDaNota(ruim, '66764497000122').some((x) => x.includes('não bate')))
})

test('resumo (resNFe) vira nota sem itens', () => {
  const c = cabecalhoDoResumo({ chave: CHAVE, cnpj: '11222333000144', nome: 'Horti', ie: null, emissao: '2026-10-05', tipoOperacao: '1', valor: 110, situacao: '1' }, '1', '000000000000042')
  assert.equal(c.numero, '1234'); assert.equal(c.serie, '1'); assert.equal(c.modelo, '55'); assert.equal((c.full_object as any).sefaz.completo, false)
})

// Fixture antiga do nfe-xml.test.ts: frete 20 + seguro 5 + outras 5 e desconto 15 (10 nos itens) só no total.
const CH2 = '29102611222333000144550010000012341000012342'
const XML_DESPESAS = `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${CH2}">
  <ide><mod>55</mod><serie>1</serie><nNF>1234</nNF><dhEmi>2026-10-05T10:30:00-03:00</dhEmi></ide>
  <emit><CNPJ>11222333000144</CNPJ><xNome>Hortifruti</xNome></emit>
  <det nItem="1"><prod><cProd>L1</cProd><xProd>Limao</xProd><CFOP>5102</CFOP><uCom>CX</uCom><qCom>2</qCom><vUnCom>100</vUnCom><vProd>200.00</vProd><vDesc>10.00</vDesc></prod><imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS></imposto></det>
  <det nItem="2"><prod><cProd>C1</cProd><xProd>Cerveja</xProd><CFOP>5405</CFOP><uCom>FD</uCom><qCom>1</qCom><vUnCom>100</vUnCom><vProd>100.00</vProd></prod><imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vICMS>18.00</vICMS></ICMS00></ICMS></imposto></det>
  <total><ICMSTot><vProd>300.00</vProd><vFrete>20.00</vFrete><vSeg>5.00</vSeg><vDesc>15.00</vDesc><vOutro>5.00</vOutro><vNF>315.00</vNF><vICMS>18.00</vICMS></ICMSTot></total>
 </infNFe></NFe></nfeProc>`

test('total esperado com IPI e outras despesas no item: nota da CRBS não fica divergente', () => {
  const n = lerNfe(XML_CRBS_131055) // vNF da fixture = 176,41 + 706,35 + 39,87 = 922,63
  assert.equal(totalEsperadoDaNota(n), 922.63); assert.deepEqual(alertasDaNota(n, '66764497000122'), [])
  assert.equal(totalEsperadoDaNota(lerNfe(XML_DESPESAS)), 315)
})
test('frete, seguro, outras e desconto só no total são rateados nos itens (fixture antiga: 20 + 5 + 5, desconto 5)', () => {
  const { itens, aviso } = itensComDespesasDoTotal(lerNfe(XML_DESPESAS))
  assert.deepEqual(itens.map((i) => [i.fiscal.frete, i.fiscal.seguro, i.fiscal.outras]), [[13.1, 3.28, 3.28], [6.9, 1.72, 1.72]])
  assert.deepEqual(itens.map((i) => i.valorTotalItem), [206.38, 108.62])
  assert.deepEqual(itens.map((i) => i.desconto), [13.28, 1.72])
  assert.ok(aviso)
  assert.equal(itensComDespesasDoTotal(lerNfe(XML_CRBS_131055)).aviso, null) // NF-e 4.0: o total é a soma dos itens
})
test('cabeçalho com os totais no formato do Omie (X7)', () => {
  const fo = cabecalhoDaNota(lerNfe(XML_CRBS_131055), { ambiente: '1', origem: 'sefaz', alertas: [] }).full_object as any
  assert.equal(fo.totais.vTotalNFe, 922.63); assert.equal(fo.totais.vTotalIPI, 20.8); assert.equal(fo.totais.vOutrasDespesas, 70.15); assert.equal(fo.transporte.cPlaca, 'ABC1D23')
  assert.equal(fo.totais.vTotalPIS, 11.29); assert.equal(fo.totais.vTotalCOFINS, 51.82); assert.equal(fo.totais.vTotalProdutos, 831.68)
  assert.equal(fo.transporte.cRNTRC, '123456'); assert.equal(fo.transporte.cMarcaVolume, 'AMBEV'); assert.equal(fo.transporte.cLacres, 'L001')
})
test('itemCompraSefaz leva a configuração inicial e os valores fiscais', () => {
  const i = lerNfe(XML_CRBS_131055).itens[1]
  const cfg = { flags: flagsDeTexto('NNNNNNNN')!, origemFlags: 'regra', cfopEntrada: '1407', origemCfop: 'tabela', movimentaEstoque: true, geraContaPagar: true, unidadeEstoque: 'UN', codigoLocal: 2746972551, aliqCredPis: 0, aliqCredCofins: 0 } as const
  const p = itemCompraSefaz(i, { codigoProduto: 3258506483, fator: 24, origem: 'depara', score: 1, sugestao: null }, cfg)
  assert.equal(p.valor_total_item, 706.35); assert.equal(p.ipi_valor, 20.04); assert.equal(p.outras_valor, 53.71)
  assert.equal(p.custo_flags, 'NNNNNNNN'); assert.equal(p.cfop_entrada, '1407'); assert.equal(p.codigo_local_estoque, 2746972551); assert.equal(p.fator, 24)
  assert.equal(p.origem_flags, 'regra'); assert.equal(p.movimenta_estoque, true); assert.equal((p.fiscal as any).cst, '60')
})
