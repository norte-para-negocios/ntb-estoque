import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pedidoDaRef, urlVendaNoVendas, URL_VENDAS_PADRAO } from './link-vendas.ts'

const id = 'e4d655ad-99d7-4ead-a981-3b5fdfca4339'
test('pedido da ref simples e da ref de receita', () => {
  assert.equal(pedidoDaRef(id), id)
  assert.equal(pedidoDaRef(`${id}|8000000000032|0`), id)
  assert.equal(pedidoDaRef('teste-odara-1'), null)
  assert.equal(pedidoDaRef(null), null)
})
test('url da venda no Vendas', () => {
  assert.equal(urlVendaNoVendas(id, 'https://x.com/'), `https://x.com/loja?venda=${id}`)
  assert.equal(urlVendaNoVendas(`${id}|1|0`, ''), `${URL_VENDAS_PADRAO}/loja?venda=${id}`)
  assert.equal(urlVendaNoVendas('sem-ref:1', 'https://x.com'), null)
})
