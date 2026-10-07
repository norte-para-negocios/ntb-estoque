import { test } from 'node:test'
import assert from 'node:assert/strict'
import { brutaDoItem, custoUnitarioFicha, expandirReceita, previaProducao, validarFicha, type Ficha } from './receita.ts'

const item = (codigoInsumo: number, quantidadeLiquida: number, fatorCorrecao = 1, perdaPct = 0) => ({ codigoInsumo, quantidadeLiquida, fatorCorrecao, perdaPct })
const PEIXE = 2, COCO = 3, MOLHO = 4, TOMATE = 5, MOQUECA = 1

const fichas = (expandirMolho: boolean) =>
  new Map<number, Ficha>([
    [MOLHO, { codigoProduto: MOLHO, rendimento: 1000, expandirNaVenda: expandirMolho, itens: [item(TOMATE, 600, 1.25, 5)] }],
    [MOQUECA, { codigoProduto: MOQUECA, rendimento: 1, expandirNaVenda: false, itens: [item(PEIXE, 300), item(COCO, 200), item(MOLHO, 100)] }],
  ])
const cmc = new Map([[PEIXE, 0.04], [COCO, 0.01], [TOMATE, 0.008], [MOLHO, 0.0063]])

test('quantidade bruta = líquida × FC × (1 + perda%)', () => {
  assert.equal(brutaDoItem(item(TOMATE, 600, 1.25, 5)), 787.5)
  assert.equal(brutaDoItem(item(PEIXE, 300)), 300)
})

test('sub-receita sem expandir é consumida do estoque como produto pronto', () => {
  const r = expandirReceita(fichas(false), MOQUECA, 2)
  assert.deepEqual(r, [{ codigoInsumo: PEIXE, quantidade: 600 }, { codigoInsumo: COCO, quantidade: 400 }, { codigoInsumo: MOLHO, quantidade: 200 }])
})

test('sub-receita expandida abre até o insumo final e soma por insumo', () => {
  const r = expandirReceita(fichas(true), MOQUECA, 1)
  assert.deepEqual(r.map((x) => x.codigoInsumo), [PEIXE, COCO, TOMATE])
  assert.equal(r.find((x) => x.codigoInsumo === TOMATE)!.quantidade, 78.75) // 100 ml de molho = 0,1 do lote de 787,5 g
})

test('custo ao vivo da moqueca bate com o SQL (expandida)', () => {
  assert.equal(custoUnitarioFicha(fichas(true), cmc, MOQUECA), 14.63) // 300×0,04 + 200×0,01 + 78,75×0,008
  assert.equal(custoUnitarioFicha(fichas(false), cmc, MOQUECA), 14.63) // 12 + 2 + 100×0,0063: o CMC do molho já embute o custo do tomate
  assert.equal(custoUnitarioFicha(fichas(true), cmc, PEIXE), null)
})

test('prévia de produção: 2000 ml de molho consomem 1575 g de tomate e custam 0,0063/ml', () => {
  const p = previaProducao(fichas(false), cmc, MOLHO, 2000)
  assert.deepEqual(p.insumos, [{ codigoInsumo: TOMATE, quantidade: 1575 }])
  assert.equal(p.custoTotal, 12.6)
  assert.equal(p.custoUnitario, 0.0063)
})

test('ciclo é recusado, nunca laço infinito', () => {
  const ciclo = new Map<number, Ficha>([
    [1, { codigoProduto: 1, rendimento: 1, expandirNaVenda: true, itens: [item(2, 1)] }],
    [2, { codigoProduto: 2, rendimento: 1, expandirNaVenda: true, itens: [item(1, 1)] }],
  ])
  assert.throws(() => expandirReceita(ciclo, 1, 1), /circular/)
})

test('validação da ficha: rendimento, vazia, repetido, auto-referência, perda fora da faixa', () => {
  assert.equal(validarFicha(1, 1, [item(2, 1)]).length, 0)
  assert.ok(validarFicha(1, 0, [item(2, 1)]).some((e) => e.campo === 'rendimento'))
  assert.ok(validarFicha(1, 1, []).some((e) => e.campo === 'itens'))
  assert.ok(validarFicha(1, 1, [item(2, 1), item(2, 2)]).some((e) => /repetido/.test(e.mensagem)))
  assert.ok(validarFicha(1, 1, [item(1, 1)]).some((e) => /de si mesmo/.test(e.mensagem)))
  assert.ok(validarFicha(1, 1, [item(2, 1, 1, 120)]).some((e) => /perda/.test(e.mensagem)))
  assert.ok(validarFicha(1, 1, [item(2, 0)]).some((e) => /maior que zero/.test(e.mensagem)))
})
