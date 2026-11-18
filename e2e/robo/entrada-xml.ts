// Monta um XML de NF-e de TESTE (procNFe) para a tela "Importar XML": chave com DV correto, protocolo 100, ambiente de
// produção, assinatura digital feita com um certificado autoassinado gerado na hora (nenhum dado real; o certificado e a
// chave privada só existem na memória). O emitente é um fornecedor fictício; o destinatário é o CNPJ da loja testada.
import forge from 'node-forge'
import { SignedXml } from 'xml-crypto'

export type ItemXml = { cProd: string; descricao: string; unidade: string; quantidade: string; valorUnitario: string; desconto?: string }
export type NotaXml = {
  numero: string; emissao: string /* AAAA-MM-DD */; emitenteCnpj: string; emitenteNome: string; destinatarioCnpj: string; destinatarioNome: string
  itens: ItemXml[]; duplicatas: { nDup: string; vencimento: string; valor: string }[]
}

const dig = (s: string) => s.replace(/\D/g, '')
const cent = (v: string) => Math.round(Number(v) * 100)
const money = (c: number) => (c / 100).toFixed(2)

/** DV da chave de acesso (módulo 11, pesos 2 a 9 da direita para a esquerda). */
export function dvDaChave(base43: string): number {
  let soma = 0, peso = 2
  for (let i = base43.length - 1; i >= 0; i--) { soma += Number(base43[i]) * peso; peso = peso === 9 ? 2 : peso + 1 }
  const r = soma % 11
  return r < 2 ? 0 : 11 - r
}

export function chaveDeAcesso(n: NotaXml): string {
  const aamm = n.emissao.slice(2, 4) + n.emissao.slice(5, 7)
  const base = `29${aamm}${dig(n.emitenteCnpj)}55${'001'}${n.numero.padStart(9, '0')}${'1'}${n.numero.padStart(8, '0').slice(-8)}`
  return base + String(dvDaChave(base))
}

export function montarXmlAssinado(n: NotaXml): { xml: string; chave: string; totalNota: string } {
  const chave = chaveDeAcesso(n)
  const bruto = n.itens.map((i) => Math.round(Number(i.quantidade) * Number(i.valorUnitario) * 100))
  const totalProd = bruto.reduce((a, b) => a + b, 0)
  const totalDesc = n.itens.reduce((a, i) => a + cent(i.desconto ?? '0'), 0)
  const totalNf = totalProd - totalDesc
  const dets = n.itens.map((i, k) => `<det nItem="${k + 1}"><prod><cProd>${i.cProd}</cProd><cEAN>SEM GTIN</cEAN><xProd>${i.descricao}</xProd><NCM>21069090</NCM><CFOP>5102</CFOP><uCom>${i.unidade}</uCom><qCom>${Number(i.quantidade).toFixed(4)}</qCom><vUnCom>${Number(i.valorUnitario).toFixed(10)}</vUnCom><vProd>${money(bruto[k])}</vProd>${cent(i.desconto ?? '0') ? `<vDesc>${money(cent(i.desconto!))}</vDesc>` : ''}</prod><imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS></imposto></det>`).join('')
  const dups = n.duplicatas.length ? `<cobr><fat><nFat>${n.numero}</nFat><vOrig>${money(totalNf)}</vOrig><vLiq>${money(totalNf)}</vLiq></fat>${n.duplicatas.map((d) => `<dup><nDup>${d.nDup}</nDup><dVenc>${d.vencimento}</dVenc><vDup>${Number(d.valor).toFixed(2)}</vDup></dup>`).join('')}</cobr>` : ''
  const corpo = `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${chave}" versao="4.00"><ide><cUF>29</cUF><natOp>Venda de mercadoria</natOp><mod>55</mod><serie>1</serie><nNF>${n.numero}</nNF><dhEmi>${n.emissao}T10:00:00-03:00</dhEmi><tpNF>1</tpNF><tpAmb>1</tpAmb><finNFe>1</finNFe></ide><emit><CNPJ>${dig(n.emitenteCnpj)}</CNPJ><xNome>${n.emitenteNome}</xNome><xFant>${n.emitenteNome}</xFant><IE>123456789</IE><CRT>1</CRT></emit><dest><CNPJ>${dig(n.destinatarioCnpj)}</CNPJ><xNome>${n.destinatarioNome}</xNome></dest>${dets}<total><ICMSTot><vBC>0.00</vBC><vICMS>0.00</vICMS><vProd>${money(totalProd)}</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>${money(totalDesc)}</vDesc><vOutro>0.00</vOutro><vNF>${money(totalNf)}</vNF></ICMSTot></total><transp><modFrete>9</modFrete></transp>${dups}</infNFe></NFe><protNFe versao="4.00"><infProt><tpAmb>1</tpAmb><chNFe>${chave}</chNFe><dhRecbto>${n.emissao}T10:00:05-03:00</dhRecbto><nProt>129260000000001</nProt><digVal>x</digVal><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe></nfeProc>`
  // certificado autoassinado só na memória
  const k = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = k.publicKey; cert.serialNumber = '01'
  cert.validity.notBefore = new Date(Date.now() - 86400000); cert.validity.notAfter = new Date(Date.now() + 86400000 * 30)
  cert.setSubject([{ name: 'commonName', value: 'ROBO TESTE ENTRADA' }]); cert.setIssuer([{ name: 'commonName', value: 'ROBO TESTE ENTRADA' }])
  cert.sign(k.privateKey, forge.md.sha256.create())
  const sig = new SignedXml({ privateKey: forge.pki.privateKeyToPem(k.privateKey), publicCert: forge.pki.certificateToPem(cert) })
  sig.addReference({ xpath: "//*[local-name(.)='infNFe']", transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'], digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1', uri: `#NFe${chave}` })
  sig.canonicalizationAlgorithm = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
  sig.signatureAlgorithm = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1'
  sig.computeSignature(corpo, { location: { reference: "//*[local-name(.)='infNFe']", action: 'after' } })
  return { xml: sig.getSignedXml(), chave, totalNota: money(totalNf) }
}
