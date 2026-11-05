import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ehProdutoServico, resultadoServico } from './servico-venda.ts'

test('serviço = tipo_item 09 (mesma regra do modo próprio)', () => {
  assert.equal(ehProdutoServico('09'), true)
  assert.equal(ehProdutoServico(' 09 '), true)
  assert.equal(ehProdutoServico('99'), false)
  assert.equal(ehProdutoServico('00'), false)
  assert.equal(ehProdutoServico(null), false)
  assert.equal(ehProdutoServico(undefined), false)
})

test('serviço responde ok, sem OP e sem saída (contrato que o Vendas entende como ok)', () => {
  const r = resultadoServico('90656')
  assert.equal(r.codigo, '90656')
  assert.equal(r.ok, true)
  assert.equal(r.op, 'sem_estrutura')
  assert.equal(r.nCodOP, undefined)
  // != 'sem local de estoque' (o Vendas trata esse como erro retentável)
  assert.notEqual(r.baixa, 'sem local de estoque')
  assert.match(r.baixa, /servi/i)
})
