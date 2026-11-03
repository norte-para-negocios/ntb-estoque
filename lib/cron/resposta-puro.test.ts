import { test } from 'node:test'
import assert from 'node:assert/strict'
import { statusDoCron, corpoDoCron, resultadosDeSettled, resultadoDeRetry, statusComTotal502, resultadosDoEspelho, type ResultadoCronLoja } from './resposta-puro.ts'

test('todas ok -> 200', () => {
  const r: ResultadoCronLoja[] = [1, 2, 3].map((loja) => ({ loja, ok: true }))
  assert.equal(statusDoCron(r), 200)
})

test('1 falha de 6 -> 500 com o resumo por loja', () => {
  const r: ResultadoCronLoja[] = [1, 2, 3, 5, 6, 7].map((loja) => ({ loja, ok: loja !== 6, erro: loja === 6 ? 'SOAP-ERROR' : null }))
  assert.equal(statusDoCron(r), 500)
  assert.deepEqual(corpoDoCron(r), { total: 6, ok: 5, falhas: 1, erros: [{ loja: 6, erro: 'SOAP-ERROR' }] })
})

test('lista vazia -> 200 (nada a fazer)', () => {
  assert.equal(statusDoCron([]), 200)
  assert.deepEqual(corpoDoCron([]), { total: 0, ok: 0, falhas: 0, erros: [] })
})

test('loja sem trabalho e sem erro conta como ok', () => {
  const r: ResultadoCronLoja[] = [{ loja: 1, ok: false, trabalho: false }, { loja: 2, ok: true }]
  assert.equal(statusDoCron(r), 200)
  assert.equal(corpoDoCron(r).falhas, 0)
})

test('loja com trabalho e ok=false conta como falha mesmo sem texto de erro', () => {
  const r: ResultadoCronLoja[] = [{ loja: 1, ok: false, trabalho: true }]
  assert.equal(statusDoCron(r), 500)
  assert.equal(corpoDoCron(r).erros[0].erro, 'falhou sem mensagem')
})

test('erro informado sempre falha, mesmo com ok=true', () => {
  assert.equal(statusDoCron([{ loja: 1, ok: true, erro: 'x' }]), 500)
})

test('resultadosDeSettled: rejeitada vira falha com a mensagem', () => {
  const lojas = [{ id: 1 }, { id: 2 }]
  const s: PromiseSettledResult<unknown>[] = [{ status: 'fulfilled', value: 1 }, { status: 'rejected', reason: new Error('timeout') }]
  const r = resultadosDeSettled(lojas, s)
  assert.deepEqual(r, [{ loja: 1, ok: true, erro: null }, { loja: 2, ok: false, erro: 'timeout' }])
})

test('resultadosDeSettled: aceita validador extra do valor', () => {
  const s: PromiseSettledResult<{ error: { message: string } | null }>[] = [{ status: 'fulfilled', value: { error: { message: 'rpc' } } }]
  const r = resultadosDeSettled([{ id: 9 }], s, (v) => v.error?.message ?? null)
  assert.deepEqual(r, [{ loja: 9, ok: false, erro: 'rpc' }])
})

test('retry: sem nada pendente é saudável (200)', () => {
  assert.equal(statusDoCron([resultadoDeRetry({ loja_id: 1, tentadas: 0, sucesso: 0, falhas: 0 })]), 200)
})
test('retry: tentou e nada deu certo -> 500; encerradas contam como resolvido; erro de consulta -> 500', () => {
  assert.equal(statusDoCron([resultadoDeRetry({ loja_id: 1, tentadas: 3, sucesso: 0, falhas: 3 })]), 500)
  assert.equal(statusDoCron([resultadoDeRetry({ loja_id: 1, tentadas: 3, sucesso: 0, falhas: 0, encerradas: 3 })]), 200)
  assert.equal(statusDoCron([resultadoDeRetry({ loja_id: 1, tentadas: 0, sucesso: 0, erro: 'query' })]), 500)
  assert.equal(statusDoCron([resultadoDeRetry({ loja_id: 1, tentadas: 4, sucesso: 1, falhas: 3 })]), 200)
})

test('statusComTotal502: todas falham 502, parcial 500, nenhuma 200, vazio 200', () => {
  const f = (loja: number) => ({ loja, ok: false, erro: 'x' })
  const o = (loja: number) => ({ loja, ok: true })
  assert.equal(statusComTotal502([f(1), f(2)]), 502)
  assert.equal(statusComTotal502([f(1), o(2)]), 500)
  assert.equal(statusComTotal502([o(1)]), 200)
  assert.equal(statusComTotal502([]), 200)
})

test('resultadosDoEspelho: pulado não é falha', () => {
  const r = resultadosDoEspelho([{ loja: 1 }, { loja: 2, erro: 'boom' }])
  assert.deepEqual(r.map((x) => x.ok), [true, false])
})
