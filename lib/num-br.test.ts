import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatNumBR, lerNumeroBR, parseNumBR } from './num-br.ts'

// Decisão do dono e do Ramon (05/11/2026): no que a pessoa digita, ponto é só separador de milhar e vírgula é decimal.

test('exemplos da decisão: ponto = milhar, vírgula = decimal', () => {
  assert.equal(parseNumBR('1.500'), 1500)
  assert.equal(parseNumBR('1.234,5'), 1234.5)
  assert.equal(parseNumBR('1,5'), 1.5)
  assert.equal(parseNumBR('1500'), 1500)
})

test('milhar com vários grupos, negativo, espaços e vírgula solta enquanto digita', () => {
  assert.equal(parseNumBR('1.234.567,89'), 1234567.89)
  assert.equal(parseNumBR('-1.500'), -1500)
  assert.equal(parseNumBR(' 2,25 '), 2.25)
  assert.equal(parseNumBR('3,'), 3)
  assert.equal(parseNumBR(',5'), 0.5)
  assert.equal(parseNumBR('0,0139203299'), 0.0139203299)
})

test('vazio continua null', () => {
  assert.equal(parseNumBR(''), null)
  assert.equal(parseNumBR('   '), null)
})

test('ponto que não pode ser milhar (casas != 3 ou começa com 0) segue decimal: valor de máquina como "3.400000"', () => {
  assert.equal(parseNumBR('3.400000'), 3.4)
  assert.equal(parseNumBR('1.5'), 1.5)
  assert.equal(parseNumBR('0.125'), 0.125)
})

test('formato quebrado é NaN (nunca vira outro número em silêncio)', () => {
  for (const s of ['1,234.5', '1.23,4', '1.2.3', '12.34.567', 'abc', '1,2,3', '1e3', '1.500.5', '--1']) {
    assert.ok(Number.isNaN(parseNumBR(s)), s)
  }
})

test('lerNumeroBR: número passa direto; texto segue a mesma regra; vazio/nulo = null', () => {
  assert.equal(lerNumeroBR(12.5), 12.5)
  assert.equal(lerNumeroBR('1.500'), 1500)
  assert.equal(lerNumeroBR('1.234,5'), 1234.5)
  assert.equal(lerNumeroBR(null), null)
  assert.equal(lerNumeroBR(undefined), null)
  assert.equal(lerNumeroBR(''), null)
  assert.ok(Number.isNaN(lerNumeroBR('1,234.5')))
  assert.ok(Number.isNaN(lerNumeroBR(Number.NaN)))
})

test('ida e volta: formatNumBR → parseNumBR devolve o mesmo número', () => {
  for (const n of [0, 1, 1.5, 1500, 1500.25, 0.125, 1234567.891, 0.0139203299]) {
    assert.equal(parseNumBR(formatNumBR(n)), n, String(n))
  }
})
