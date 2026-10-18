// Conferência criptográfica da assinatura (XMLDSig) da NF-e, só no servidor (xml-crypto). Usa o X509Certificate do próprio XML:
// prova que o conteúdo não foi alterado depois de assinado por quem tem aquele certificado (a cadeia da ICP-Brasil não é conferida).
// Nunca lança: `null` = não há assinatura/certificado para conferir; `false` = não confere (ou não deu para conferir).
import { SignedXml } from 'xml-crypto'

export function assinaturaConfere(xml: string): boolean | null {
  try {
    const sig = xml.match(/<(?:\w+:)?Signature\b[\s\S]*?<\/(?:\w+:)?Signature>/)
    if (!sig) return null
    const cert = sig[0].match(/<(?:\w+:)?X509Certificate>\s*([\s\S]*?)\s*<\/(?:\w+:)?X509Certificate>/)
    const b64 = (cert?.[1] ?? '').replace(/\s+/g, '')
    if (!b64) return null
    const pem = `-----BEGIN CERTIFICATE-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`
    const v = new SignedXml({ publicCert: pem })
    v.loadSignature(sig[0])
    return v.checkSignature(xml) === true
  } catch {
    return false
  }
}
