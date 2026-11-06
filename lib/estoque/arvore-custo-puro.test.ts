import { test } from 'node:test'
import assert from 'node:assert/strict'
import { arvoreCustoFicha, cicloNaFicha, type FichaArvore } from './arvore-custo-puro.ts'

const item = (codigoInsumo: number, quantidadeLiquida: number, fatorCorrecao = 1, perdaPct = 0) => ({ codigoInsumo, quantidadeLiquida, fatorCorrecao, perdaPct })
const MOQUECA = 1, PEIXE = 2, COCO = 3, MOLHO = 4, TOMATE = 5, CEBOLA = 6

const fichas = () =>
  new Map<number, FichaArvore>([
    // molho: rende 1000 g com 600 g de tomate (FC 1,25, perda 5%) e 200 g de cebola
    [MOLHO, { codigoProduto: MOLHO, versao: 3, rendimento: 1000, expandirNaVenda: false, itens: [item(TOMATE, 600, 1.25, 5), item(CEBOLA, 200)] }],
    // moqueca: 1 porção com 300 g de peixe, 100 ml de coco e 150 g de molho
    [MOQUECA, { codigoProduto: MOQUECA, versao: 2, rendimento: 1, expandirNaVenda: false, itens: [item(PEIXE, 300), item(COCO, 100), item(MOLHO, 150)] }],
  ])
const cmc = new Map<number, number | null>([[PEIXE, 0.05], [COCO, 0.02], [TOMATE, 0.01], [CEBOLA, 0.008], [MOLHO, 0.02]])

test('árvore: prato → PI → insumos, PI pelo custo da ficha dele', () => {
  const a = arvoreCustoFicha(fichas(), cmc, MOQUECA, 1)!
  assert.equal(a.versao, 2)
  assert.deepEqual(a.filhos.map((f) => f.codigo), [PEIXE, COCO, MOLHO])
  const molho = a.filhos[2]
  assert.equal(molho.temFicha, true)
  assert.equal(molho.versao, 3)
  // ficha do molho por grama: (787,5 × 0,01 + 200 × 0,008) / 1000 = 0,009475
  assert.equal(molho.custoUnitarioFicha, 0.009475)
  assert.equal(molho.custoUnitarioCmc, 0.02)
  assert.equal(molho.quantidade, 150)
  assert.equal(molho.custo, 1.42125) // 150 × 0,009475
  // insumos do molho para 150 g: tomate 787,5 × 0,15 = 118,125 g; cebola 30 g
  assert.deepEqual(molho.filhos.map((f) => [f.codigo, f.quantidade, f.custo]), [[TOMATE, 118.125, 1.18125], [CEBOLA, 30, 0.24]])
  assert.equal(a.total, 15 + 2 + 1.42125)
  assert.equal(a.semCusto, 0)
})

test('árvore: quantidade multiplica e insumo sem custo conta', () => {
  const c2 = new Map(cmc); c2.set(COCO, null)
  const a = arvoreCustoFicha(fichas(), c2, MOQUECA, 2)!
  assert.equal(a.filhos[0].quantidade, 600)
  assert.equal(a.filhos[1].semCusto, true)
  assert.equal(a.filhos[1].custo, 0)
  assert.equal(a.semCusto, 1)
})

test('árvore: produto sem ficha = null', () => {
  assert.equal(arvoreCustoFicha(fichas(), cmc, PEIXE, 1), null)
})

test('árvore: ciclo já gravado não trava, o nó fica marcado', () => {
  const f = fichas()
  f.set(TOMATE, { codigoProduto: TOMATE, versao: 1, rendimento: 1, expandirNaVenda: false, itens: [item(MOQUECA, 1)] })
  const a = arvoreCustoFicha(f, cmc, MOQUECA, 1)!
  const tomate = a.filhos[2].filhos[0]
  assert.equal(tomate.codigo, TOMATE)
  assert.equal(tomate.filhos[0].codigo, MOQUECA)
  assert.equal(tomate.filhos[0].ciclo, true)
  assert.equal(a.ciclo, true)
})

test('ciclo ao salvar: direto, indireto e sem ciclo', () => {
  assert.deepEqual(cicloNaFicha(fichas(), MOLHO, [MOLHO]), [MOLHO, MOLHO])
  // molho passa a usar a moqueca, que usa o molho
  assert.deepEqual(cicloNaFicha(fichas(), MOLHO, [TOMATE, MOQUECA]), [MOLHO, MOQUECA, MOLHO])
  // tomate passa a usar a moqueca: tomate → moqueca → molho → tomate
  assert.deepEqual(cicloNaFicha(fichas(), TOMATE, [MOQUECA]), [TOMATE, MOQUECA, MOLHO, TOMATE])
  assert.equal(cicloNaFicha(fichas(), MOQUECA, [PEIXE, MOLHO]), null)
  // a ficha que está sendo trocada não conta com os itens antigos
  assert.equal(cicloNaFicha(fichas(), MOLHO, [TOMATE]), null)
})
