// NFeDistribuicaoDFe (Ambiente Nacional): só as PEÇAS PURAS (montar o pedido, ler a resposta, regras de espera).
// A chamada de rede com o certificado da loja NÃO está ligada aqui; só leitura, nunca em loop, sempre por NSU.
// Regras (NT 2014.002): sem documento novo (137) ou consumo indevido (656) => esperar 1 hora antes de consultar de novo;
// reiniciar a consulta antes disso zera o contador e prolonga o bloqueio.
import { gunzipSync } from 'node:zlib'
// @ts-ignore: o import com extensão .ts é exigido pelo node --test (type stripping); o tsc do Next não o aceita
import { parseXml } from './nfe-xml.ts'

export const ESPERA_SEM_DOCUMENTO_MS = 60 * 60 * 1000

export function montarPedidoDistNsu(cnpj: string, tpAmb: 1 | 2, ultNsu: string, cUfAutor = '29'): string {
  const c = cnpj.replace(/\D/g, '')
  if (c.length !== 14) throw new Error('CNPJ inválido')
  const nsu = String(ultNsu || '0').replace(/\D/g, '').padStart(15, '0')
  return `<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>${tpAmb}</tpAmb><cUFAutor>${cUfAutor}</cUFAutor><CNPJ>${c}</CNPJ><distNSU><ultNSU>${nsu}</ultNSU></distNSU></distDFeInt>`
}

export type DocDistribuido = { nsu: string; schema: string; xml: string; completo: boolean }
export type RetornoDist = { cStat: string; xMotivo: string; ultNsu: string; maxNsu: string; docs: DocDistribuido[] }

function achar(no: ReturnType<typeof parseXml>, nome: string): ReturnType<typeof parseXml> | undefined {
  if (no.nome === nome) return no
  for (const f of no.filhos) { const r = achar(f, nome); if (r) return r }
  return undefined
}
const txt = (no: ReturnType<typeof parseXml> | undefined, nome: string) => (no ? achar(no, nome)?.texto.trim() ?? '' : '')

export function lerRetornoDist(xml: string): RetornoDist {
  const raiz = parseXml(xml)
  const ret = achar(raiz, 'retDistDFeInt')
  if (!ret) throw new Error('Resposta da SEFAZ sem retDistDFeInt')
  const docs: DocDistribuido[] = []
  const lote = achar(ret, 'loteDistDFeInt')
  for (const d of lote?.filhos.filter((f) => f.nome === 'docZip') ?? []) {
    const schema = d.attrs.schema ?? ''
    const xmlDoc = gunzipSync(Buffer.from(d.texto.trim(), 'base64')).toString('utf8')
    docs.push({ nsu: d.attrs.NSU ?? '', schema, xml: xmlDoc, completo: /^procNFe/i.test(schema) })
  }
  return { cStat: txt(ret, 'cStat'), xMotivo: txt(ret, 'xMotivo'), ultNsu: txt(ret, 'ultNSU'), maxNsu: txt(ret, 'maxNSU'), docs }
}

/** Quando consultar de novo: continua se ainda há NSU para buscar; espera 1 h se não há novidade ou houve consumo indevido. */
export function proximaConsulta(r: RetornoDist, agora = Date.now()): { continuarJa: boolean; esperarAte: number | null } {
  if (r.cStat === '138' && Number(r.ultNsu) < Number(r.maxNsu)) return { continuarJa: true, esperarAte: null }
  return { continuarJa: false, esperarAte: agora + ESPERA_SEM_DOCUMENTO_MS }
}

// ------------------------------------------------------------------------------------------ peças puras da distribuição
import type { ResumoNfe } from './nf-sefaz-mapa.ts'

const COD_UF: Record<string, string> = { RO: '11', AC: '12', AM: '13', RR: '14', PA: '15', AP: '16', TO: '17', MA: '21', PI: '22', CE: '23', RN: '24', PB: '25', PE: '26', AL: '27', SE: '28', BA: '29', MG: '31', ES: '32', RJ: '33', SP: '35', PR: '41', SC: '42', RS: '43', MS: '50', MT: '51', GO: '52', DF: '53' }
/** Código IBGE da UF do autor da consulta (padrão 29 = BA, onde ficam as lojas atuais). */
export function codigoUf(uf: string | null | undefined): string {
  return COD_UF[(uf ?? '').trim().toUpperCase()] ?? '29'
}

// Ambiente Nacional. Distribuição é só LEITURA; o ambiente 1 (produção) é o que traz as notas reais dos fornecedores.
export function urlDistribuicao(tpAmb: 1 | 2): string {
  return tpAmb === 1 ? 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx' : 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx'
}
export function urlEventoNacional(tpAmb: 1 | 2): string {
  return tpAmb === 1 ? 'https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx' : 'https://hom.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx'
}

export const NS_DIST = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe'
export const ACAO_DIST = `${NS_DIST}/nfeDistDFeInteresse`
export const NS_EVENTO = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4'
export const ACAO_EVENTO = `${NS_EVENTO}/nfeRecepcaoEvento`

