import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error: import com .ts exigido pelo node --test
import { AVISO_HOMOLOGACAO_XNOME, calcularTotais, dataHoraSaoPaulo, dvModulo11, gerarCnf, gtinValido, montarChave, montarNfe, textoNfe, validarDadosNfe } from './nfe-puro.ts'
// @ts-expect-error: idem
import { assinarNfe } from './assinatura.ts'
// @ts-expect-error: idem
import { montarEnviNFe, montarProcNFe } from './sefaz-puro.ts'
// @ts-expect-error: idem
import { assinaturaConfere } from '../estoque/nfe-assinatura.ts'
// @ts-expect-error: idem
import { lerNfe } from '../estoque/nfe-xml.ts'
// @ts-expect-error: idem
import { certificadoDeTeste, temXmllint, validarXsd } from './teste-apoio.ts'
// @ts-expect-error: idem
import { dadosDevolucao, dadosTransferencia } from './exemplos.ts'

test('chave de acesso: DV módulo 11 confere com chave real conhecida', () => {
  // chave pública de homologação documentada no AGENTS.md do Norte Vendas (NF-e 55 autorizada na BA)
  const real = '29260839912717000145559200000000011572912991'
  assert.equal(dvModulo11(real.slice(0, 43)), Number(real[43]))
  const ch = montarChave({ cUF: '29', dhEmi: '2026-10-20T10:15:00-03:00', cnpj: '11222333000181', serie: 920, numero: 7, cNF: '48151623' })
  assert.equal(ch.length, 44)
  assert.equal(ch.slice(2, 6), '2610')
  assert.equal(ch.slice(20, 22), '55')
  assert.equal(ch.slice(22, 25), '920')
  assert.equal(ch.slice(25, 34), '000000007')
  assert.equal(ch.slice(34, 35), '1')
  assert.equal(dvModulo11(ch.slice(0, 43)), Number(ch[43]))
})

test('cNF nunca igual ao número da nota', () => {
  assert.notEqual(gerarCnf(12345678, () => 0.12345678), '12345678')
  assert.match(gerarCnf(1), /^\d{8}$/)
})

test('texto: só Latin-1, sem espaço repetido, troca aspas/travessão tipográficos', () => {
  assert.equal(textoNfe('  Galpão 3 – fundos  “A”  '), 'Galpão 3 - fundos "A"')
  assert.equal(textoNfe('emoji 🍅 tomate'), 'emoji tomate')
  assert.equal(textoNfe('x'.repeat(80), 60).length, 60)
})

test('GTIN: dígito verificador', () => {
  assert.equal(gtinValido('7891234567895'), '7891234567895')
  assert.equal(gtinValido('7891234567890'), null)
  assert.equal(gtinValido('SEM GTIN'), null)
})

test('dhEmi em São Paulo mesmo com o processo em UTC (virada de dia)', () => {
  assert.equal(dataHoraSaoPaulo(new Date('2026-01-01T02:30:00Z')), '2025-12-31T23:30:00-03:00')
})

test('validação lista o que falta (sem NCM, sem cMun, devolução sem referência)', () => {
  const d = dadosDevolucao()
  d.itens[0].ncm = ''
  d.dest.ender = { ...d.dest.ender, cMun: '' }
  d.refNFe = []
  const e = validarDadosNfe(d)
  assert.ok(e.some((x: string) => x.includes('NCM')))
  assert.ok(e.some((x: string) => x.includes('Destinatário: código IBGE')))
  assert.ok(e.some((x: string) => x.includes('chave da NF-e de origem')))
  assert.throws(() => montarNfe(d), /Dados incompletos/)
})

test('totais: vNF = vProd − vDesc + vST + vFrete + vSeg + vOutro + vIPIDevol; ICMS/ST somados dos itens', () => {
  const d = dadosDevolucao()
  const t = calcularTotais(d.itens)
  // azeite metade: vProd 300, desc 10, frete 15, outro 5, BC 310 → ICMS 63,55; ST 18,45 (BCST 400); IPI devolvido 30
  // tomate inteiro: 105
  assert.equal(t.vProd, 405)
  assert.equal(t.vDesc, 10)
  assert.equal(t.vFrete, 15)
  assert.equal(t.vOutro, 5)
  assert.equal(t.vBC, 310)
  assert.equal(t.vICMS, 63.55)
  assert.equal(t.vBCST, 400)
  assert.equal(t.vST, 18.45)
  assert.equal(t.vIPIDevol, 30)
  assert.equal(t.vNF, 405 - 10 + 18.45 + 15 + 5 + 30)
})

test('devolução em homologação: finNFe 4, refNFe, tPag 90, aviso no xNome do destinatário, escape de &', () => {
  const { xml, chave, id } = montarNfe(dadosDevolucao(2))
  assert.equal(id, `NFe${chave}`)
  assert.match(xml, /<finNFe>4<\/finNFe>/)
  assert.match(xml, /<tpAmb>2<\/tpAmb>/)
  assert.match(xml, /<NFref><refNFe>29261011444777000161550010000123451000012340<\/refNFe><\/NFref><\/ide>/)
  assert.match(xml, new RegExp(`<xNome>${AVISO_HOMOLOGACAO_XNOME}</xNome>`))
  assert.match(xml, /<tPag>90<\/tPag><vPag>0.00<\/vPag>/)
  assert.match(xml, /AZEITE EXTRA VIRGEM 500ML &amp; CIA/)
  assert.match(xml, /<CFOP>5411<\/CFOP>/) // entrada 1.403 (ST) → devolução 5.411
  assert.match(xml, /<ICMSSN900><orig>0<\/orig><CSOSN>900<\/CSOSN><modBC>3<\/modBC><vBC>310.00<\/vBC>/)
  assert.match(xml, /<impostoDevol><pDevol>50.00<\/pDevol><IPI><vIPIDevol>30.00<\/vIPIDevol><\/IPI><\/impostoDevol>/)
  assert.match(xml, /<autXML><CNPJ>13937073000156<\/CNPJ><\/autXML>/)
  assert.match(xml, /<indIEDest>1<\/indIEDest><IE>987654321<\/IE>/)
})

