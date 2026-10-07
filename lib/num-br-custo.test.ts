import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatCustoUnit } from './num-br.ts'

const limpo = (s: string) => s.replace(/ /g, ' ')

test('custo unitário: 2 casas a partir de R$ 0,10', () => {
  assert.equal(limpo(formatCustoUnit(12.5)), 'R$ 12,50')
  assert.equal(limpo(formatCustoUnit(0.1)), 'R$ 0,10')
})

test('custo unitário: frações de centavo não viram R$ 0,01', () => {
  assert.equal(limpo(formatCustoUnit(0.006224)), 'R$ 0,00622')
  assert.equal(limpo(formatCustoUnit(0.01128)), 'R$ 0,0113')
  assert.equal(limpo(formatCustoUnit(0.0000123)), 'R$ 0,000012')
  assert.equal(limpo(formatCustoUnit('0.045')), 'R$ 0,045')
})

test('custo unitário: unidade, zero e vazio', () => {
  assert.equal(limpo(formatCustoUnit(0.006224, 'G')), 'R$ 0,00622/g')
  assert.equal(limpo(formatCustoUnit(0)), 'R$ 0,00')
  assert.equal(formatCustoUnit(null), '-')
  assert.equal(formatCustoUnit('abc'), '-')
})
