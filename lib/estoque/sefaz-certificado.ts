import forge from 'node-forge'
import { createServiceClient } from '@/lib/supabase/server'
import { descriptografar } from '@/lib/cripto'

// Certificado A1 da loja (arquivo .pfx no bucket privado 'certificados' + senha criptografada em lojas), pronto para mTLS e assinatura.
// Só roda no servidor. Nada sensível é logado.

export type CredencialLoja = {
  certPem: string // certificado da loja + cadeia da AC (a SEFAZ devolve 403 sem a cadeia)
  keyPem: string
  cnpjCertificado: string | null
  validoAte: Date
}

function extrair(pfx: Buffer, senha: string) {
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.createBuffer(pfx.toString('binary'))), senha)
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []
  const key = keyBags[0]?.key
  // o certificado "folha" é o que casa com a chave privada (o .pfx pode trazer a cadeia junto)
  const cert = certBags.map((b) => b.cert).find((c) => c && key && forge.pki.privateKeyToPem(key) && (c.publicKey as forge.pki.rsa.PublicKey).n?.toString(16) === (key as forge.pki.rsa.PrivateKey).n?.toString(16)) ?? certBags[0]?.cert
  if (!cert || !key) throw new Error('Certificado ou chave privada não encontrados no .pfx.')
  const cn = cert.subject.attributes.find((a) => a.shortName === 'CN')?.value as string | undefined
  const aia = cert.extensions.find((e: { id?: string }) => e.id === '1.3.6.1.5.5.7.1.1') as { value?: string } | undefined
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(key),
    cnpj: cn?.match(/(\d{14})/)?.[1] ?? null,
    urlCa: aia?.value?.match(/https?:\/\/[^\x00-\x1f\x7f]+/)?.[0] ?? null,
    validoAte: cert.validity.notAfter,
    intermediarios: certBags.map((b) => b.cert).filter((c): c is forge.pki.Certificate => !!c && c !== cert).map((c) => forge.pki.certificateToPem(c)),
  }
}

const cacheCadeia = new Map<string, { pem: string; ate: number }>()

async function cadeiaDaAc(url: string): Promise<string> {
  const c = cacheCadeia.get(url)
  if (c && c.ate > Date.now()) return c.pem
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`Falha ao baixar a cadeia da AC: HTTP ${res.status}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  let pem: string
  try {
    const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(forge.util.createBuffer(bytes.toString('binary')))) as forge.pkcs7.PkcsSignedData
    const certs = p7.certificates ?? []
    if (!certs.length) throw new Error('p7b vazio')
    pem = certs.map((x) => forge.pki.certificateToPem(x)).join('\n')
  } catch {
    pem = forge.pki.certificateToPem(forge.pki.certificateFromAsn1(forge.asn1.fromDer(forge.util.createBuffer(bytes.toString('binary')))))
  }
  cacheCadeia.set(url, { pem, ate: Date.now() + 24 * 3600 * 1000 })
  return pem
}

export async function carregarCredencialLoja(lojaId: number): Promise<CredencialLoja> {
  const sb = createServiceClient()
  const { data: loja } = await sb.from('lojas').select('certificado_path, certificado_senha_enc').eq('id', lojaId).maybeSingle()
  if (!loja?.certificado_path || !loja.certificado_senha_enc) throw new Error('A loja não tem certificado digital cadastrado (Loja > Certificado).')
  const { data: arq, error } = await sb.storage.from('certificados').download(loja.certificado_path)
  if (error || !arq) throw new Error('Não foi possível ler o arquivo do certificado.')
  let e: ReturnType<typeof extrair>
  try { e = extrair(Buffer.from(await arq.arrayBuffer()), descriptografar(loja.certificado_senha_enc)) }
  catch { throw new Error('Não foi possível abrir o certificado (senha incorreta ou arquivo inválido).') }
  if (e.validoAte.getTime() < Date.now()) throw new Error(`Certificado vencido em ${e.validoAte.toLocaleDateString('pt-BR')}.`)
  let cadeia = e.intermediarios.join('\n')
  if (!cadeia && e.urlCa) { try { cadeia = await cadeiaDaAc(e.urlCa) } catch (err) { console.error('sefaz: cadeia da AC indisponível, seguindo só com o certificado da loja:', err instanceof Error ? err.message : err) } }
  return { certPem: cadeia ? `${e.certPem}\n${cadeia}` : e.certPem, keyPem: e.keyPem, cnpjCertificado: e.cnpj, validoAte: e.validoAte }
}
