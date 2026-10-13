import { test } from 'node:test'
import assert from 'node:assert/strict'
import { relogioBahia, janelaProibida, addDias, isoParaBr, lojaPodeEspelhar, ehErroDeLimiteOmie } from './espelho-lojas.ts'

test('relogioBahia: 02:30 UTC de 14/10 ainda é 13/10, 23h na Bahia', () => {
  assert.deepEqual(relogioBahia(new Date('2026-10-14T02:30:00Z')), { hoje: '2026-10-13', hora: 23 })
})

test('relogioBahia: 15:00 UTC = 12h do mesmo dia', () => {
  assert.deepEqual(relogioBahia(new Date('2026-10-13T15:00:00Z')), { hoje: '2026-10-13', hora: 12 })
})

test('janelaProibida: 00:00 até 06:59 da Bahia', () => {
  assert.equal(janelaProibida(new Date('2026-10-14T03:00:00Z')), true) // 00:00
  assert.equal(janelaProibida(new Date('2026-10-14T09:59:00Z')), true) // 06:59
  assert.equal(janelaProibida(new Date('2026-10-14T10:00:00Z')), false) // 07:00
  assert.equal(janelaProibida(new Date('2026-10-14T02:59:00Z')), false) // 23:59 do dia anterior
})

test('addDias atravessa mês e ano', () => {
  assert.equal(addDias('2026-07-01', -1), '2026-06-30')
  assert.equal(addDias('2026-12-31', 1), '2027-01-01')
  assert.equal(addDias('2026-10-13', -29), '2026-09-14')
})

test('isoParaBr', () => {
  assert.equal(isoParaBr('2026-07-01'), '01/07/2026')
})

const base = { id: 5, ativo: true, is_test: false, espelho_completo: true, modo_estoque: 'omie', omie_app_key: 'k' }

test('lojaPodeEspelhar: só loja real, ativa, com flag, modo omie e chave; nunca loja 4', () => {
  assert.equal(lojaPodeEspelhar(base), true)
  assert.equal(lojaPodeEspelhar({ ...base, id: 4 }), false)
  assert.equal(lojaPodeEspelhar({ ...base, is_test: true }), false)
  assert.equal(lojaPodeEspelhar({ ...base, espelho_completo: false }), false)
  assert.equal(lojaPodeEspelhar({ ...base, espelho_completo: null }), false)
  assert.equal(lojaPodeEspelhar({ ...base, modo_estoque: 'proprio' }), false)
  assert.equal(lojaPodeEspelhar({ ...base, omie_app_key: null }), false)
  assert.equal(lojaPodeEspelhar({ ...base, ativo: false }), false)
})

test('ehErroDeLimiteOmie: bloqueio, consumo redundante e requisição em andamento', () => {
  assert.equal(ehErroDeLimiteOmie('API bloqueada por consumo indevido', 'MISUSE_API_PROCESS'), true)
  assert.equal(ehErroDeLimiteOmie('Consumo redundante detectado', undefined), true)
  assert.equal(ehErroDeLimiteOmie('ERROR: REDUNDANT', undefined), true)
  assert.equal(ehErroDeLimiteOmie('Já existe uma requisição desse método em execução', undefined), true)
  assert.equal(ehErroDeLimiteOmie('Produto não encontrado', 'SOAP-ENV:Client-103'), false)
})
