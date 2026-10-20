import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error: import com .ts exigido pelo node --test
import { classificar, envelope, lerRetornoAutorizacao, lerRetornoConsulta, lerRetornoEvento, montarConsReci, montarConsSit, montarEnvEvento, montarEventoCancelamento, montarEventoCce, montarProcEvento, trecho, validarCorrecao, validarJustificativa } from './sefaz-puro.ts'
// @ts-expect-error: idem
import { assinarEventoNfe } from './assinatura.ts'
// @ts-expect-error: idem
import { _hostsParaTeste, hostDaSefazPermitido, tpAmbDoXml, urlEhHomologacao, urlServico } from './webservices.ts'
// @ts-expect-error: idem
import { tpAmbDaNfe } from './ambiente.ts'
// @ts-expect-error: idem
import { certificadoDeTeste, temXmllint, validarXsd } from './teste-apoio.ts'

const CHAVE = '29261011222333000181559200000000071481516230'
const agora = new Date('2026-10-20T13:00:00Z')

test('ambiente: homologação por padrão; produção só com NFE_AMBIENTE=producao exato', () => {
  assert.equal(tpAmbDaNfe(undefined), 2)
  assert.equal(tpAmbDaNfe(''), 2)
  assert.equal(tpAmbDaNfe('1'), 2)
  assert.equal(tpAmbDaNfe('PRODUCAO'), 2)
  assert.equal(tpAmbDaNfe('producao '), 2)
  assert.equal(tpAmbDaNfe('homologacao'), 2)
  assert.equal(tpAmbDaNfe('producao'), 1)
})

test('web services: BA usa a SEFAZ-BA (hnfe/nfe), RJ usa a SVRS; homologação e produção nunca se misturam', () => {
  assert.equal(urlServico('BA', 2, 'NfeAutorizacao'), 'https://hnfe.sefaz.ba.gov.br/webservices/NFeAutorizacao4/NFeAutorizacao4.asmx')
  assert.equal(urlServico('ba', 1, 'RecepcaoEvento'), 'https://nfe.sefaz.ba.gov.br/webservices/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx')
  assert.match(urlServico('RJ', 2, 'NfeConsultaProtocolo'), /nfe-homologacao\.svrs\.rs\.gov\.br/)
  assert.throws(() => urlServico('XX', 2, 'NfeAutorizacao'))
  for (const h of _hostsParaTeste.homologacao) assert.ok(!_hostsParaTeste.producao.has(h), `host nas duas listas: ${h}`)
  assert.equal(urlEhHomologacao(urlServico('BA', 2, 'NfeAutorizacao')), true)
  assert.equal(urlEhHomologacao(urlServico('BA', 1, 'NfeAutorizacao')), false)
  assert.equal(hostDaSefazPermitido('https://hnfe.sefaz.ba.gov.br/x'), true)
  assert.equal(hostDaSefazPermitido('http://hnfe.sefaz.ba.gov.br/x'), false)
  assert.equal(hostDaSefazPermitido('https://evil.example.com/hnfe.sefaz.ba.gov.br'), false)
  assert.equal(tpAmbDoXml('<consSitNFe><tpAmb>2</tpAmb></consSitNFe>'), 2)
})

test('justificativa e correção: tamanho mínimo/máximo', () => {
  assert.ok(validarJustificativa('curta'))
  assert.equal(validarJustificativa('Nota emitida com erro de quantidade'), null)
  assert.ok(validarCorrecao('x'))
  assert.equal(validarCorrecao('Corrigir o endereço do destinatário para Rua B, 10'), null)
})

test('evento de cancelamento e CC-e: Id, cOrgao, CNPJ da chave e sequência', () => {
  const c = montarEventoCancelamento({ chave: CHAVE, tpAmb: 2, protocolo: '129260000000001', justificativa: 'Devolucao registrada em duplicidade', agora })
  assert.equal(c.id, `ID110111${CHAVE}01`)
  assert.match(c.xml, /<cOrgao>29<\/cOrgao><tpAmb>2<\/tpAmb><CNPJ>11222333000181<\/CNPJ>/)
  assert.match(c.xml, /<dhEvento>2026-10-20T10:00:00-03:00<\/dhEvento>/)
  const e = montarEventoCce({ chave: CHAVE, tpAmb: 2, seq: 3, correcao: 'Peso bruto correto é 13,5 kg', agora })
  assert.equal(e.id, `ID110110${CHAVE}03`)
  assert.match(e.xml, /<nSeqEvento>3<\/nSeqEvento>/)
  assert.throws(() => montarEventoCce({ chave: CHAVE, tpAmb: 2, seq: 21, correcao: 'Peso bruto correto é 13,5 kg' }))
  assert.throws(() => montarEventoCancelamento({ chave: CHAVE, tpAmb: 2, protocolo: '12', justificativa: 'Justificativa longa o bastante' }))
})

