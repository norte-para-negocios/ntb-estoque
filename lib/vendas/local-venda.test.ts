import { test } from 'node:test'
import assert from 'node:assert/strict'
import { localDaVenda, origemDoAjuste, origemDaVenda } from './local-venda.ts'

const loja = {
  local_estoque_cozinha_codigo: 5906914581,
  local_estoque_bar_codigo: 2354627389,
  local_estoque_por_setor: { pizzaria: 5906914974 },
}

test('produto mapeado vence tudo (embalagem de pizza baixa na PIZZA sem mexer na impressão)', () => {
  const l = { ...loja, local_estoque_por_produto: { '90382': 5906914974 } }
  assert.equal(localDaVenda(l, { codigo: '90382', destination: 'kitchen', setor: null }), 5906914974)
  assert.equal(localDaVenda(l, { codigo: '90560', destination: 'bar', setor: null }), 2354627389)
})

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

test('regra 30/09: só é movimento de PDV quando a venda gera nota fiscal', () => {
  assert.equal(origemDoAjuste('PDV', 'PDV'), 'PDV') // venda com nota
  assert.equal(origemDoAjuste('PDV', 'AJU'), 'AJU') // venda sem nota: baixa comum
  assert.equal(origemDoAjuste('PDV', null), 'AJU') // sem informação: baixa comum
  assert.equal(origemDoAjuste('PER', 'AJU'), 'AJU') // ajuste manual continua AJU
})

test('origemDaVenda: com nota = PDV, sem nota ou sem informação = AJU', () => {
  assert.equal(origemDaVenda(true), 'PDV')
  assert.equal(origemDaVenda(false), 'AJU')
  assert.equal(origemDaVenda(undefined), 'AJU')
})
