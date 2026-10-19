import { test } from 'node:test'
import assert from 'node:assert/strict'
import { explodirEstrutura, type ItemFicha } from './estrutura-puro.ts'

const it = (insumo: number, quantidade: number, perda = 0, unidade: string | null = 'KG'): ItemFicha => ({ insumo, quantidade, perda, unidade })

// Captura do Omie (ERP_ESTRUTURA_TODOS, loja 5, 17/10/2026): prato com o vinagrete (PI 70011) dentro.
// Vinagrete por KG: cebola 0,145278 (perda 10), coentro 0,072639 (perda 20). No prato: vinagrete 0,053333 →
// cebola 0,053333 × 0,145278 = 0,007748 e coentro 0,003874 (a perda só é informada, não multiplica).
const fichas = new Map<number, ItemFicha[]>([
  [1, [it(80225, 0.333333), it(70011, 0.053333), it(80052, 0.013167)]],
  [70011, [it(80031, 0.145278, 10), it(80035, 0.072639, 20)]],
])

test('explode o produto intermediário logo depois dele, com a quantidade multiplicada e ordem sequencial', () => {
  const r = explodirEstrutura(fichas, 1)
  assert.deepEqual(r.map((l) => [l.ordem, l.nivel, l.caminho, l.insumo]), [
    [1, 1, '1', 80225], [2, 1, '2', 70011], [3, 2, '2.1', 80031], [4, 2, '2.2', 80035], [5, 1, '3', 80052],
  ])
  assert.equal(r[1].temFicha, true)
  assert.equal(r[2].quantidade, 0.007748)
  assert.equal(r[3].quantidade, 0.003874)
  assert.equal(r[3].perda, 20)
  assert.equal(r[3].quantidadePai, 0.053333)
})

test('ciclo (A usa B, B usa A) para e marca, sem repetir', () => {
  const c = new Map<number, ItemFicha[]>([[10, [it(20, 2)]], [20, [it(10, 3), it(30, 1)]]])
  const r = explodirEstrutura(c, 10)
  assert.deepEqual(r.map((l) => [l.caminho, l.insumo, l.ciclo]), [['1', 20, false], ['1.1', 10, true], ['1.2', 30, false]])
  assert.equal(r[1].quantidade, 6)
})

test('limite de níveis e ficha vazia', () => {
  const funda = new Map<number, ItemFicha[]>([[1, [it(2, 1)]], [2, [it(3, 1)]], [3, [it(4, 1)]]])
  assert.equal(explodirEstrutura(funda, 1, 2).length, 2)
  assert.deepEqual(explodirEstrutura(new Map(), 1), [])
})
