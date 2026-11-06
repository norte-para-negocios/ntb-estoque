import { test } from 'node:test'
import assert from 'node:assert/strict'
import { alertaDePreco, alertasDaLista, lerLimitePct, LIMITE_PADRAO_PCT, type LinhaPrecoDb } from './variacao-preco-puro.ts'

// T5.4: preço da nota nova × última compra do produto (ou custo médio), alerta acima de X% (padrão 15%, por loja).

const linha = (p: Partial<LinhaPrecoDb>): LinhaPrecoDb => ({
  compra_id: 2, nota_fiscal_id: 50, numero: '123', fornecedor_nome: 'Forn', data_compra: '2026-11-03', status: 'lancada',
  item_id: 7, linha: 1, codigo_produto: 10, descricao: 'Tomate', quantidade_base: '5', preco_base: '2.4', preco_anterior: '2',
  data_anterior: '2026-11-01', compra_anterior: 1, fonte_anterior: 'compra', variacao_pct: '20', ...p,
})

test('limite por loja: número válido em (0, 1000]; senão 15%', () => {
  assert.equal(LIMITE_PADRAO_PCT, 15)
  assert.equal(lerLimitePct('12,5'), 12.5)
  assert.equal(lerLimitePct(20), 20)
  assert.equal(lerLimitePct(null), 15)
  assert.equal(lerLimitePct('0'), null)
  assert.equal(lerLimitePct('abc'), null)
  assert.equal(lerLimitePct('2000'), null)
})

test('alerta só quando a variação passa do limite, subindo ou caindo', () => {
  assert.equal(alertaDePreco(linha({ variacao_pct: '15' }), 15), null)
  const a = alertaDePreco(linha({}), 15)!
  assert.equal(a.sentido, 'subiu')
  assert.equal(a.pct, 20)
  assert.equal(a.texto, 'Preço 20% acima da última compra (R$ 2,40 por unidade; antes R$ 2,00 em 01/11/2026)')
  const b = alertaDePreco(linha({ preco_base: '1', variacao_pct: '-50' }), 15)!
  assert.equal(b.sentido, 'caiu')
  assert.match(b.texto, /^Preço 50% abaixo da última compra/)
})

test('sem compra anterior compara com o custo médio; sem nada, sem alerta', () => {
  const c = alertaDePreco(linha({ fonte_anterior: 'cmc', data_anterior: null, compra_anterior: null, preco_anterior: '1.5', preco_base: '2', variacao_pct: '33.33' }), 15)!
  assert.equal(c.texto, 'Preço 33,3% acima do custo médio (R$ 2,00 por unidade; custo médio R$ 1,50)')
  assert.equal(alertaDePreco(linha({ fonte_anterior: null, preco_anterior: null, variacao_pct: null }), 15), null)
})

test('lista: só alertas, maior variação primeiro', () => {
  const l = alertasDaLista([
    linha({ item_id: 1, variacao_pct: '16' }), linha({ item_id: 2, variacao_pct: '-40', preco_base: '1.2' }),
    linha({ item_id: 3, variacao_pct: '3' }), linha({ item_id: 4, variacao_pct: null, fonte_anterior: null }),
  ], 15)
  assert.deepEqual(l.map((x) => x.itemId), [2, 1])
})
