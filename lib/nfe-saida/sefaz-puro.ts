// Mensagens da NF-e de SAÍDA com a SEFAZ (sem rede): lote de autorização, consulta de recibo e de protocolo, eventos de
// cancelamento (110111) e carta de correção (110110), envelopes SOAP 1.2, leitura dos retornos e montagem do procNFe /
// procEventoNFe. Puro: node --test lib/nfe-saida/sefaz-puro.test.ts (os eventos são validados contra o XSD oficial).
// @ts-expect-error: import com .ts exigido pelo node --test (o tsc do Next não aceita a extensão)
import { dataHoraSaoPaulo, escapeXml, textoNfe } from './nfe-puro.ts'

const NS = 'http://www.portalfiscal.inf.br/nfe'
const WSDL = 'http://www.portalfiscal.inf.br/nfe/wsdl'

export type Servico = 'NfeAutorizacao' | 'NfeRetAutorizacao' | 'NfeConsultaProtocolo' | 'RecepcaoEvento' | 'NfeStatusServico'
export const SOAP: Record<Servico, { ns: string; acao: string }> = {
  NfeAutorizacao: { ns: `${WSDL}/NFeAutorizacao4`, acao: `${WSDL}/NFeAutorizacao4/nfeAutorizacaoLote` },
  NfeRetAutorizacao: { ns: `${WSDL}/NFeRetAutorizacao4`, acao: `${WSDL}/NFeRetAutorizacao4/nfeRetAutorizacaoLote` },
  NfeConsultaProtocolo: { ns: `${WSDL}/NFeConsultaProtocolo4`, acao: `${WSDL}/NFeConsultaProtocolo4/nfeConsultaNF` },
  RecepcaoEvento: { ns: `${WSDL}/NFeRecepcaoEvento4`, acao: `${WSDL}/NFeRecepcaoEvento4/nfeRecepcaoEvento` },
  NfeStatusServico: { ns: `${WSDL}/NFeStatusServico4`, acao: `${WSDL}/NFeStatusServico4/nfeStatusServicoNF` },
}

export function envelope(servico: Servico, corpo: string): string {
  return `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body><nfeDadosMsg xmlns="${SOAP[servico].ns}">${corpo}</nfeDadosMsg></soap12:Body></soap12:Envelope>`
}

const semDeclaracao = (x: string) => x.replace(/^\s*<\?xml[^>]*\?>\s*/, '')

/** Lote com UMA NF-e, síncrono (indSinc 1). */
export function montarEnviNFe(nfeAssinada: string, idLote: number | string): string {
  const id = String(idLote).replace(/\D/g, '').slice(-15) || '1'
  return `<enviNFe xmlns="${NS}" versao="4.00"><idLote>${id}</idLote><indSinc>1</indSinc>${semDeclaracao(nfeAssinada)}</enviNFe>`
}
export function montarConsReci(tpAmb: 1 | 2, nRec: string): string {
  return `<consReciNFe xmlns="${NS}" versao="4.00"><tpAmb>${tpAmb}</tpAmb><nRec>${nRec.replace(/\D/g, '')}</nRec></consReciNFe>`
}
export function montarConsSit(tpAmb: 1 | 2, chave: string): string {
  return `<consSitNFe xmlns="${NS}" versao="4.00"><tpAmb>${tpAmb}</tpAmb><xServ>CONSULTAR</xServ><chNFe>${chave}</chNFe></consSitNFe>`
}

// ------------------------------------------------------------------------------------------------ eventos
export const JUSTIFICATIVA_MIN = 15
export const CCE_MIN = 15
export const CCE_MAX = 1000
export const COND_USO_CCE =
  'A Carta de Correcao e disciplinada pelo paragrafo 1o-A do art. 7o do Convenio S/N, de 15 de dezembro de 1970 e pode ser utilizada para regularizacao de erro ocorrido na emissao de documento fiscal, desde que o erro nao esteja relacionado com: I - as variaveis que determinam o valor do imposto tais como: base de calculo, aliquota, diferenca de preco, quantidade, valor da operacao ou da prestacao; II - a correcao de dados cadastrais que implique mudanca do remetente ou do destinatario; III - a data de emissao ou de saida.'

export function validarJustificativa(t: string | null | undefined): string | null {
  const s = textoNfe(t, 300)
  if (s.length < JUSTIFICATIVA_MIN) return `Escreva a justificativa com pelo menos ${JUSTIFICATIVA_MIN} caracteres.`
  if (s.length > 255) return 'A justificativa passa de 255 caracteres.'
  return null
}
export function validarCorrecao(t: string | null | undefined): string | null {
  const s = textoNfe(t, 1100)
  if (s.length < CCE_MIN) return `Escreva a correção com pelo menos ${CCE_MIN} caracteres.`
  if (s.length > CCE_MAX) return `A correção passa de ${CCE_MAX} caracteres.`
  return null
}

