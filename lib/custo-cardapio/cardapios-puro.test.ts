import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contaDoItem, custoNoCanal, lerPreco, moverNaLista, resumoDoCardapio, type ItemCalculo } from './cardapios-puro.ts'
import type { Taxas } from './preco-puro.ts'

const t: Taxas = { metaCmv: 0.3, impostoPct: 0.06, taxaCartaoPct: 0.03, taxaDeliveryPct: 0.27, embalagem: 1.5 }
const perto = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`)
const item = (o: Partial<ItemCalculo>): ItemCalculo => ({ custo: 9, semCusto: 0, suspeitos: 0, precoCadastro: 30, precoProprio: null, ...o })

test('salão: preço do cadastro, CMV = custo ÷ preço, sugerido ,90', () => {
  const c = contaDoItem(item({}), 'salao', t)
  assert.equal(c.fontePreco, 'cadastro'); perto(c.cmv as number, 0.3); assert.equal(c.situacao, 'ok'); perto(c.sugerido, 30.9)
  perto(c.sobra as number, 30 * 0.91 - 9)
})

test('preço próprio do cardápio vence o do cadastro; R$ 0,01 não é preço', () => {
  const c = contaDoItem(item({ precoProprio: 25 }), 'salao', t)
  assert.equal(c.fontePreco, 'proprio'); perto(c.cmv as number, 9 / 25); assert.equal(c.situacao, 'acima')
  const s = contaDoItem(item({ precoCadastro: 0.01 }), 'salao', t)
  assert.equal(s.situacao, 'sem_preco'); assert.equal(s.preco, null); assert.equal(s.fontePreco, 'nenhum')
})

test('delivery: no preço sugerido o CMV dá exatamente a meta', () => {
  const sug = (9 + 1.5) / (0.3 * 0.64)
  const c = contaDoItem(item({ precoProprio: sug }), 'delivery', t)
  perto(c.cmv as number, 0.3); assert.equal(c.situacao, 'ok')
  perto(c.sobra as number, sug * 0.64 - 9 - 1.5)
  perto(custoNoCanal(9, 'delivery', t), 10.5 / 0.64)
  // Preço de salão no delivery fica acima da meta
  assert.equal(contaDoItem(item({}), 'delivery', t).situacao, 'acima')
})

test('resumo: CMV ponderado, mediana, melhor/pior e o que repreçar', () => {
  const itens = [item({ precoCadastro: 30 }), item({ precoCadastro: 20 }), item({ precoCadastro: 45 }), item({ precoCadastro: null }), item({ custo: 0, semCusto: 2 })]
  const contas = itens.map((i) => ({ conta: contaDoItem(i, 'salao', t), custo: i.custo }))
  const r = resumoDoCardapio(contas, 'salao', t)
  perto(r.cmvCardapio as number, 27 / 95)
  perto(r.cmvTipico as number, 0.3)
  assert.equal(r.melhor, 2); assert.equal(r.pior, 1)
  assert.equal(r.acima, 1); assert.equal(r.semPreco, 1); assert.equal(r.aConferir, 1)
  assert.deepEqual(r.reprecar, [1])
})

test('resumo vazio', () => {
  const r = resumoDoCardapio([], 'salao', t)
  assert.equal(r.cmvCardapio, null); assert.equal(r.melhor, null); assert.equal(r.pior, null)
})

test('lê preço digitado', () => {
  assert.equal(lerPreco(''), null)
  assert.equal(lerPreco('12,90'), 12.9)
  assert.equal(lerPreco('1.234,50'), 1234.5)
  assert.equal(lerPreco('R$ 12.9'), 12.9)
  assert.ok(Number.isNaN(lerPreco('abc')))
})

test('move item na lista', () => {
  assert.deepEqual(moverNaLista([1, 2, 3], 2, 'cima'), [2, 1, 3])
  assert.deepEqual(moverNaLista([1, 2, 3], 2, 'baixo'), [1, 3, 2])
  assert.equal(moverNaLista([1, 2, 3], 1, 'cima'), null)
  assert.equal(moverNaLista([1, 2, 3], 3, 'baixo'), null)
  assert.equal(moverNaLista([1, 2, 3], 9, 'cima'), null)
})

test('porções: CMV do conjunto, margem, ROI e participação ponderados pelas porções', async () => {
  const { participacaoNoCusto, lerPorcoes } = await import('./cardapios-puro.ts')
  const a = { conta: contaDoItem(item({ custo: 10, precoCadastro: 40 }), 'salao', t), custo: 10, porcoes: 2 }
  const b = { conta: contaDoItem(item({ custo: 6, precoCadastro: 30 }), 'salao', t), custo: 6, porcoes: 1 }
  const r = resumoDoCardapio([a, b], 'salao', t)
  perto(r.custoTotal, 26); perto(r.vendaTotal, 110); perto(r.cmvCardapio as number, 26 / 110)
  perto(r.margem as number, 84); perto(r.margemPct as number, 84 / 110); perto(r.roi as number, 84 / 26)
  perto(r.sobraTotal as number, 2 * (40 * 0.91 - 10) + (30 * 0.91 - 6))
  const p = participacaoNoCusto([{ custo: 10, porcoes: 2 }, { custo: 6, porcoes: 1 }, { custo: 50, semFicha: true }])
  perto(p[0], 20 / 26); perto(p[1], 6 / 26); assert.equal(p[2], 0)
  assert.equal(lerPorcoes('1,5'), 1.5); assert.equal(lerPorcoes('0'), null); assert.equal(lerPorcoes('abc'), null); assert.equal(lerPorcoes('1001'), null)
  // sem porções, o resumo de antes não muda
  perto(resumoDoCardapio([{ conta: a.conta, custo: 10 }, { conta: b.conta, custo: 6 }], 'salao', t).cmvCardapio as number, 16 / 70)
})
