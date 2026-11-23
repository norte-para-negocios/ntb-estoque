import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  casarContaDoCartao, decidirAlteracaoDoTitulo, normalizarNome, tipoDoTPag, type ContaCorrenteOmie,
} from './roteamento-cartao-puro.ts'

const nomes: Array<[number, string, string?]> = [
  [6690551203, 'GetNet - Visa Crédito'], [6690551204, 'GetNet - Visa Electron Débito'],
  [6690551205, 'GetNet - Mastercard Crédito'], [6690551206, 'GetNet - Mastercard Débito'],
  [6690551207, 'GetNet - Elo Crédito'], [6690551208, 'GetNet - Elo Débito'],
  [6690551209, 'GetNet - American Express Crédito'], [6690551210, 'GetNet - Hipercard Crédito'],
  [6690551211, 'GetNet - Sodexo Refeição Crédito'], [6690551212, 'GetNet - Alelo Refeição Crédito'],
  [6690551213, 'GetNet - Ticket Alimentação Crédito'],
  [6719180709, 'Rede - Visa Credito'], [6719180710, 'Rede - Visa Debito'],
  [6719180711, 'Rede - Matercard Credito'], [6719180712, 'Rede - Matercard Debito'],
  [6719180713, 'Rede - Elo Credito'], [6719180714, 'Rede - Hipercard Credito'], [6719180715, 'Rede - Amex Credito'],
  // contas antigas de 2021: sem maquininha no nome
  [111, 'Visa - Crédito (à vista)'], [112, 'MasterCard - Débito'], [113, 'Elo - Crédito (à vista)'],
]
const contas: ContaCorrenteOmie[] = [
  ...nomes.map(([nCodCC, descricao]) => ({ nCodCC, descricao, tipo_conta_corrente: 'AC', inativo: 'N' })),
  { nCodCC: 2104002652, descricao: 'Caixinha', tipo_conta_corrente: 'CX', inativo: 'N' },
]
const id = (r: ReturnType<typeof casarContaDoCartao>) => (r.ok ? r.conta.nCodCC : r.motivo)

test('tPag: cartao e vale', () => {
  assert.equal(tipoDoTPag('03'), 'credito')
  assert.equal(tipoDoTPag('04'), 'debito')
  assert.equal(tipoDoTPag('10'), 'vale')
  assert.equal(tipoDoTPag('12'), 'vale')
  assert.equal(tipoDoTPag('17'), null) // pix
  assert.equal(tipoDoTPag('01'), null) // dinheiro
})

test('normaliza acento e caixa', () => {
  assert.equal(normalizarNome('GetNet - Visa Crédito').trim(), 'getnet visa credito')
})

test('casa por maquininha + bandeira + credito/debito', () => {
  assert.equal(id(casarContaDoCartao(contas, { acquirer: 'getnet', brand: 'visa', tPag: '03' })), 6690551203)
  assert.equal(id(casarContaDoCartao(contas, { acquirer: 'rede', brand: 'visa', tPag: '03' })), 6719180709)
  assert.equal(id(casarContaDoCartao(contas, { acquirer: 'getnet', brand: 'visa', tPag: '04' })), 6690551204) // Visa Electron
  assert.equal(id(casarContaDoCartao(contas, { acquirer: 'rede', brand: 'visa', tPag: '04' })), 6719180710)
})

test('apelidos de bandeira: matercard, amex, american express', () => {
  assert.equal(id(casarContaDoCartao(contas, { acquirer: 'rede', brand: 'mastercard', tPag: '04' })), 6719180712)
  assert.equal(id(casarContaDoCartao(contas, { acquirer: 'rede', brand: 'mastercard', tPag: '03' })), 6719180711)
  assert.equal(id(casarContaDoCartao(contas, { acquirer: 'getnet', brand: 'amex', tPag: '03' })), 6690551209)
  assert.equal(id(casarContaDoCartao(contas, { acquirer: 'rede', brand: 'amex', tPag: '03' })), 6719180715)
})

test('vale nao exige credito/debito e casa pelo nome da bandeira', () => {
  assert.equal(id(casarContaDoCartao(contas, { acquirer: 'getnet', brand: 'alelo', tPag: '10' })), 6690551212)
  assert.equal(id(casarContaDoCartao(contas, { acquirer: 'getnet', brand: 'sodexo', tPag: '10' })), 6690551211)
  assert.equal(id(casarContaDoCartao(contas, { acquirer: 'getnet', brand: 'ticket', tPag: '11' })), 6690551213)
})

