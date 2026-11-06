import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assinarSessao, conferirSessao } from './sessao-verificada-puro.ts'

const CHAVE = 'chave-de-teste'
const UID = '0c4e94fe-93be-4914-84b1-263efdbbb7f2'
const TOKEN = 'header.payload.assinatura'

test('assinatura do proxy para o mesmo token devolve o usuário', () => {
  assert.equal(conferirSessao(CHAVE, assinarSessao(CHAVE, UID, TOKEN), TOKEN), UID)
})

test('token diferente do assinado (cookie trocado ou renovado depois) não passa', () => {
  assert.equal(conferirSessao(CHAVE, assinarSessao(CHAVE, UID, TOKEN), TOKEN + 'x'), null)
})

test('trocar o usuário mantendo a assinatura não passa', () => {
  const v = assinarSessao(CHAVE, UID, TOKEN)
  const outro = '11111111-1111-1111-1111-111111111111' + v.slice(UID.length)
  assert.equal(conferirSessao(CHAVE, outro, TOKEN), null)
})

test('assinatura com outra chave (forjada fora do servidor) não passa', () => {
  assert.equal(conferirSessao(CHAVE, assinarSessao('outra', UID, TOKEN), TOKEN), null)
})

test('sem chave, sem cabeçalho, sem token ou valor malformado: null (página volta a conferir no login)', () => {
  const v = assinarSessao(CHAVE, UID, TOKEN)
  assert.equal(conferirSessao(undefined, v, TOKEN), null)
  assert.equal(conferirSessao('', v, TOKEN), null)
  assert.equal(conferirSessao(CHAVE, null, TOKEN), null)
  assert.equal(conferirSessao(CHAVE, v, null), null)
  assert.equal(conferirSessao(CHAVE, 'semponto', TOKEN), null)
  assert.equal(conferirSessao(CHAVE, '.abc', TOKEN), null)
  assert.equal(conferirSessao(CHAVE, `${UID}.`, TOKEN), null)
})
