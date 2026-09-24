import { test } from 'node:test'
import assert from 'node:assert/strict'
import { segundosBloqueio, idAjusteExistente, ehCmcPendente, registrarBloqueio, msRestantesBloqueio } from './erros-omie.ts'

test('segundosBloqueio extrai N de consumo indevido', () => {
  assert.equal(segundosBloqueio('ERROR: API bloqueada por consumo indevido. Tente novamente em 1678 segundos.'), 1678)
  assert.equal(segundosBloqueio('ERROR: Consumo redundante detectado. Aguarde 5 segundos'), null)
  assert.equal(segundosBloqueio('qualquer outra'), null)
})

test('idAjusteExistente extrai o ID do ajuste já lançado', () => {
  const msg = 'ERROR: Já existe um ajuste de estoque para o código de integração [ITEM8962] com o ID [8995630051] para o produto de código [123]'
  assert.equal(idAjusteExistente(msg), 8995630051)
  assert.equal(idAjusteExistente('ERROR: outra coisa'), null)
})

test('ehCmcPendente reconhece cálculo de CMC não concluído', () => {
  assert.equal(ehCmcPendente('ERROR: O cálculo do saldo de estoque e CMC do produto ainda não foi concluído para o local X'), true)
  assert.equal(ehCmcPendente('ERROR: outra'), false)
})

test('disjuntor: bloqueia por app_key até expirar', () => {
  registrarBloqueio('k1', 100, 1_000_000)
  assert.equal(msRestantesBloqueio('k1', 1_000_000), 100_000)
  assert.equal(msRestantesBloqueio('k2', 1_000_000), 0)
  assert.equal(msRestantesBloqueio('k1', 1_000_000 + 100_001), 0)
})
