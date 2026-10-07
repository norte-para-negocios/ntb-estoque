import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lerNfe, parseXml, dvChave } from './nfe-xml.ts'

const CHAVE = '29102611222333000144550010000012341000012342'
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
 <NFe><infNFe Id="NFe${CHAVE}" versao="4.00">
  <ide><mod>55</mod><serie>1</serie><nNF>1234</nNF><dhEmi>2026-10-05T10:30:00-03:00</dhEmi><natOp>Venda de mercadoria</natOp></ide>
  <emit><CNPJ>11222333000144</CNPJ><xNome>Hortifruti &amp; Cia Ltda</xNome><xFant>Horti</xFant><IE>123456</IE></emit>
  <det nItem="1"><prod><cProd>L1</cProd><cEAN>SEM GTIN</cEAN><xProd>Limão Tahiti cx 20kg</xProd><NCM>08055000</NCM><CFOP>5102</CFOP><uCom>CX</uCom><qCom>2.0000</qCom><vUnCom>100.0000000000</vUnCom><vProd>200.00</vProd><vDesc>10.00</vDesc></prod>
   <imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS></imposto></det>
  <det nItem="2"><prod><cProd>C1</cProd><cEAN>7891234567895</cEAN><xProd><![CDATA[Cerveja <Pilsen> fardo]]></xProd><NCM>22030000</NCM><CFOP>5405</CFOP><uCom>FD</uCom><qCom>1</qCom><vUnCom>100</vUnCom><vProd>100.00</vProd></prod>
   <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vICMS>18.00</vICMS></ICMS00></ICMS></imposto></det>
  <total><ICMSTot><vProd>300.00</vProd><vFrete>20.00</vFrete><vSeg>5.00</vSeg><vDesc>15.00</vDesc><vOutro>5.00</vOutro><vNF>315.00</vNF><vICMS>18.00</vICMS></ICMSTot></total>
 </infNFe></NFe>
 <protNFe><infProt><chNFe>${CHAVE}</chNFe></infProt></protNFe>