test('devolução em produção: nome real do destinatário; regime normal usa CST 90 (com ST) e CST 00 (só próprio)', () => {
  const { xml } = montarNfe(dadosDevolucao(1, 3))
  assert.match(xml, /<xNome>DISTRIBUIDORA DE ALIMENTOS EXEMPLO LTDA<\/xNome>/)
  assert.match(xml, /<ICMS90><orig>0<\/orig><CST>90<\/CST>/)
  assert.match(xml, /<CRT>3<\/CRT>/)
})

test('transferência interestadual: CFOP 6.152 / 6.151 (produção), CSOSN 400, IE ISENTO = indIEDest 2, transportadora e volumes', () => {
  const { xml } = montarNfe(dadosTransferencia())
  assert.match(xml, /<idDest>2<\/idDest>/)
  assert.match(xml, /<CFOP>6152<\/CFOP>/)
  assert.match(xml, /<CFOP>6151<\/CFOP>/)
  assert.match(xml, /<ICMSSN102><orig>0<\/orig><CSOSN>400<\/CSOSN><\/ICMSSN102>/)
  assert.match(xml, /<indIEDest>2<\/indIEDest><\/dest>/)
  assert.match(xml, /<finNFe>1<\/finNFe>/)
  assert.doesNotMatch(xml, /<NFref>/)
  assert.match(xml, /<modFrete>0<\/modFrete><transporta><CNPJ>11444777000161<\/CNPJ>/)
  assert.match(xml, /<vol><qVol>2<\/qVol><esp>CAIXA<\/esp><pesoL>12.500<\/pesoL><pesoB>13.000<\/pesoB><\/vol>/)
  assert.match(xml, /<vUnCom>30.1234560000<\/vUnCom>/)
})

const xsd = temXmllint()

test('XSD oficial (PL_009_V4): NF-e assinada de devolução, de transferência, o lote enviNFe e o procNFe', { skip: !xsd && 'xmllint ausente' }, () => {
  const { certPem, keyPem } = certificadoDeTeste()
  // o validador pega erro de verdade: sem assinatura e com campo fora de ordem o XSD recusa
  const semAssinatura = montarNfe(dadosDevolucao(2)).xml
  assert.match(validarXsd(semAssinatura, 'nfe_v4.00.xsd') ?? '', /Signature/)
  const { xml: x0, id: i0 } = montarNfe(dadosDevolucao(2))
  const foraDeOrdem = assinarNfe(x0.replace(/<tpNF>1<\/tpNF>(<idDest>\d<\/idDest>)/, '$1<tpNF>1</tpNF>'), i0, certPem, keyPem)
  assert.notEqual(validarXsd(foraDeOrdem, 'nfe_v4.00.xsd'), null)
  for (const [nome, dados] of [['devolução homologação', dadosDevolucao(2)], ['devolução produção normal', dadosDevolucao(1, 3)], ['transferência', dadosTransferencia()]] as const) {
    const { xml, id } = montarNfe(dados)
    const assinado = assinarNfe(xml, id, certPem, keyPem)
    assert.equal(validarXsd(assinado, 'nfe_v4.00.xsd'), null, nome)
    assert.equal(validarXsd(montarEnviNFe(assinado, 42), 'enviNFe_v4.00.xsd'), null, `${nome} (enviNFe)`)
    const chave = id.slice(3)
    const prot = `<protNFe versao="4.00"><infProt><tpAmb>${dados.tpAmb}</tpAmb><verAplic>BA_TESTE</verAplic><chNFe>${chave}</chNFe><dhRecbto>2026-10-20T10:15:05-03:00</dhRecbto><nProt>129260000000001</nProt><digVal>${'A'.repeat(27)}=</digVal><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>`
    const proc = montarProcNFe(assinado, prot)
    assert.equal(validarXsd(proc, 'procNFe_v4.00.xsd'), null, `${nome} (procNFe)`)
  }
})

test('assinatura confere (xml-crypto) e quebra se o conteúdo mudar; o leitor de NF-e do estoque lê a nota emitida', () => {
  const { certPem, keyPem } = certificadoDeTeste()
  const { xml, id, chave } = montarNfe(dadosDevolucao(2))
  const assinado = assinarNfe(xml, id, certPem, keyPem)
  assert.equal((assinado.match(/<X509Certificate>/g) ?? []).length, 1)
  assert.equal(assinaturaConfere(assinado), true)
  assert.equal(assinaturaConfere(assinado.replace('<vNF>', '<vNF>1')), false)
  const lida = lerNfe(assinado)
  assert.equal(lida.chave, chave)
  assert.equal(lida.finalidade, '4')
  assert.equal(lida.itens.length, 2)
  assert.equal(lida.fornecedor.cnpj, '11222333000181')
})