test('XSD oficial: envEvento de cancelamento e de CC-e assinados; consSitNFe e consReciNFe', { skip: !temXmllint() && 'xmllint ausente' }, () => {
  const { certPem, keyPem } = certificadoDeTeste()
  const c = montarEventoCancelamento({ chave: CHAVE, tpAmb: 2, protocolo: '129260000000001', justificativa: 'Devolução registrada em duplicidade', agora })
  assert.equal(validarXsd(montarEnvEvento(assinarEventoNfe(c.xml, c.id, certPem, keyPem), 7), 'envEventoCancNFe_v1.00.xsd'), null)
  const e = montarEventoCce({ chave: CHAVE, tpAmb: 2, seq: 1, correcao: 'Peso bruto correto é 13,5 kg', agora })
  assert.equal(validarXsd(montarEnvEvento(assinarEventoNfe(e.xml, e.id, certPem, keyPem), 8), 'envCCe_v1.00.xsd'), null)
  assert.equal(validarXsd(montarConsSit(2, CHAVE), 'consSitNFe_v4.00.xsd'), null)
  assert.equal(validarXsd(montarConsReci(2, '291000012345678'), 'consReciNFe_v4.00.xsd'), null)
})

test('envelope SOAP 1.2 com o namespace do serviço', () => {
  const s = envelope('NfeAutorizacao', '<enviNFe/>')
  assert.match(s, /<nfeDadosMsg xmlns="http:\/\/www.portalfiscal.inf.br\/nfe\/wsdl\/NFeAutorizacao4"><enviNFe\/><\/nfeDadosMsg>/)
})

// ---------------------------------------------------------------- retornos (formatos reais, dados de mentira)
const SOAP = (corpo: string) => `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">${corpo}</nfeResultMsg></soap:Body></soap:Envelope>`

test('autorização síncrona: o cStat que vale é o do protNFe (104 do lote nunca é autorização)', () => {
  const r = lerRetornoAutorizacao(SOAP(`<retEnviNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb><verAplic>BA</verAplic><cStat>104</cStat><xMotivo>Lote processado</xMotivo><cUF>29</cUF><dhRecbto>2026-10-20T10:15:05-03:00</dhRecbto><protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>BA</verAplic><chNFe>${CHAVE}</chNFe><dhRecbto>2026-10-20T10:15:05-03:00</dhRecbto><nProt>129260000000001</nProt><digVal>abc=</digVal><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe></retEnviNFe>`))
  assert.equal(r.status, 'autorizada')
  assert.equal(r.cStat, '100')
  assert.equal(r.protocolo, '129260000000001')
  assert.match(r.protNFe ?? '', /^<protNFe versao="4.00">/)
  const proc = montarProcEvento('<evento/>', '<retEvento versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe"><infEvento/></retEvento>')
  assert.match(proc, /<procEventoNFe xmlns="http:\/\/www.portalfiscal.inf.br\/nfe" versao="1.00"><evento\/><retEvento versao="1.00"><infEvento\/><\/retEvento>/)
})

