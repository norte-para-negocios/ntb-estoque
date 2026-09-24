import { test } from 'node:test'
import assert from 'node:assert/strict'
import { segundosBloqueio, idAjusteExistente, ehCmcPendente, registrarBloqueio, msRestantesBloqueio, decidirErroItemInventario } from './erros-omie.ts'

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

test('decidirErroItemInventario: ajuste já existente vira Concluido com o ID', () => {
  const r = decidirErroItemInventario('ERROR: Já existe um ajuste de estoque para o código de integração [ITEM1] com o ID [42] para o produto', undefined, 7)
  assert.deepEqual(r, { status: 'Concluido', id_ajuste: 42, tentativas: 0, descricao_status: 'Ajuste já existia no Omie (ID recuperado)' })
})

test('decidirErroItemInventario: CMC pendente vira Sem CMC e conta tentativa', () => {
  const r = decidirErroItemInventario('ERROR: O cálculo do saldo de estoque e CMC do produto ainda não foi concluído para o local', undefined, 2)
  assert.equal(r.status, 'Sem CMC')
  assert.equal(r.tentativas, 3)
})

test('decidirErroItemInventario: bloqueio não queima tentativa', () => {
  assert.equal(decidirErroItemInventario('qualquer', 'BLOQUEIO_LOCAL', 5).tentativas, 5)
  const r = decidirErroItemInventario('ERROR: API bloqueada por consumo indevido. Tente novamente em 10 segundos.', undefined, 5)
  assert.equal(r.status, 'Erro')
  assert.equal(r.tentativas, 5)
})

test('decidirErroItemInventario: erro genérico vira Erro e conta tentativa', () => {
  const r = decidirErroItemInventario('ERROR: produto inativo', undefined, null)
  assert.deepEqual(r, { status: 'Erro', id_ajuste: null, tentativas: 1, descricao_status: 'ERROR: produto inativo' })
})
