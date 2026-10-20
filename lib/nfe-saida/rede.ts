import https from 'node:https'
import type { CredencialLoja } from '@/lib/estoque/sefaz-certificado'
import { envelope, SOAP, type Servico } from './sefaz-puro'
import { hostDaSefazPermitido, tpAmbDoXml, urlEhHomologacao } from './webservices'

// Única saída de rede da NF-e de saída. Só servidor. Travas antes de qualquer byte sair:
//  1. host precisa estar na tabela de web services (webservices.ts);
//  2. o tpAmb DENTRO do XML tem que bater com o ambiente do endereço (homologação ↔ homologação);
//  3. nunca roda dentro do node --test (NODE_TEST_CONTEXT): teste não fala com a SEFAZ, nem por engano.
// A cadeia ICP-Brasil não vem no Node: rejectUnauthorized false, com host fixo da tabela (mesmo ajuste já validado no
// Norte Vendas e na distribuição DF-e do estoque).

/** Falhou ANTES de conectar: certeza de que a SEFAZ não recebeu nada (pode voltar a rascunho). */
export class ErroAntesDoEnvio extends Error {}
/** Falhou DEPOIS de conectar (tempo esgotado, conexão caiu): a SEFAZ pode ter recebido. Consultar antes de reenviar. */
export class ErroSemResposta extends Error {}

export async function postSefaz(p: { url: string; servico: Servico; corpo: string; cred: Pick<CredencialLoja, 'certPem' | 'keyPem'>; timeoutMs?: number }): Promise<{ status: number; body: string }> {
  if (process.env.NODE_TEST_CONTEXT) throw new ErroAntesDoEnvio('Chamada à SEFAZ bloqueada dentro de teste')
  if (!hostDaSefazPermitido(p.url)) throw new ErroAntesDoEnvio('Endereço da SEFAZ fora da lista permitida')
  const tpXml = tpAmbDoXml(p.corpo)
  const tpUrl = urlEhHomologacao(p.url) ? 2 : 1
  if (tpXml !== tpUrl) throw new ErroAntesDoEnvio(`Ambiente incoerente: XML tpAmb=${tpXml}, endereço de ${tpUrl === 2 ? 'homologação' : 'produção'}`)
  const soap = envelope(p.servico, p.corpo)
  const u = new URL(p.url)
  console.log(`[nfe-saida] ${p.servico} tpAmb=${tpXml} host=${u.hostname}`)
  return new Promise((resolve, reject) => {
    let conectou = false
    const req = https.request(
      {
        hostname: u.hostname, path: u.pathname + u.search, method: 'POST', cert: p.cred.certPem, key: p.cred.keyPem, rejectUnauthorized: false,
        headers: { 'Content-Type': `application/soap+xml; charset=utf-8; action="${SOAP[p.servico].acao}"`, 'Content-Length': Buffer.byteLength(soap) },
        timeout: p.timeoutMs ?? 45000,
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (c) => (body += c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
        res.on('error', (e) => reject(new ErroSemResposta(e.message)))
      }
    )
    req.on('socket', (s) => s.once('secureConnect', () => { conectou = true }))
    req.on('error', (e) => reject(conectou ? new ErroSemResposta(`Conexão com a SEFAZ caiu: ${e.message}`) : new ErroAntesDoEnvio(`Não foi possível conectar à SEFAZ: ${e.message}`)))
    req.on('timeout', () => { req.destroy(new Error('Tempo esgotado na comunicação com a SEFAZ')) })
    req.write(soap)
    req.end()
  })
}
