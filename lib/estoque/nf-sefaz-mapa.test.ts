import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lerNfe } from './nfe-xml.ts'
import { itensDaNota, cabecalhoDaNota, alertasDaNota, ratearFrete, cabecalhoDoResumo } from './nf-sefaz-mapa.ts'

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
