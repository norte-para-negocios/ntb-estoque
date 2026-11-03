import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PRAZO_ROTA_VENDA_MS, ESPERA_CMC_APOS_OP_MS, prazoDaRota, passouDoPrazo, cabeNoPrazo, esperasCmcDaSaida } from './prazo-venda.ts'

test('prazo da rota: padrão bem abaixo dos 150 s do Vendas', () => {
  assert.equal(prazoDaRota(1_000, undefined), 1_000 + PRAZO_ROTA_VENDA_MS)
  assert.ok(PRAZO_ROTA_VENDA_MS <= 90_000)
})

test('prazo da rota: env válida vence, inválida/zero cai no padrão', () => {
  assert.equal(prazoDaRota(0, '45000'), 45_000)
  assert.equal(prazoDaRota(0, 'abc'), PRAZO_ROTA_VENDA_MS)
  assert.equal(prazoDaRota(0, '0'), PRAZO_ROTA_VENDA_MS)
  // Nunca acima de 120 s, senão volta a encostar nos 150 s do Vendas.
  assert.equal(prazoDaRota(0, '600000'), 120_000)
})

test('passouDoPrazo: sem prazo nunca passa; com prazo compara com agora', () => {
  assert.equal(passouDoPrazo(undefined, 10), false)
  assert.equal(passouDoPrazo(100, 99), false)
  assert.equal(passouDoPrazo(100, 100), true)
})

test('cabeNoPrazo: espera só se terminar antes do prazo', () => {
  assert.equal(cabeNoPrazo(undefined, 0, 999_999), true)
  assert.equal(cabeNoPrazo(100_000, 30_000, 62_000), true)
  assert.equal(cabeNoPrazo(100_000, 40_000, 62_000), false)
})

test('esperas do Sem CMC: produto sem OP (taxa, revenda) não espera nada', () => {
  assert.deepEqual(esperasCmcDaSaida(false), [])
})

test('esperas do Sem CMC: depois de OP, 1 espera maior que a janela de consumo redundante do Omie (60 s)', () => {
  const e = esperasCmcDaSaida(true)
  assert.equal(e.length, 1)
  assert.equal(e[0], ESPERA_CMC_APOS_OP_MS)
  assert.ok(ESPERA_CMC_APOS_OP_MS > 60_000)
})
