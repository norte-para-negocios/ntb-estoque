import { test } from 'node:test'
import assert from 'node:assert/strict'
import { avisosLotesVencidos, avisosInsumosSemCusto } from './avisos-baixa-puro.ts'

// Decisões do dono e do Ramon (05/11/2026): lote vencido na baixa (FEFO) e OP com insumo sem custo NÃO bloqueiam, só avisam.

test('lote vencido consumido vira aviso "lote X vencido em dd/mm consumido"', () => {
  const a = avisosLotesVencidos([
    { lote: 'L77', validade: '2026-11-03', quantidade: -2, produto: 'Creme de leite', unidade: 'UN', dataBaixa: '2026-11-05' },
  ])
  assert.deepEqual(a, ['Creme de leite: lote L77 vencido em 03/11 consumido (2 UN).'])
})

test('lote que vence no próprio dia da baixa, ainda válido ou sem validade não avisa', () => {
  assert.deepEqual(avisosLotesVencidos([
    { lote: 'A', validade: '2026-11-05', quantidade: -1, produto: 'X', unidade: null, dataBaixa: '2026-11-05' },
    { lote: 'B', validade: '2026-12-01', quantidade: -1, produto: 'X', unidade: null, dataBaixa: '2026-11-05' },
    { lote: null, validade: null, quantidade: -1, produto: 'X', unidade: null, dataBaixa: '2026-11-05' },
  ]), [])
})

test('lote sem número e entrada (quantidade positiva) de estorno', () => {
  assert.deepEqual(avisosLotesVencidos([
    { lote: null, validade: '2026-10-30', quantidade: -0.5, produto: 'Leite', unidade: 'L', dataBaixa: '2026-11-05' },
    { lote: 'Z', validade: '2026-10-30', quantidade: 3, produto: 'Leite', unidade: 'L', dataBaixa: '2026-11-05' },
  ]), ['Leite: lote sem número vencido em 30/10 consumido (0,5 L).'])
})

test('o mesmo lote em duas linhas soma num aviso só', () => {
  assert.deepEqual(avisosLotesVencidos([
    { lote: 'L1', validade: '2026-11-01', quantidade: -1, produto: 'Ovo', unidade: 'UN', dataBaixa: '2026-11-05' },
    { lote: 'L1', validade: '2026-11-01', quantidade: -2, produto: 'Ovo', unidade: 'UN', dataBaixa: '2026-11-05' },
  ]), ['Ovo: lote L1 vencido em 01/11 consumido (3 UN).'])
})

test('insumo com custo 0 ou estimado aparece; insumo com custo médio normal não', () => {
  const a = avisosInsumosSemCusto([
    { produto: 'Sal', custoUnitario: 0, estimado: true },
    { produto: 'Azeite', custoUnitario: 0.0421, estimado: true },
    { produto: 'Farinha', custoUnitario: 5, estimado: false },
  ])
  assert.deepEqual(a, [
    'Insumo saiu com custo 0 (sem nenhum custo conhecido): Sal. Lance uma entrada com custo para corrigir.',
    'Insumo saiu com custo estimado (último custo conhecido, sem custo médio): Azeite.',
  ])
})

test('vários insumos no mesmo aviso e nenhum = lista vazia', () => {
  assert.deepEqual(avisosInsumosSemCusto([
    { produto: 'Sal', custoUnitario: 0, estimado: false }, { produto: 'Açúcar', custoUnitario: null, estimado: false },
  ]), ['Insumo saiu com custo 0 (sem nenhum custo conhecido): Sal, Açúcar. Lance uma entrada com custo para corrigir.'])
  assert.deepEqual(avisosInsumosSemCusto([]), [])
})