function evento(p: { chave: string; tpAmb: 1 | 2; tpEvento: '110111' | '110110'; nSeq: number; detalhe: string; agora?: Date }): { xml: string; id: string } {
  if (!/^\d{44}$/.test(p.chave)) throw new Error('Chave de acesso inválida')
  if (!(p.nSeq >= 1 && p.nSeq <= 20)) throw new Error('Sequência do evento inválida')
  const id = `ID${p.tpEvento}${p.chave}${String(p.nSeq).padStart(2, '0')}`
  const xml =
    `<evento xmlns="${NS}" versao="1.00"><infEvento Id="${id}"><cOrgao>${p.chave.slice(0, 2)}</cOrgao><tpAmb>${p.tpAmb}</tpAmb>` +
    `<CNPJ>${p.chave.slice(6, 20)}</CNPJ><chNFe>${p.chave}</chNFe><dhEvento>${dataHoraSaoPaulo(p.agora)}</dhEvento>` +
    `<tpEvento>${p.tpEvento}</tpEvento><nSeqEvento>${p.nSeq}</nSeqEvento><verEvento>1.00</verEvento>${p.detalhe}</infEvento></evento>`
  return { xml, id }
}

export function montarEventoCancelamento(p: { chave: string; tpAmb: 1 | 2; protocolo: string; justificativa: string; agora?: Date }): { xml: string; id: string } {
  const erro = validarJustificativa(p.justificativa)
  if (erro) throw new Error(erro)
  if (!/^\d{15}$/.test(p.protocolo)) throw new Error('Protocolo de autorização inválido')
  const det = `<detEvento versao="1.00"><descEvento>Cancelamento</descEvento><nProt>${p.protocolo}</nProt><xJust>${escapeXml(textoNfe(p.justificativa, 255))}</xJust></detEvento>`
  return evento({ chave: p.chave, tpAmb: p.tpAmb, tpEvento: '110111', nSeq: 1, detalhe: det, agora: p.agora })
}

export function montarEventoCce(p: { chave: string; tpAmb: 1 | 2; seq: number; correcao: string; agora?: Date }): { xml: string; id: string } {
  const erro = validarCorrecao(p.correcao)
  if (erro) throw new Error(erro)
  const det = `<detEvento versao="1.00"><descEvento>Carta de Correcao</descEvento><xCorrecao>${escapeXml(textoNfe(p.correcao, 1000))}</xCorrecao><xCondUso>${COND_USO_CCE}</xCondUso></detEvento>`
  return evento({ chave: p.chave, tpAmb: p.tpAmb, tpEvento: '110110', nSeq: p.seq, detalhe: det, agora: p.agora })
}

export function montarEnvEvento(eventoAssinado: string, idLote: number | string): string {
  const id = String(idLote).replace(/\D/g, '').slice(-15) || '1'
  return `<envEvento xmlns="${NS}" versao="1.00"><idLote>${id}</idLote>${semDeclaracao(eventoAssinado)}</envEvento>`
}

