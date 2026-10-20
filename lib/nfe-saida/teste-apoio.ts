// Apoio dos testes da NF-e de saída (só node --test, nunca importado pelo app): certificado A1 de mentira gerado na hora,
// dados de exemplo e validação contra o XSD oficial com o xmllint do sistema (PL_009_V4 em fixtures/xsd).
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import forge from 'node-forge'

let cache: { certPem: string; keyPem: string } | null = null

/** Certificado autoassinado no molde do e-CNPJ (CN "RAZAO:CNPJ"). Só para assinar e conferir; não vale na SEFAZ. */
export function certificadoDeTeste(): { certPem: string; keyPem: string } {
  if (cache) return cache
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 })
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date(Date.now() - 86400000)
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400000)
  const attrs = [{ name: 'commonName', value: 'EMPRESA TESTE LTDA:11222333000181' }, { name: 'countryName', value: 'BR' }]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.sign(keys.privateKey, forge.md.sha256.create())
  cache = { certPem: forge.pki.certificateToPem(cert), keyPem: forge.pki.privateKeyToPem(keys.privateKey) }
  return cache
}

export const XSD_DIR = path.join(import.meta.dirname, 'fixtures', 'xsd')

export function temXmllint(): boolean {
  return spawnSync('xmllint', ['--version']).status === 0
}

/** Valida o XML contra um XSD da pasta fixtures/xsd. Devolve null se válido, ou a mensagem do xmllint. */
export function validarXsd(xml: string, xsd: string): string | null {
  const dir = mkdtempSync(path.join(tmpdir(), 'nfe-xsd-'))
  const arq = path.join(dir, 'doc.xml')
  writeFileSync(arq, xml)
  try {
    execFileSync('xmllint', ['--noout', '--schema', path.join(XSD_DIR, xsd), arq], { stdio: 'pipe' })
    return null
  } catch (e) {
    const err = e as { stderr?: Buffer }
    return err.stderr?.toString() ?? String(e)
  }
}