export function envelopeSoap12(corpo: string): string {
  return `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>${corpo}</soap12:Body></soap12:Envelope>`
}
export function soapDistribuicao(distDFeInt: string): string {
  return envelopeSoap12(`<nfeDistDFeInteresse xmlns="${NS_DIST}"><nfeDadosMsg>${distDFeInt}</nfeDadosMsg></nfeDistDFeInteresse>`)
}

export type TipoDocDist = 'resNFe' | 'procNFe' | 'resEvento' | 'procEventoNFe' | 'outro'
export function tipoDocumento(schema: string): TipoDocDist {
  const s = (schema ?? '').toLowerCase()
  if (s.startsWith('procnfe')) return 'procNFe'
  if (s.startsWith('resnfe')) return 'resNFe'
  if (s.startsWith('proceventonfe')) return 'procEventoNFe'
  if (s.startsWith('resevento')) return 'resEvento'
  return 'outro'
}

export function lerResNFe(xml: string): ResumoNfe {
  const raiz = parseXml(xml)
  const r = achar(raiz, 'resNFe')
  if (!r) throw new Error('XML sem resNFe')
  const dh = txt(r, 'dhEmi')
  return {
    chave: txt(r, 'chNFe'), cnpj: (txt(r, 'CNPJ') || txt(r, 'CPF')).replace(/\D/g, ''), nome: txt(r, 'xNome'), ie: txt(r, 'IE') || null,
    emissao: dh ? dh.slice(0, 10) : null, tipoOperacao: txt(r, 'tpNF') || null, valor: Number(txt(r, 'vNF')) || 0, situacao: txt(r, 'cSitNFe') || null,
  }
}

export type EventoLido = { chave: string; tpEvento: string; descricao: string; protocolo: string | null }
/** resEvento ou procEventoNFe: o que importa é o tipo (110111 = cancelamento) e a chave. */
export function lerEvento(xml: string): EventoLido {
  const raiz = parseXml(xml)
  const r = achar(raiz, 'resEvento') ?? achar(raiz, 'infEvento')
  if (!r) throw new Error('XML sem evento')
  return { chave: txt(r, 'chNFe'), tpEvento: txt(r, 'tpEvento'), descricao: txt(r, 'xEvento') || txt(r, 'descEvento'), protocolo: txt(raiz, 'nProt') || null }
}

// Manifestação do destinatário: 210210 = Ciência da Operação (libera o XML completo na distribuição).
export const EVENTO_CIENCIA = '210210'
export function dataHoraSaoPaulo(agora = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(agora)
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '00'
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}:${g('second')}-03:00`
}
export function montarEventoCiencia(p: { chave: string; cnpj: string; tpAmb: 1 | 2; agora?: Date }): { xml: string; id: string } {
  const cnpj = p.cnpj.replace(/\D/g, '')
  if (!/^\d{44}$/.test(p.chave)) throw new Error('Chave de acesso inválida')
  if (cnpj.length !== 14) throw new Error('CNPJ inválido')
  const id = `ID${EVENTO_CIENCIA}${p.chave}01`
  const xml =
    `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><infEvento Id="${id}"><cOrgao>91</cOrgao><tpAmb>${p.tpAmb}</tpAmb><CNPJ>${cnpj}</CNPJ><chNFe>${p.chave}</chNFe>` +
    `<dhEvento>${dataHoraSaoPaulo(p.agora)}</dhEvento><tpEvento>${EVENTO_CIENCIA}</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento>` +
    `<detEvento versao="1.00"><descEvento>Ciencia da Operacao</descEvento></detEvento></infEvento></evento>`
  return { xml, id }
}
export function soapEvento(eventoAssinado: string, idLote = String(Date.now()).slice(-15)): string {
  return envelopeSoap12(`<nfeDadosMsg xmlns="${NS_EVENTO}"><envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>${idLote}</idLote>${eventoAssinado}</envEvento></nfeDadosMsg>`)
}
/** 135 = evento registrado; 573 = duplicidade (a ciência já existia): os dois significam "pode seguir". */
export function cienciaRegistrada(cStat: string | null): boolean {
  return cStat === '135' || cStat === '136' || cStat === '573'
}
export function lerRetornoEvento(xml: string): { cStatLote: string | null; cStat: string | null; xMotivo: string | null } {
  const raiz = parseXml(xml)
  const ret = achar(raiz, 'retEvento')
  const lote = achar(raiz, 'retEnvEvento')
  return { cStatLote: lote ? txt(lote, 'cStat') || null : null, cStat: ret ? txt(achar(ret, 'infEvento'), 'cStat') || null : lote ? txt(lote, 'cStat') || null : null, xMotivo: ret ? txt(achar(ret, 'infEvento'), 'xMotivo') || null : lote ? txt(lote, 'xMotivo') || null : null }
}
