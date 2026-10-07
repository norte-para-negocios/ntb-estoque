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