</nfeProc>`

test('lê cabeçalho, fornecedor e itens do procNFe', () => {
  const n = lerNfe(XML)
  assert.equal(n.chave, CHAVE)
  assert.equal(n.numero, '1234'); assert.equal(n.serie, '1'); assert.equal(n.emissao, '2026-10-05'); assert.equal(n.modelo, '55')
  assert.equal(n.fornecedor.cnpj, '11222333000144')
  assert.equal(n.fornecedor.nome, 'Hortifruti & Cia Ltda')
  assert.equal(n.itens.length, 2)
  assert.deepEqual(n.itens[0], { linha: 1, cProd: 'L1', ean: null, descricao: 'Limão Tahiti cx 20kg', ncm: '08055000', cfop: '5102', unidade: 'CX', quantidade: 2, valorUnitario: 100, valorTotal: 200, desconto: 10, icms: 0 })
  assert.equal(n.itens[1].descricao, 'Cerveja <Pilsen> fardo')
  assert.equal(n.itens[1].ean, '7891234567895'); assert.equal(n.itens[1].icms, 18)
  assert.deepEqual(n.avisos, [])
})

test('frete + seguro + outras despesas viram o frete da compra; desconto da nota exclui o dos itens', () => {
  const n = lerNfe(XML)
  assert.equal(n.valores.frete, 30)
  assert.equal(n.valores.desconto, 15)
  assert.equal(n.valores.descontoNota, 5) // 15 total - 10 já nos itens
  assert.equal(n.valores.total, 315)
})

test('CFOP do XML é só informativo: itens com CFOPs diferentes entram igual', () => {
  const n = lerNfe(XML)
  assert.deepEqual(n.itens.map((i) => i.cfop), ['5102', '5405'])
})

test('chave pelo protNFe quando o Id não existe, e NFe sem protocolo também lê', () => {
  const semId = XML.replace(`Id="NFe${CHAVE}" `, '')
  assert.equal(lerNfe(semId).chave, CHAVE)
  const soNfe = XML.replace(/<protNFe>[\s\S]*<\/protNFe>/, '')
  assert.equal(lerNfe(soNfe).chave, CHAVE)
})

test('rejeita resumo, XML sem NF-e, chave inválida e XML quebrado', () => {
  assert.throws(() => lerNfe('<resNFe><chNFe>1</chNFe></resNFe>'), /resumo/)
  assert.throws(() => lerNfe('<foo><bar/></foo>'), /Não é um XML de NF-e/)
  assert.throws(() => lerNfe(XML.replace(CHAVE, '123')), /Chave de acesso inválida/)
  assert.throws(() => parseXml('<a><b></a>'), /XML inválido/)
})

test('dígito verificador errado vira aviso, não erro', () => {
  const n = lerNfe(XML.split(CHAVE).join(CHAVE.slice(0, 43) + '9'))
  assert.ok(n.avisos.some((a) => /dígito verificador/.test(a)))
})

test('dvChave confere com a chave de exemplo', () => {
  assert.equal(dvChave(CHAVE.slice(0, 43)), 2)
})

test('soma dos itens diferente do total vira aviso', () => {
  const n = lerNfe(XML.replace('<vProd>300.00</vProd>', '<vProd>350.00</vProd>'))
  assert.ok(n.avisos.some((a) => /não bate/.test(a)))
})

test('extras: destinatário, tipo da operação, transporte, parcelas e tributos aproximados', () => {
  const xml = XML.replace('<ide><mod>55</mod>', '<ide><tpNF>1</tpNF><mod>55</mod>')
    .replace('<det nItem="1">', '<dest><CNPJ>66764497000122</CNPJ><xNome>ODARA BEACH</xNome></dest><det nItem="1">')
    .replace('<total>', '<transp><modFrete>0</modFrete><transporta><CNPJ>99888777000155</CNPJ><xNome>Transp Rapido</xNome></transporta><vol><qVol>3</qVol><esp>CX</esp><pesoB>12.5</pesoB></vol></transp><cobr><dup><nDup>001</nDup><dVenc>2026-11-05</dVenc><vDup>150.00</vDup></dup><dup><nDup>002</nDup><dVenc>2026-12-05</dVenc><vDup>165.00</vDup></dup></cobr><total>')
    .replace('<vICMS>18.00</vICMS></ICMSTot>', '<vICMS>18.00</vICMS><vTotTrib>40.00</vTotTrib></ICMSTot>')
  const n = lerNfe(xml)
  assert.equal(n.destinatario.cnpj, '66764497000122'); assert.equal(n.destinatario.nome, 'ODARA BEACH')
  assert.equal(n.tipoOperacao, '1')
  assert.equal(n.transporte.modFrete, '0'); assert.equal(n.transporte.nome, 'Transp Rapido'); assert.equal(n.transporte.cnpj, '99888777000155')
  assert.equal(n.transporte.pesoBruto, 12.5); assert.equal(n.transporte.volumes, '3'); assert.equal(n.transporte.especie, 'CX')
  assert.deepEqual(n.parcelas, [{ seq: 1, vencimento: '2026-11-05', valor: 150 }, { seq: 2, vencimento: '2026-12-05', valor: 165 }])
  assert.equal(n.tributosAprox, 40)
})

test('rastro: lote e validade do item; com vários lotes, entra o de validade mais próxima e avisa', () => {
  const comRastro = XML
    .replace('<vDesc>10.00</vDesc></prod>', '<vDesc>10.00</vDesc><rastro><nLote>L-B</nLote><qLote>1</qLote><dFab>2026-09-01</dFab><dVal>2026-11-30</dVal></rastro><rastro><nLote>L-A</nLote><qLote>1</qLote><dFab>2026-09-01</dFab><dVal>2026-10-20</dVal></rastro></prod>')
  const n = lerNfe(comRastro)
  assert.equal(n.itens[0].lote, 'L-A')
  assert.equal(n.itens[0].validade, '2026-10-20')
  assert.ok(n.avisos.some((a) => a.includes('2 lotes')))
  assert.equal(n.itens[1].lote ?? null, null)
  assert.equal(n.itens[1].validade ?? null, null)
})