test('rejeição com protNFe, rejeição de lote, recibo assíncrono, duplicidade e SEFAZ fora', () => {
  assert.equal(lerRetornoAutorizacao(`<retEnviNFe><cStat>104</cStat><protNFe><infProt><cStat>225</cStat><xMotivo>Rejeicao: Falha no Schema XML</xMotivo></infProt></protNFe></retEnviNFe>`).status, 'rejeitada')
  const lote = lerRetornoAutorizacao(`<retEnviNFe><cStat>215</cStat><xMotivo>Rejeicao: Falha no schema XML</xMotivo></retEnviNFe>`)
  assert.equal(lote.status, 'rejeitada')
  assert.equal(lote.cStat, '215')
  const rec = lerRetornoAutorizacao(`<retEnviNFe><cStat>103</cStat><xMotivo>Lote recebido com sucesso</xMotivo><infRec><nRec>291000012345678</nRec><tMed>1</tMed></infRec></retEnviNFe>`)
  assert.equal(rec.status, 'processando')
  assert.equal(rec.nRec, '291000012345678')
  assert.equal(classificar('204'), 'incerta')
  assert.equal(classificar('539'), 'incerta')
  assert.equal(classificar('108'), 'rejeitada')
  assert.equal(classificar('302'), 'denegada')
  assert.equal(classificar(null), 'incerta')
  // prefixo de namespace no retorno (algumas SEFAZ usam ns2:)
  const pref = lerRetornoAutorizacao(`<ns2:retEnviNFe xmlns:ns2="http://www.portalfiscal.inf.br/nfe"><ns2:cStat>104</ns2:cStat><ns2:protNFe versao="4.00"><ns2:infProt><ns2:cStat>100</ns2:cStat><ns2:nProt>129260000000009</ns2:nProt></ns2:infProt></ns2:protNFe></ns2:retEnviNFe>`)
  assert.equal(pref.status, 'autorizada')
  assert.equal(pref.protocolo, '129260000000009')
  assert.equal(pref.protNFe, '<protNFe versao="4.00"><infProt><cStat>100</cStat><nProt>129260000000009</nProt></infProt></protNFe>')
})

test('consulta por chave: 100 autorizada (com protNFe), 217 não existe (pode reenviar), 101 cancelada', () => {
  const ok = lerRetornoConsulta(`<retConsSitNFe><cStat>100</cStat><xMotivo>Autorizado</xMotivo><protNFe versao="4.00"><infProt><cStat>100</cStat><nProt>129260000000001</nProt><dhRecbto>2026-10-20T10:15:05-03:00</dhRecbto></infProt></protNFe></retConsSitNFe>`)
  assert.equal(ok.status, 'autorizada')
  assert.equal(ok.dhRecbto, '2026-10-20T10:15:05-03:00')
  assert.equal(lerRetornoConsulta(`<retConsSitNFe><cStat>217</cStat><xMotivo>Rejeicao: NF-e nao consta na base de dados da SEFAZ</xMotivo></retConsSitNFe>`).status, 'rejeitada')
  assert.equal(lerRetornoConsulta(`<retConsSitNFe><cStat>656</cStat><xMotivo>Consumo indevido</xMotivo></retConsSitNFe>`).status, 'incerta')
  assert.equal(lerRetornoConsulta(`<retConsSitNFe><cStat>101</cStat><protNFe><infProt><cStat>100</cStat></infProt></protNFe></retConsSitNFe>`).cancelada, true)
})

test('evento: 128 do lote não vale; 135 registrado; 573 duplicidade não é registro novo; rejeição de lote', () => {
  const ok = lerRetornoEvento(`<retEnvEvento><idLote>1</idLote><cStat>128</cStat><xMotivo>Lote de Evento Processado</xMotivo><retEvento versao="1.00"><infEvento><cStat>135</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo><nProt>129260000000777</nProt><dhRegEvento>2026-10-20T10:20:00-03:00</dhRegEvento></infEvento></retEvento></retEnvEvento>`)
  assert.equal(ok.registrado, true)
  assert.equal(ok.cStatLote, '128')
  assert.equal(ok.protocolo, '129260000000777')
  const dup = lerRetornoEvento(`<retEnvEvento><cStat>128</cStat><retEvento><infEvento><cStat>573</cStat><xMotivo>Rejeicao: Duplicidade de Evento</xMotivo></infEvento></retEvento></retEnvEvento>`)
  assert.equal(dup.registrado, false)
  assert.equal(dup.cStat, '573')
  assert.equal(lerRetornoEvento(`<retEnvEvento><cStat>215</cStat><xMotivo>Falha no schema</xMotivo></retEnvEvento>`).cStat, '215')
  assert.equal(trecho('<a><x:retEvento xmlns:x="u"><x:b>1</x:b></x:retEvento></a>', 'retEvento'), '<retEvento><b>1</b></retEvento>')
})
