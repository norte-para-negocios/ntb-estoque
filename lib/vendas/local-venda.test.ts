import { test } from 'node:test'
import assert from 'node:assert/strict'
import { localDaVenda, origemDoAjuste } from './local-venda.ts'

const loja = {
  local_estoque_cozinha_codigo: 5906914581,
  local_estoque_bar_codigo: 2354627389,
  local_estoque_por_setor: { pizzaria: 5906914974 },
}

test('setor mapeado vence o destino (pizza e embalagem de pizza baixam na PIZZA)', () => {
  assert.equal(localDaVenda(loja, { destination: 'kitchen', setor: 'Pizzaria' }), 5906914974)
})

test('nome do setor ignora caixa e acento', () => {
  assert.equal(localDaVenda({ ...loja, local_estoque_por_setor: { 'Pizzaría': 1 } }, { destination: 'kitchen', setor: 'PIZZARIA' }), 1)
})

test('sem setor mapeado cai no destino cozinha/bar', () => {
  assert.equal(localDaVenda(loja, { destination: 'bar', setor: null }), 2354627389)
  assert.equal(localDaVenda(loja, { destination: 'kitchen', setor: 'Churrasqueira' }), 5906914581)
})

test('sem mapeamento nenhum devolve null (quem chama usa o local padrão)', () => {
  assert.equal(localDaVenda({ local_estoque_cozinha_codigo: null, local_estoque_bar_codigo: null, local_estoque_por_setor: null }, { destination: 'kitchen' }), null)
})

test('venda vai como movimento de PDV no Omie; ajuste manual continua AJU', () => {
  assert.equal(origemDoAjuste('PDV'), 'PDV')
  assert.equal(origemDoAjuste('PER'), 'AJU')
  assert.equal(origemDoAjuste(null), 'AJU')
})
