// Assinatura XMLDSig da NF-e e dos eventos (xml-crypto): enveloped + C14N + RSA-SHA1/SHA1, exigência do XSD
// (xmldsig-core-schema_v1.01). Mesma receita já validada ao vivo na SEFAZ-BA pelo Norte Vendas (NF-e 55) e pela
// manifestação do estoque (evento 210210). Só o certificado da loja vai no KeyInfo (mais de um X509Certificate quebra o
// esquema: cStat 225 achado na ODARA em 07/10). Testado com certificado gerado no teste: node --test lib/nfe-saida/nfe-puro.test.ts
import { SignedXml } from 'xml-crypto'

export function certificadoFolha(certPem: string): string {
  const m = certPem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)
  return m ? m[0] : certPem
}

function assinar(xml: string, elemento: 'infNFe' | 'infEvento', id: string, certPem: string, keyPem: string): string {
  const sig = new SignedXml({ privateKey: keyPem, publicCert: certificadoFolha(certPem) })
  sig.addReference({
    xpath: `//*[local-name(.)='${elemento}']`,
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
    uri: `#${id}`,
  })
  sig.canonicalizationAlgorithm = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
  sig.signatureAlgorithm = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1'
  sig.computeSignature(xml, { location: { reference: `//*[local-name(.)='${elemento}']`, action: 'after' } })
  return sig.getSignedXml()
}

/** Assina a NF-e (referência = Id do infNFe, "NFe" + chave); a Signature entra logo depois do infNFe, dentro do NFe. */
export function assinarNfe(xml: string, id: string, certPem: string, keyPem: string): string {
  return assinar(xml, 'infNFe', id, certPem, keyPem)
}

/** Assina um evento (cancelamento, CC-e): referência = Id do infEvento. */
export function assinarEventoNfe(xml: string, id: string, certPem: string, keyPem: string): string {
  return assinar(xml, 'infEvento', id, certPem, keyPem)
}
