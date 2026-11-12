import test from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error: o node --test (type stripping) exige a extensão .ts; o tsc do Next não a aceita
import { moduloDaAcao, barraAcao } from './acoes-modulo.ts'

test('módulo de cada arquivo de ação', () => {
  assert.equal(moduloDaAcao('cozinha-eventos'), 'cozinha')
  assert.equal(moduloDaAcao('custo-cardapio'), 'cozinha')
  assert.equal(moduloDaAcao('usuario'), null)
  assert.equal(moduloDaAcao('plataforma-assinaturas'), null)
  assert.equal(moduloDaAcao('loja-selector'), null)
  assert.equal(moduloDaAcao('auth'), null)
  for (const f of ['convite', 'onboarding-loja', 'integracao-ntb-vendas', 'sync-status', 'central', 'central-numeros']) assert.equal(moduloDaAcao(f), null)
  assert.equal(moduloDaAcao('estoque-omie'), 'erp')
})
test('leitura passa em suspenso', () => {
  assert.equal(barraAcao('consulta', 'leitura'), false)
  assert.equal(barraAcao('consulta', 'fila'), true)
  assert.equal(barraAcao('vitrine', 'leitura'), true)
  assert.equal(barraAcao('abre', 'fila'), false)
})
test('leitura extra passa em suspenso', () => {
  assert.equal(barraAcao('consulta', 'fila', 'estrutura#verEstrutura'), false)
  assert.equal(barraAcao('consulta', 'fila', 'estrutura#outra'), true)
  assert.equal(barraAcao('vitrine', 'fila', 'estrutura#verEstrutura'), true)
})
