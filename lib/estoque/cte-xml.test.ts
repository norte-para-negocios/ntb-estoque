import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lerCte, validarCteImportado, ratearFreteCte, ratearFreteItens } from './cte-xml.ts'
import { CHAVE_CRBS } from './fixtures/nfe-crbs-131055.ts'

const CTE = '29261011222333000144570010000043211112233440'
// CT-e de mentira com a forma do cteProc 4.00: transportadora 11222333000144, tomador = destinatário (ODARA), 1 NF-e (a da CRBS).
const XML_CTE = `<?xml version="1.0" encoding="UTF-8"?><cteProc xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00"><CTe xmlns="http://www.portalfiscal.inf.br/cte"><infCte Id="CTe${CTE}" versao="4.00">` +
  `<ide><cUF>29</cUF><CFOP>5353</CFOP><natOp>PRESTACAO DE SERVICO DE TRANSPORTE</natOp><mod>57</mod><serie>1</serie><nCT>4321</nCT><dhEmi>2026-10-18T09:00:00-03:00</dhEmi><tpAmb>1</tpAmb><toma3><toma>3</toma></toma3></ide>` +
  `<emit><CNPJ>11222333000144</CNPJ><IE>99999</IE><xNome>Transp Rapido Ltda</xNome></emit>` +
  `<rem><CNPJ>99111222000149</CNPJ><xNome>CRBS S/A</xNome></rem><dest><CNPJ>66764497000122</CNPJ><xNome>ODARA BEACH</xNome></dest>` +
  `<vPrest><vTPrest>120.00</vTPrest><vRec>120.00</vRec></vPrest><imp><ICMS><ICMS00><CST>00</CST><vBC>120.00</vBC><pICMS>7.00</pICMS><vICMS>8.40</vICMS></ICMS00></ICMS></imp>` +
  `<infCTeNorm><infCarga><vCarga>922.63</vCarga></infCarga><infDoc><infNFe><chave>${CHAVE_CRBS}</chave></infNFe></infDoc></infCTeNorm>` +
  `</infCte></CTe><protCTe versao="4.00"><infProt><tpAmb>1</tpAmb><chCTe>${CTE}</chCTe><nProt>129260000000999</nProt><cStat>100</cStat></infProt></protCTe></cteProc>`

test('lê o CT-e: valor, tomador e notas transportadas', () => {
  const c = lerCte(XML_CTE)
  assert.equal(c.chave, CTE); assert.equal(c.valorPrestacao, 120); assert.equal(c.icms, 8.4); assert.equal(c.tomadorCnpj, '66764497000122')
  assert.deepEqual(c.chavesNfe, [CHAVE_CRBS])
  assert.equal(c.numero, '4321'); assert.equal(c.modelo, '57'); assert.equal(c.cfop, '5353'); assert.deepEqual(c.emitente, { cnpj: '11222333000144', nome: 'Transp Rapido Ltda' })
  assert.deepEqual(validarCteImportado(c, '66764497000122'), [])
  assert.deepEqual(validarCteImportado(c, '11111111000111'), ['Este CT-e não é pago por esta loja (tomador 66764497000122).'])
})
test('tomador pelo toma4 e pelo remetente (toma3 = 0); CT-e sem protocolo ou de homologação recusado', () => {
  const t4 = lerCte(XML_CTE.replace('<toma3><toma>3</toma></toma3>', '<toma4><toma>4</toma><CNPJ>55444333000122</CNPJ></toma4>'))
  assert.equal(t4.tomadorCnpj, '55444333000122')
  assert.equal(lerCte(XML_CTE.replace('<toma>3</toma>', '<toma>0</toma>')).tomadorCnpj, '99111222000149')
  const semProt = lerCte(XML_CTE.replace(/<protCTe[\s\S]*<\/protCTe>/, ''))
  assert.ok(validarCteImportado(semProt, '66764497000122').some((e) => e.includes('autoriz')))
  assert.ok(validarCteImportado(lerCte(XML_CTE.replace('<tpAmb>1</tpAmb><toma3>', '<tpAmb>2</tpAmb><toma3>')), '66764497000122').some((e) => e.includes('homologação')))
  assert.throws(() => lerCte('<nfeProc/>'), /CT-e/)
})
test('rateio do CT-e entre notas e entre itens fecha no centavo (HIPÓTESE N8)', () => {
  assert.deepEqual(ratearFreteCte(120, [{ compraId: 1, valorNota: 922.63 }, { compraId: 2, valorNota: 300 }]), [{ compraId: 1, valor: 90.56, percentual: 75.4627 }, { compraId: 2, valor: 29.44, percentual: 24.5373 }])
  assert.deepEqual(ratearFreteItens(90.56, [{ linha: 1, base: 163 }, { linha: 2, base: 632.6 }, { linha: 3, base: 36.08 }]), [{ linha: 1, valor: 17.75 }, { linha: 2, valor: 68.88 }, { linha: 3, valor: 3.93 }])
  assert.deepEqual(ratearFreteItens(10, [{ linha: 1, base: 1 }, { linha: 2, base: 1 }, { linha: 3, base: 1 }]), [{ linha: 1, valor: 3.34 }, { linha: 2, valor: 3.33 }, { linha: 3, valor: 3.33 }])
  assert.deepEqual(ratearFreteCte(50, [{ compraId: 7, valorNota: 0 }]), [{ compraId: 7, valor: 50, percentual: 100 }])
})
