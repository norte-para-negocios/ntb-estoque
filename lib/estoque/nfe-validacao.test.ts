import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lerNfe } from './nfe-xml.ts'
import { validarNfeImportada, validarXmlBruto, TAMANHO_MAX_XML_BYTES } from './nfe-validacao.ts'
import { XML_CRBS_131055 } from './fixtures/nfe-crbs-131055.ts'

const ODARA = '66764497000122'
const ok = lerNfe(XML_CRBS_131055)

test('nota autorizada, assinada, de terceiro para a loja: sem erro', () => {
  assert.deepEqual(validarNfeImportada(ok, { cnpjLoja: ODARA, assinaturaConfere: true }), { erros: [], avisos: [] })
})
test('sem protocolo, situação 302 (denegada), protocolo de outra chave', () => {
  assert.ok(validarNfeImportada({ ...ok, protocolo: null }, { cnpjLoja: ODARA, assinaturaConfere: true }).erros[0].startsWith('Este XML não tem o protocolo'))
  assert.deepEqual(validarNfeImportada({ ...ok, protocolo: { ...ok.protocolo!, cStat: '302' } }, { cnpjLoja: ODARA, assinaturaConfere: true }).erros, ['A SEFAZ não autorizou esta nota (situação 302).'])
  assert.ok(validarNfeImportada({ ...ok, protocolo: { ...ok.protocolo!, cStat: '150' } }, { cnpjLoja: ODARA, assinaturaConfere: true }).erros.length === 0)
  assert.ok(validarNfeImportada({ ...ok, protocolo: { ...ok.protocolo!, chave: '1'.repeat(44) } }, { cnpjLoja: ODARA, assinaturaConfere: true }).erros.includes('O protocolo é de outra chave de acesso.'))
})
test('homologação, sem assinatura, emitida pela própria loja, chave de outro CNPJ, NFC-e', () => {
  const c = { cnpjLoja: ODARA, assinaturaConfere: true }
  assert.ok(validarNfeImportada({ ...ok, ambiente: '2' }, c).erros.includes('Nota de homologação (teste): não entra no estoque.'))
  assert.ok(validarNfeImportada({ ...ok, assinatura: { presente: false } }, c).erros.includes('O XML não tem a assinatura digital do emitente.'))
  assert.ok(validarNfeImportada({ ...ok, fornecedor: { ...ok.fornecedor, cnpj: ODARA } }, c).erros.includes('Esta nota foi emitida pela própria loja.'))
  assert.ok(validarNfeImportada({ ...ok, fornecedor: { ...ok.fornecedor, cnpj: '11222333000144' } }, c).erros.includes('A chave de acesso não é do CNPJ do emitente.'))
  assert.ok(validarNfeImportada({ ...ok, modelo: '65' }, c).erros.some((e) => e.startsWith('Não é NF-e (modelo 65)')))
})
test('avisos: assinatura que não confere e XML de terceiro', () => {
  assert.deepEqual(validarNfeImportada(ok, { cnpjLoja: ODARA, assinaturaConfere: false }).avisos, ['A assinatura digital não confere com o conteúdo do XML.'])
  assert.deepEqual(validarNfeImportada(ok, { cnpjLoja: '11111111000111', assinaturaConfere: null }).avisos, ['O destinatário da nota não é o CNPJ desta loja.'])
})
test('validarXmlBruto: DOCTYPE com ENTITY e tamanho', () => {
  assert.equal(TAMANHO_MAX_XML_BYTES, 1_000_000)
  assert.deepEqual(validarXmlBruto('<!DOCTYPE x [<!ENTITY a "b">]><nfeProc/>'), ['O XML tem DOCTYPE/ENTITY: não é uma NF-e válida.'])
  assert.deepEqual(validarXmlBruto('<a>' + 'é'.repeat(500_001) + '</a>'), ['O arquivo passa de 1 MB.'])
  assert.deepEqual(validarXmlBruto(XML_CRBS_131055), [])
})
