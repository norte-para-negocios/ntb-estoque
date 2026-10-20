import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error: import com .ts exigido pelo node --test
import { lerNotaOrigem } from './origem-puro.ts'
// @ts-expect-error: idem
import { montarNfe } from './nfe-puro.ts'
// @ts-expect-error: idem
import { cfopDevolucaoBase, cfopPorUf, itemDevolucao, proporcaoDevolvida } from './regras-puro.ts'
// @ts-expect-error: idem
import { assinarNfe } from './assinatura.ts'
// @ts-expect-error: idem
import { certificadoDeTeste, temXmllint, validarXsd } from './teste-apoio.ts'
// @ts-expect-error: idem
import { dadosDevolucao, ENDERECO_EMIT, ENDERECO_FORN } from './exemplos.ts'

// Nota do FORNECEDOR (regime normal, ICMS 00 e ICMS 90 com ST) montada pelo próprio gerador, para fechar o ciclo
// "entrada → devolução" sem XML real de terceiros no repositório.
function notaDoFornecedor(): string {
  const d = dadosDevolucao(1, 3)
  const { xml } = montarNfe({
    ...d, finNFe: 1, refNFe: [], natOp: 'VENDA', numero: 12345, serie: 1, cNF: '10203040',
    emit: { cnpj: '11444777000161', xNome: 'DISTRIBUIDORA DE ALIMENTOS EXEMPLO LTDA', ender: ENDERECO_FORN, ie: '987654321', crt: 3 },
    dest: { doc: '11222333000181', xNome: 'ODARA RESTAURANTE LTDA', ender: ENDERECO_EMIT, ie: '123456789' },
    itens: d.itens.map((i: { cfop: string }) => ({ ...i, cfop: '5102', ipiDevol: null })),
  })
  return xml
}

test('lê emitente (vira destinatário da devolução) e itens com ICMS/ST da nota de origem', () => {
  const o = lerNotaOrigem(notaDoFornecedor())
  assert.equal(o.numero, '12345')
  assert.equal(o.serie, '1')
  assert.equal(o.ufEmit, 'BA')
  assert.equal(o.emitente.doc, '11444777000161')
  assert.equal(o.emitente.ie, '987654321')
  assert.equal(o.emitente.ender.cMun, '2927408')
  assert.equal(o.emitente.ender.xCpl, 'Galpão 3 - fundos')
  assert.equal(o.itens.length, 2)
  assert.equal(o.itens[0].cProd, 'AZ-500')
  assert.equal(o.itens[0].icms.vBC, 310)
  assert.equal(o.itens[0].icms.vICMSST, 18.45)
  assert.equal(o.itens[0].icms.pMVAST, 29.03)
  assert.equal(o.itens[1].icms.vBC, 0)
  // IPITrib é lido (o gerador de saída não emite IPI próprio; trecho manual)
  const comIpi = lerNotaOrigem(`<nfeProc><NFe><infNFe Id="NFe${'1'.repeat(44)}"><ide><nNF>1</nNF><serie>1</serie></ide><emit><CNPJ>11444777000161</CNPJ><enderEmit><UF>SP</UF></enderEmit></emit><det nItem="1"><prod><cProd>A</cProd><qCom>1</qCom></prod><imposto><ICMS><ICMS00><orig>2</orig></ICMS00></ICMS><IPI><cEnq>999</cEnq><IPITrib><CST>50</CST><vBC>100</vBC><pIPI>10</pIPI><vIPI>10.00</vIPI></IPITrib></IPI></imposto></det></infNFe></NFe></nfeProc>`)
  assert.equal(comIpi.itens[0].vIPI, 10)
  assert.equal(comIpi.itens[0].orig, 2)
})

test('ciclo entrada → devolução parcial: a devolução montada da nota lida passa no XSD', { skip: !temXmllint() && 'xmllint ausente' }, () => {
  const o = lerNotaOrigem(notaDoFornecedor())
  const f = proporcaoDevolvida(1, 2) // metade
  const itens = o.itens.map((it: never) => itemDevolucao(it, { proporcao: f, cfop: cfopPorUf(cfopDevolucaoBase('1403'), 'BA', o.ufEmit), crt: 1, cstPisCofins: '49' }))
  const base = dadosDevolucao(2, 1)
  const { xml, id } = montarNfe({ ...base, itens, refNFe: [o.chave], dest: { doc: o.emitente.doc, xNome: o.emitente.xNome, ender: o.emitente.ender, ie: o.emitente.ie } })
  const { certPem, keyPem } = certificadoDeTeste()
  assert.equal(validarXsd(assinarNfe(xml, id, certPem, keyPem), 'nfe_v4.00.xsd'), null)
  assert.match(xml, new RegExp(`<refNFe>${o.chave}</refNFe>`))
})