// ------------------------------------------------------------------------------------------------ retornos
/** Pedaço de XML do retorno, sem prefixo de namespace (ex.: ns2:protNFe → protNFe), para guardar e reaproveitar. */
export function trecho(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<(?:[\\w-]+:)?${tag}\\b[\\s\\S]*?</(?:[\\w-]+:)?${tag}>`))
  if (!m) return null
  return m[0].replace(/<(\/?)[\w-]+:/g, '<$1').replace(/\sxmlns:[\w-]+="[^"]*"/g, '')
}
const campo = (xml: string | null, tag: string): string | null => {
  if (!xml) return null
  const m = xml.match(new RegExp(`<(?:[\\w-]+:)?${tag}>([^<]*)</(?:[\\w-]+:)?${tag}>`))
  return m ? m[1].trim() : null
}

export type ResultadoSefaz = {
  /** O que gravar: autorizada / rejeitada / denegada / incerta (consultar antes de reenviar) / processando (tem recibo). */
  status: 'autorizada' | 'rejeitada' | 'denegada' | 'inutilizada' | 'incerta' | 'processando'
  cStat: string | null
  xMotivo: string | null
  protocolo: string | null
  dhRecbto: string | null
  nRec: string | null
  protNFe: string | null
}

const AUTORIZADA = new Set(['100', '150'])
const DENEGADA = new Set(['110', '205', '301', '302', '303'])
// Lote não processado / SEFAZ fora do ar: nada ficou registrado, pode reenviar o mesmo número.
const NAO_PROCESSADO = new Set(['108', '109', '999'])
// Duplicidade: a nota pode já estar autorizada → consultar pela chave antes de qualquer coisa.
const DUPLICIDADE = new Set(['204', '539'])

export function classificar(cStat: string | null): ResultadoSefaz['status'] {
  if (!cStat) return 'incerta'
  if (AUTORIZADA.has(cStat)) return 'autorizada'
  if (DENEGADA.has(cStat)) return 'denegada'
  // 206: número inutilizado na SEFAZ — consumido (nunca volta para a fila), não é rejeição que se reenvia
  if (cStat === '206') return 'inutilizada'
  if (cStat === '103' || cStat === '105') return 'processando'
  if (DUPLICIDADE.has(cStat)) return 'incerta'
  if (NAO_PROCESSADO.has(cStat)) return 'rejeitada'
  return 'rejeitada'
}

/** Retorno do NFeAutorizacao4 (retEnviNFe) ou do NFeRetAutorizacao4 (retConsReciNFe): o cStat que vale é o da NOTA
 *  (protNFe/infProt); o do lote (104 "Lote processado") nunca é autorização. Sem protNFe: o do lote (rejeição de lote,
 *  103 recebido/assíncrono com nRec, 105 em processamento). */
export function lerRetornoAutorizacao(xml: string): ResultadoSefaz {
  const prot = trecho(xml, 'protNFe')
  if (prot) {
    const cStat = campo(prot, 'cStat')
    return { status: classificar(cStat), cStat, xMotivo: campo(prot, 'xMotivo'), protocolo: campo(prot, 'nProt'), dhRecbto: campo(prot, 'dhRecbto'), nRec: campo(xml, 'nRec'), protNFe: prot }
  }
  const lote = trecho(xml, 'retEnviNFe') ?? trecho(xml, 'retConsReciNFe') ?? xml
  const cStat = campo(lote, 'cStat')
  return { status: classificar(cStat), cStat, xMotivo: campo(lote, 'xMotivo'), protocolo: null, dhRecbto: campo(lote, 'dhRecbto'), nRec: campo(lote, 'nRec'), protNFe: null }
}

/** Retorno do NFeConsultaProtocolo4 (retConsSitNFe). 217 = a SEFAZ não tem a nota (nunca chegou): pode reenviar. */
export function lerRetornoConsulta(xml: string): ResultadoSefaz & { cancelada: boolean } {
  const ret = trecho(xml, 'retConsSitNFe') ?? xml
  const prot = trecho(ret, 'protNFe')
  const cStatGeral = campo(ret, 'cStat')
  const cancelada = ['101', '151', '155'].includes(cStatGeral ?? '')
  if (prot) {
    const cStat = campo(prot, 'cStat')
    return { status: classificar(cStat), cStat, xMotivo: campo(prot, 'xMotivo'), protocolo: campo(prot, 'nProt'), dhRecbto: campo(prot, 'dhRecbto'), nRec: null, protNFe: prot, cancelada }
  }
  const status: ResultadoSefaz['status'] = cStatGeral === '217' ? 'rejeitada' : cStatGeral === '656' || cStatGeral === '108' || cStatGeral === '109' ? 'incerta' : classificar(cStatGeral)
  return { status, cStat: cStatGeral, xMotivo: campo(ret, 'xMotivo'), protocolo: null, dhRecbto: null, nRec: null, protNFe: null, cancelada }
}

export type ResultadoEvento = { registrado: boolean; cStatLote: string | null; cStat: string | null; xMotivo: string | null; protocolo: string | null; dhRegEvento: string | null; retEvento: string | null }

/** Retorno do NFeRecepcaoEvento4: 128 é só "lote processado"; o que vale é o retEvento (135/136 registrado, 155
 *  cancelamento fora de prazo homologado). 573 = duplicidade (o evento já estava registrado). */
export function lerRetornoEvento(xml: string): ResultadoEvento {
  const ret = trecho(xml, 'retEvento')
  const cStatLote = campo(trecho(xml, 'retEnvEvento') ?? xml, 'cStat')
  if (ret) {
    const cStat = campo(ret, 'cStat')
    return { registrado: ['135', '136', '155'].includes(cStat ?? ''), cStatLote, cStat, xMotivo: campo(ret, 'xMotivo'), protocolo: campo(ret, 'nProt'), dhRegEvento: campo(ret, 'dhRegEvento'), retEvento: ret }
  }
  return { registrado: false, cStatLote, cStat: cStatLote, xMotivo: campo(trecho(xml, 'retEnvEvento') ?? xml, 'xMotivo'), protocolo: null, dhRegEvento: null, retEvento: null }
}

/** XML de distribuição da nota autorizada: NFe assinada + protNFe. */
export function montarProcNFe(nfeAssinada: string, protNFe: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="${NS}" versao="4.00">${semDeclaracao(nfeAssinada)}${protNFe.replace(/\sxmlns="[^"]*"/, '')}</nfeProc>`
}
export function montarProcEvento(eventoAssinado: string, retEvento: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><procEventoNFe xmlns="${NS}" versao="1.00">${semDeclaracao(eventoAssinado)}${retEvento.replace(/\sxmlns="[^"]*"/, '')}</procEventoNFe>`
}

// ------------------------------------------------------------------------------------------------ chave presa x nova chave
// Códigos que NÃO provam que a SEFAZ deixou de guardar a chave enviada: lote em processamento, recibo, fora do ar,
// duplicidade, "não consta" (217, pode estar processando), consumo indevido. Com eles a NF-e só reenvia o MESMO XML.
const NAO_DEFINITIVOS = new Set(['103', '104', '105', '106', '108', '109', '204', '206', '217', '539', '656', '999'])

/** Consulta por chave sem protNFe e com cStat que NÃO é situação da nota (ex.: 215 esquema, 226 UF, 236/562 chave):
 *  erro da própria consulta. Não muda a situação da NF-e (nem vira "rejeitada"). */
export function erroDaConsulta(cStat: string | null, temProt: boolean, cancelada: boolean): boolean {
  if (temProt || cancelada || !cStat) return false
  return !['217', '656', '108', '109', '100', '150', '110', '205', '206', '301', '302', '303'].includes(cStat)
}

/** Rejeição definitiva da AUTORIZAÇÃO (a SEFAZ analisou esta chave e recusou): libera montar XML novo / descartar. */
export function rejeicaoDefinitiva(cStat: string | null): boolean {
  return !!cStat && classificar(cStat) === 'rejeitada' && !NAO_DEFINITIVOS.has(cStat)
}

/** Espera antes de aceitar o 217 ("NF-e não consta na base") como prova de que a nota não existe: a SEFAZ pode ainda
 *  estar processando o lote. Antes disso a NF-e continua sem resposta (incerta). */
export const ESPERA_217_MS = 30 * 60 * 1000
export function consulta217Final(ultimoEnvio: string | null | undefined, agora = Date.now()): boolean {
  if (!ultimoEnvio) return true
  return agora - new Date(ultimoEnvio).getTime() >= ESPERA_217_MS
}

/** 539 "Duplicidade de NF-e com diferença na Chave de Acesso [chNFe: ...]": a chave que a SEFAZ já tem para o número. */
export function chaveDaDuplicidade(xMotivo: string | null | undefined): string | null {
  const m = (xMotivo ?? '').match(/chNFe\s*:?\s*(\d{44})/i) ?? (xMotivo ?? '').match(/(\d{44})/)
  return m ? m[1] : null
}

export type EventoConsulta = { tpEvento: string; nSeq: number; protocolo: string | null; dhRegEvento: string | null; xCorrecao: string | null; xml: string }

/** Eventos que vêm junto da consulta por chave (retConsSitNFe/procEventoNFe): cancelamento, CC-e etc. */
export function eventosDaConsulta(xml: string): EventoConsulta[] {
  const out: EventoConsulta[] = []
  const re = /<(?:[\w-]+:)?procEventoNFe\b[\s\S]*?<\/(?:[\w-]+:)?procEventoNFe>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const bruto = m[0].replace(/<(\/?)[\w-]+:/g, '<$1').replace(/\sxmlns:[\w-]+="[^"]*"/g, '')
    const ret = trecho(bruto, 'retEvento')
    out.push({
      tpEvento: campo(bruto, 'tpEvento') ?? '', nSeq: Number(campo(bruto, 'nSeqEvento') ?? 0), protocolo: campo(ret, 'nProt'),
      dhRegEvento: campo(ret, 'dhRegEvento'), xCorrecao: campo(bruto, 'xCorrecao'), xml: bruto,
    })
  }
  return out
}

/** Mensagem curta para a tela a partir do cStat (mantém o texto da SEFAZ). */
export function mensagemSefaz(cStat: string | null, xMotivo: string | null): string {
  if (!cStat) return xMotivo ?? 'Sem resposta da SEFAZ'
  const dica: Record<string, string> = {
    '225': 'o XML não passou no esquema; verifique cadastro (NCM, endereço, IE) e avise o suporte',
    '204': 'a SEFAZ diz que esta nota já existe: use "Consultar na SEFAZ"',
    '539': 'a SEFAZ diz que este número já foi usado com outra chave: use "Consultar na SEFAZ"',
    '486': 'falta o grupo autXML (CNPJ do escritório de contabilidade) na configuração',
    '719': 'falta o endereço do destinatário',
    '108': 'a SEFAZ está fora do ar agora; tente de novo em alguns minutos',
    '109': 'a SEFAZ está fora do ar agora; tente de novo em alguns minutos',
    '501': 'passou do prazo de cancelamento (24 horas)',
    '573': 'este evento já estava registrado na SEFAZ',
  }
  return `${cStat} — ${xMotivo ?? ''}${dica[cStat] ? ` (${dica[cStat]})` : ''}`
}
