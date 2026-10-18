import { test } from 'node:test'
import assert from 'node:assert/strict'
import forge from 'node-forge'
import { SignedXml } from 'xml-crypto'
import { assinaturaConfere } from './nfe-assinatura.ts'
import { XML_CRBS_131055 } from './fixtures/nfe-crbs-131055.ts'

// Certificado autoassinado gerado no teste (nenhum dado real): assina um infNFe mínimo como o emitente faria.
function assinado(): string {
  const chaves = forge.pki.rsa.generateKeyPair(1024)
  const cert = forge.pki.createCertificate()
  cert.publicKey = chaves.publicKey; cert.serialNumber = '01'
  cert.validity.notBefore = new Date('2026-01-01'); cert.validity.notAfter = new Date('2027-01-01')
  cert.setSubject([{ name: 'commonName', value: 'TESTE' }]); cert.setIssuer([{ name: 'commonName', value: 'TESTE' }])
  cert.sign(chaves.privateKey, forge.md.sha256.create())
  const certPem = forge.pki.certificateToPem(cert), keyPem = forge.pki.privateKeyToPem(chaves.privateKey)
  const xml = '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe1"><ide><nNF>1</nNF></ide><total><vNF>10.00</vNF></total></infNFe></NFe></nfeProc>'
  const sig = new SignedXml({ privateKey: keyPem, publicCert: certPem })
  sig.addReference({ xpath: "//*[local-name(.)='infNFe']", transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'], digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1', uri: '#NFe1' })
  sig.canonicalizationAlgorithm = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
  sig.signatureAlgorithm = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1'
  sig.computeSignature(xml, { location: { reference: "//*[local-name(.)='infNFe']", action: 'after' } })
  return sig.getSignedXml()
}

test('assinatura do próprio XML confere; conteúdo alterado não confere', () => {
  const x = assinado()
  assert.equal(assinaturaConfere(x), true)
  assert.equal(assinaturaConfere(x.replace('<vNF>10.00</vNF>', '<vNF>99.00</vNF>')), false)
})
test('sem assinatura ou sem certificado: null; certificado de mentira: false, nunca lança', () => {
  assert.equal(assinaturaConfere('<nfeProc><NFe><infNFe Id="NFe1"/></NFe></nfeProc>'), null)
  assert.equal(assinaturaConfere(assinado().replace(/<X509Certificate>[\s\S]*?<\/X509Certificate>/, '')), null)
  assert.equal(assinaturaConfere(XML_CRBS_131055), false)
})
