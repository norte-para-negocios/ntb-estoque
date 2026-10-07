import https from 'node:https'
import { SignedXml } from 'xml-crypto'
import {
  ACAO_DIST, ACAO_EVENTO, cienciaRegistrada, codigoUf, lerRetornoDist, lerRetornoEvento, montarEventoCiencia, montarPedidoDistChave, montarPedidoDistNsu,
  soapDistribuicao, soapEvento, urlDistribuicao, urlEventoNacional, type RetornoDist,
} from './sefaz-distdfe'
import type { CredencialLoja } from './sefaz-certificado'

// Chamadas de rede à SEFAZ (Ambiente Nacional) com o certificado A1 da loja. Distribuição é SÓ LEITURA; a única escrita é a
// manifestação de ciência da operação (210210), que não altera a nota. Nunca emite nem cancela nada.

function postSoap(url: string, soap: string, acao: string, cred: Pick<CredencialLoja, 'certPem' | 'keyPem'>, timeoutMs = 45000): Promise<{ status: number; body: string }> {
  const u = new URL(url)
  if (!/(^|\.)fazenda\.gov\.br$/.test(u.hostname)) throw new Error('Endereço da SEFAZ inesperado')
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: u.hostname, path: u.pathname, method: 'POST', cert: cred.certPem, key: cred.keyPem,
        // a cadeia raiz da ICP-Brasil não vem no repositório do Node; o host é fixo (fazenda.gov.br) e a identidade do cliente é o certificado
        rejectUnauthorized: false,
        headers: { 'Content-Type': `application/soap+xml; charset=utf-8; action="${acao}"`, 'Content-Length': Buffer.byteLength(soap) },
        timeout: timeoutMs,
      },
      (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
      }
    )
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Tempo esgotado na comunicação com a SEFAZ.')) })
    req.write(soap)
    req.end()
  })
}

export async function consultarDistribuicao(p: { cnpj: string; tpAmb: 1 | 2; ultNsu: string; uf?: string | null; cred: CredencialLoja }): Promise<RetornoDist> {
  const pedido = montarPedidoDistNsu(p.cnpj, p.tpAmb, p.ultNsu, codigoUf(p.uf))
  const { status, body } = await postSoap(urlDistribuicao(p.tpAmb), soapDistribuicao(pedido), ACAO_DIST, p.cred)
  if (!/retDistDFeInt/.test(body)) throw new Error(`Resposta inesperada da SEFAZ (HTTP ${status}): ${body.replace(/\s+/g, ' ').slice(0, 200)}`)
  return lerRetornoDist(body)
}

export async function consultarPorChave(p: { cnpj: string; tpAmb: 1 | 2; chave: string; uf?: string | null; cred: CredencialLoja }): Promise<RetornoDist> {
  const pedido = montarPedidoDistChave(p.cnpj, p.tpAmb, p.chave, codigoUf(p.uf))
  const { status, body } = await postSoap(urlDistribuicao(p.tpAmb), soapDistribuicao(pedido), ACAO_DIST, p.cred)
  if (!/retDistDFeInt/.test(body)) throw new Error(`Resposta inesperada da SEFAZ (HTTP ${status}): ${body.replace(/\s+/g, ' ').slice(0, 200)}`)
  return lerRetornoDist(body)
}

// Mesma receita já validada contra a SEFAZ no Vendas (cancelamento): XMLDSig enveloped, C14N, SHA1/RSA-SHA1 (exigência do schema).
// Só o certificado da loja vai no KeyInfo: o certPem traz também a cadeia da AC (necessária no TLS), e mais de um
// X509Certificate quebra o esquema do evento (cStat 225 "Falha no Esquema XML", achado na ODARA em 07/10).
export function certificadoFolha(certPem: string): string {
  const m = certPem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)
  return m ? m[0] : certPem
}
export function assinarEvento(xml: string, id: string, certPem: string, keyPem: string): string {
  const sig = new SignedXml({ privateKey: keyPem, publicCert: certificadoFolha(certPem) })
  sig.addReference({
    xpath: `//*[local-name(.)='infEvento']`,
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
    uri: `#${id}`,
  })
  sig.canonicalizationAlgorithm = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
  sig.signatureAlgorithm = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1'
  sig.computeSignature(xml, { location: { reference: `//*[local-name(.)='infEvento']`, action: 'after' } })
  return sig.getSignedXml()
}

export async function enviarCiencia(p: { chave: string; cnpj: string; tpAmb: 1 | 2; cred: CredencialLoja }): Promise<{ ok: boolean; cStat: string | null; xMotivo: string | null }> {
  const { xml, id } = montarEventoCiencia({ chave: p.chave, cnpj: p.cnpj, tpAmb: p.tpAmb })
  const assinado = assinarEvento(xml, id, p.cred.certPem, p.cred.keyPem)
  const { status, body } = await postSoap(urlEventoNacional(p.tpAmb), soapEvento(assinado), ACAO_EVENTO, p.cred)
  if (!/ret(Env)?Evento/.test(body)) throw new Error(`Resposta inesperada da SEFAZ no evento (HTTP ${status}): ${body.replace(/\s+/g, ' ').slice(0, 200)}`)
  const r = lerRetornoEvento(body)
  return { ok: cienciaRegistrada(r.cStat), cStat: r.cStat, xMotivo: r.xMotivo }
}
