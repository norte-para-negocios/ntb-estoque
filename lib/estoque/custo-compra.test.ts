import { test } from 'node:test'
import assert from 'node:assert/strict'
import { custoUnitarioBase } from './custo-compra.ts'

const itens = [
  { valorTotal: 200, desconto: 0, quantidade: 2, fator: 20 },
  { valorTotal: 100, desconto: 0, quantidade: 1, fator: 12 },
  { valorTotal: 50, desconto: 0, quantidade: 1, fator: 1000 },
]

test('frete rateado por valor líquido (mesmo caso do teste SQL da migration 135)', () => {
  assert.equal(custoUnitarioBase(itens[0], itens, 30, 0), 5.428571)
  assert.equal(custoUnitarioBase(itens[1], itens, 30, 0), Math.round(((100 + (30 * 100) / 350) / 12) * 1e6) / 1e6)
})

test('desconto da nota baixa o custo; ICMS só abate quando recuperável', () => {
  const it = [{ valorTotal: 100, desconto: 0, quantidade: 10, fator: 1, icms: 18 }]
  assert.equal(custoUnitarioBase(it[0], it, 0, 10), 9)
  assert.equal(custoUnitarioBase(it[0], it, 0, 0, false), 10)
  assert.equal(custoUnitarioBase(it[0], it, 0, 0, true), 8.2)
})

test('quantidade zero não gera custo', () => {
  assert.equal(custoUnitarioBase({ valorTotal: 10, desconto: 0, quantidade: 0, fator: 1 }, [], 0, 0), null)
})

test('nota com valor zero divide o frete por igual', () => {
  const it = [{ valorTotal: 0, desconto: 0, quantidade: 1, fator: 1 }, { valorTotal: 0, desconto: 0, quantidade: 1, fator: 1 }]
  assert.equal(custoUnitarioBase(it[0], it, 10, 0), 5)
})
