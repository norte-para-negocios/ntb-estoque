import { test } from 'node:test'
import assert from 'node:assert/strict'
import { engenhariaCardapio, type LinhaVendida } from './engenharia-cardapio-puro.ts'

const l = (rotulo: string, quantidade: number, faturamento: number, cmv: number, o: Partial<LinhaVendida> = {}): LinhaVendida =>
  ({ rotulo, quantidade, faturamento, cmv, itens_sem_baixa: 0, itens_sem_custo: 0, ...o })

test('classifica nos 4 grupos por popularidade (70% da média) e margem por unidade (média ponderada)', () => {
  // total 200 un, 4 pratos → corte de popularidade = 0,7 × 200/4 = 35 un
  // lucro total = (60*20) + (60*5) + (20*30) + (60*... ) → ver contas abaixo
  const r = engenhariaCardapio([
    l('Moqueca', 100, 100 * 50, 100 * 20),   // 100 un, lucro 30/un
    l('Pastel', 60, 60 * 10, 60 * 6),        // 60 un, lucro 4/un
    l('Lagosta', 30, 30 * 120, 30 * 60),     // 30 un, lucro 60/un
    l('Salada', 10, 10 * 15, 10 * 12),       // 10 un, lucro 3/un
  ])
  // lucro total = 3000 + 240 + 1800 + 30 = 5070; margem média = 5070 / 200 = 25,35
  assert.equal(r.corteQuantidade, 35)
  assert.ok(Math.abs(r.corteMargemUnit - 25.35) < 1e-9)
  const cls = Object.fromEntries(r.itens.map((i) => [i.rotulo, i.classe]))
  assert.deepEqual(cls, { Moqueca: 'estrela', Pastel: 'carro_chefe', Lagosta: 'oportunidade', Salada: 'rever' })
  assert.equal(r.itens.find((i) => i.rotulo === 'Lagosta')!.margemUnit, 60)
  assert.equal(r.itens.find((i) => i.rotulo === 'Moqueca')!.participacao, 50)
})

test('taxa de serviço, produto não identificado e linha sem venda ficam fora', () => {
  const r = engenhariaCardapio([
    l('Taxa de serviço 10%', 50, 500, 0),
    l('Produto não identificado', 3, 30, 0),
    l('Devolvido', 0, 0, 0),
    l('Moqueca', 10, 500, 200),
  ])
  assert.deepEqual(r.itens.map((i) => i.rotulo), ['Moqueca'])
  assert.equal(r.semCusto.length, 0)
})

test('prato sem custo nenhum não entra na conta (margem de 100% seria falsa) e vai para a lista à parte', () => {
  const r = engenhariaCardapio([l('Moqueca', 10, 500, 200), l('Suco', 40, 400, 0, { itens_sem_custo: 40 })])
  assert.deepEqual(r.itens.map((i) => i.rotulo), ['Moqueca'])
  assert.deepEqual(r.semCusto.map((i) => i.rotulo), ['Suco'])
  // o corte é calculado só com os pratos que têm custo
  assert.equal(r.corteQuantidade, 7)
})

test('prato com parte das vendas sem custo entra, marcado como custo incompleto', () => {
  const r = engenhariaCardapio([l('Moqueca', 10, 500, 200, { itens_sem_custo: 2 }), l('Pastel', 10, 100, 60)])
  assert.equal(r.itens.find((i) => i.rotulo === 'Moqueca')!.custoIncompleto, true)
  assert.equal(r.itens.find((i) => i.rotulo === 'Pastel')!.custoIncompleto, false)
})

test('lista vazia não quebra', () => {
  const r = engenhariaCardapio([])
  assert.deepEqual(r.itens, [])
  assert.equal(r.corteQuantidade, 0)
  assert.equal(r.corteMargemUnit, 0)
})

test('ordem: dentro do grupo, maior lucro primeiro', () => {
  const r = engenhariaCardapio([l('A', 50, 1000, 500), l('B', 50, 2000, 500), l('C', 1, 10, 9)])
  assert.deepEqual(r.itens.filter((i) => i.classe === 'estrela').map((i) => i.rotulo), ['B'])
  assert.deepEqual(r.itens.map((i) => i.rotulo), ['B', 'A', 'C'])
})