test('nao casa contas antigas de 2021 (sem maquininha) nem combinacao inexistente', () => {
  const r = casarContaDoCartao(contas, { acquirer: 'cielo', brand: 'visa', tPag: '03' })
  assert.equal(r.ok, false)
  const soAntigas = contas.filter((c) => c.nCodCC < 1000)
  assert.equal(casarContaDoCartao(soAntigas, { acquirer: 'getnet', brand: 'visa', tPag: '03' }).ok, false)
  // GetNet nao tem Hipercard debito
  assert.equal(casarContaDoCartao(contas, { acquirer: 'getnet', brand: 'hipercard', tPag: '04' }).ok, false)
})

test('ambiguo (duas contas casam) nao escolhe', () => {
  const dup = [...contas, { nCodCC: 999, descricao: 'GetNet Visa Credito 2', tipo_conta_corrente: 'AC', inativo: 'N' }]
  const r = casarContaDoCartao(dup, { acquirer: 'getnet', brand: 'visa', tPag: '03' })
  assert.equal(r.ok, false)
  assert.match(String(id(r)), /ambiguo/)
})

test('ignora conta inativa e conta que nao e AC', () => {
  const inativa = contas.map((c) => (c.nCodCC === 6690551203 ? { ...c, inativo: 'S' } : c))
  assert.equal(casarContaDoCartao(inativa, { acquirer: 'getnet', brand: 'visa', tPag: '03' }).ok, false)
  const naoAc = contas.map((c) => (c.nCodCC === 6690551203 ? { ...c, tipo_conta_corrente: 'CC' } : c))
  assert.equal(casarContaDoCartao(naoAc, { acquirer: 'getnet', brand: 'visa', tPag: '03' }).ok, false)
})

test('sem bandeira ou tPag nao cartao: nao casa', () => {
  assert.equal(casarContaDoCartao(contas, { acquirer: 'getnet', brand: null, tPag: '03' }).ok, false)
  assert.equal(casarContaDoCartao(contas, { acquirer: 'getnet', brand: 'visa', tPag: '17' }).ok, false)
})

// Exemplo real: loja 4, titulo nfce1334-2, valor 127, Visa credito, hoje na Caixinha
const CH = '1'.repeat(44)
const tituloReal = {
  codigo_lancamento_omie: 555, chave_nfe: CH, valor_documento: 127, id_conta_corrente: 2104002652,
  codigo_cliente_fornecedor: 77, data_vencimento: '22/11/2026', codigo_categoria: '1.01.01',
}
const porId = new Map(contas.map((c) => [c.nCodCC, c]))
const getnetVisa = contas.find((c) => c.nCodCC === 6690551203)!

test('decide alterar: exemplo real nfce1334-2', () => {
  const d = decidirAlteracaoDoTitulo({ titulo: tituloReal, chNFe: CH, vPag: 127, contaDestino: getnetVisa, contasPorId: porId })
  assert.equal(d.alterar, true)
  if (d.alterar) {
    assert.equal(d.payload.id_conta_corrente, 6690551203)
    assert.equal(d.payload.codigo_lancamento_omie, 555)
    assert.equal(d.payload.codigo_categoria, '1.01.01')
  }
})

test('nao altera: chave diferente, valor diferente, conta ja mexida, ja na conta certa', () => {
  const base = { chNFe: CH, vPag: 127, contaDestino: getnetVisa, contasPorId: porId }
  assert.equal(decidirAlteracaoDoTitulo({ ...base, titulo: { ...tituloReal, chave_nfe: '2'.repeat(44) } }).alterar, false)
  assert.equal(decidirAlteracaoDoTitulo({ ...base, titulo: { ...tituloReal, valor_documento: 120 } }).alterar, false)
  assert.equal(decidirAlteracaoDoTitulo({ ...base, titulo: { ...tituloReal, id_conta_corrente: 6719180709 } }).alterar, false) // ja em AC
  assert.equal(decidirAlteracaoDoTitulo({ ...base, titulo: { ...tituloReal, id_conta_corrente: 6690551203 } }).alterar, false)
  assert.equal(decidirAlteracaoDoTitulo({ ...base, titulo: { ...tituloReal, id_conta_corrente: 42 } }).alterar, false) // conta desconhecida
  assert.equal(decidirAlteracaoDoTitulo({ ...base, titulo: { ...tituloReal, codigo_categoria: undefined } }).alterar, false)
})

test('tolerancia de 1 centavo no valor', () => {
  const d = decidirAlteracaoDoTitulo({ titulo: { ...tituloReal, valor_documento: 127.005 }, chNFe: CH, vPag: 127, contaDestino: getnetVisa, contasPorId: porId })
  assert.equal(d.alterar, true)
})
