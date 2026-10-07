import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { lerRetornoDist, montarPedidoDistNsu, proximaConsulta, ESPERA_SEM_DOCUMENTO_MS, codigoUf, tipoDocumento, lerResNFe, lerEvento, montarEventoCiencia, cienciaRegistrada, lerRetornoEvento, urlDistribuicao, soapDistribuicao } from './sefaz-distdfe.ts'

const docz = (nsu: string, schema: string, conteudo: string) => `<docZip NSU="${nsu}" schema="${schema}">${gzipSync(Buffer.from(conteudo)).toString('base64')}</docZip>`
const RET = `<retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>1</tpAmb><cStat>138</cStat><xMotivo>Documento(s) localizado(s)</xMotivo><ultNSU>000000000000747</ultNSU><maxNSU>000000000000800</maxNSU><loteDistDFeInt>${docz('000000000000746', 'procNFe_v4.00.xsd', '<nfeProc><NFe/></nfeProc>')}${docz('000000000000747', 'resNFe_v1.01.xsd', '<resNFe/>')}</loteDistDFeInt></retDistDFeInt>`

test('monta o pedido por NSU com zeros à esquerda e valida o CNPJ', () => {
  const x = montarPedidoDistNsu('11.222.333/0001-44', 1, '747')
  assert.match(x, /<ultNSU>000000000000747<\/ultNSU>/)
  assert.match(x, /<CNPJ>11222333000144<\/CNPJ>/)
  assert.throws(() => montarPedidoDistNsu('123', 1, '0'), /CNPJ/)
})

test('lê a resposta, descompacta os docZip e separa nota completa de resumo', () => {
  const r = lerRetornoDist(RET)
  assert.equal(r.cStat, '138'); assert.equal(r.ultNsu, '000000000000747'); assert.equal(r.docs.length, 2)
  assert.equal(r.docs[0].xml, '<nfeProc><NFe/></nfeProc>'); assert.equal(r.docs[0].completo, true)
  assert.equal(r.docs[1].completo, false)
})

test('continua enquanto há NSU a buscar; espera 1 hora quando não há novidade ou consumo indevido', () => {
  assert.deepEqual(proximaConsulta(lerRetornoDist(RET), 1000), { continuarJa: true, esperarAte: null })
  const fim = lerRetornoDist(RET.replace('000000000000800', '000000000000747'))
  assert.equal(proximaConsulta(fim, 1000).esperarAte, 1000 + ESPERA_SEM_DOCUMENTO_MS)
  const semDoc = lerRetornoDist('<retDistDFeInt><cStat>137</cStat><xMotivo>Nenhum documento localizado</xMotivo><ultNSU>0</ultNSU><maxNSU>0</maxNSU></retDistDFeInt>')
  assert.equal(proximaConsulta(semDoc, 5).continuarJa, false)
  const abuso = lerRetornoDist('<retDistDFeInt><cStat>656</cStat><xMotivo>Consumo Indevido</xMotivo><ultNSU>0</ultNSU><maxNSU>0</maxNSU></retDistDFeInt>')
  assert.equal(proximaConsulta(abuso, 5).esperarAte, 5 + ESPERA_SEM_DOCUMENTO_MS)
})

test('códigos de UF, URLs e envelope da distribuição', () => {
  assert.equal(codigoUf('ba'), '29'); assert.equal(codigoUf('SP'), '35'); assert.equal(codigoUf(null), '29')
  assert.match(urlDistribuicao(1), /^https:\/\/www1\.nfe\.fazenda\.gov\.br\/NFeDistribuicaoDFe/)
  assert.match(urlDistribuicao(2), /^https:\/\/hom1\./)
  const s = soapDistribuicao(montarPedidoDistNsu('11222333000144', 1, '0'))
  assert.match(s, /<nfeDistDFeInteresse xmlns="http:\/\/www\.portalfiscal\.inf\.br\/nfe\/wsdl\/NFeDistribuicaoDFe"><nfeDadosMsg><distDFeInt/)
})

test('classifica o schema e lê o resumo da nota e o evento de cancelamento', () => {
  assert.equal(tipoDocumento('procNFe_v4.00.xsd'), 'procNFe'); assert.equal(tipoDocumento('resNFe_v1.01.xsd'), 'resNFe')
  assert.equal(tipoDocumento('procEventoNFe_v1.00.xsd'), 'procEventoNFe'); assert.equal(tipoDocumento('resEvento_v1.01.xsd'), 'resEvento'); assert.equal(tipoDocumento('x'), 'outro')
  const ch = '29102611222333000144550010000012341000012342'
  const r = lerResNFe(`<resNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><chNFe>${ch}</chNFe><CNPJ>11222333000144</CNPJ><xNome>Horti</xNome><IE>123</IE><dhEmi>2026-10-05T10:30:00-03:00</dhEmi><tpNF>1</tpNF><vNF>315.00</vNF><cSitNFe>1</cSitNFe></resNFe>`)
  assert.deepEqual([r.chave, r.cnpj, r.nome, r.emissao, r.tipoOperacao, r.valor, r.situacao], [ch, '11222333000144', 'Horti', '2026-10-05', '1', 315, '1'])
  const e = lerEvento(`<resEvento xmlns="http://www.portalfiscal.inf.br/nfe"><chNFe>${ch}</chNFe><tpEvento>110111</tpEvento><xEvento>Cancelamento</xEvento></resEvento>`)
  assert.deepEqual([e.chave, e.tpEvento], [ch, '110111'])
})

test('evento de ciência da operação (210210) no órgão 91, sem assinatura ainda', () => {
  const ch = '29102611222333000144550010000012341000012342'
  const { xml, id } = montarEventoCiencia({ chave: ch, cnpj: '66.764.497/0001-22', tpAmb: 1 })
  assert.equal(id, `ID210210${ch}01`)
  assert.match(xml, /<cOrgao>91<\/cOrgao><tpAmb>1<\/tpAmb><CNPJ>66764497000122<\/CNPJ>/)
  assert.match(xml, /<tpEvento>210210<\/tpEvento><nSeqEvento>1<\/nSeqEvento>/)
  assert.match(xml, /<descEvento>Ciencia da Operacao<\/descEvento>/)
  assert.throws(() => montarEventoCiencia({ chave: '123', cnpj: '66764497000122', tpAmb: 1 }), /Chave/)
  assert.ok(cienciaRegistrada('135') && cienciaRegistrada('573') && !cienciaRegistrada('650'))
  const ret = lerRetornoEvento('<retEnvEvento><cStat>128</cStat><retEvento><infEvento><cStat>135</cStat><xMotivo>Evento registrado</xMotivo></infEvento></retEvento></retEnvEvento>')
  assert.deepEqual([ret.cStatLote, ret.cStat, ret.xMotivo], ['128', '135', 'Evento registrado'])
})
