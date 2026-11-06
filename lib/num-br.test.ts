import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatNumBR, lerNumeroBR, parseNumBR } from './num-br.ts'

// Decisão do dono e do Ramon (05/11/2026): no que a pessoa digita no ESTOQUE PRÓPRIO, ponto é só separador de milhar e
// vírgula é decimal ({ milhar: true }). Loja Omie não muda: sem a opção vale a regra antiga ("1.500" = 1,5).
const M = { milhar: true }

test('exemplos da decisão: ponto = milhar, vírgula = decimal', () => {
  assert.equal(parseNumBR('1.500', M), 1500)
  assert.equal(parseNumBR('1.234,5', M), 1234.5)
  assert.equal(parseNumBR('1,5', M), 1.5)
  assert.equal(parseNumBR('1500', M), 1500)
})

test('milhar com vários grupos, negativo, espaços e vírgula solta enquanto digita', () => {
  assert.equal(parseNumBR('1.234.567,89', M), 1234567.89)
  assert.equal(parseNumBR('-1.500', M), -1500)
  assert.equal(parseNumBR(' 2,25 ', M), 2.25)
  assert.equal(parseNumBR('3,', M), 3)
  assert.equal(parseNumBR(',5', M), 0.5)
  assert.equal(parseNumBR('0,0139203299', M), 0.0139203299)
})

test('vazio continua null', () => {
  assert.equal(parseNumBR('', M), null)
  assert.equal(parseNumBR('   ', M), null)
})

test('ponto que não pode ser milhar (casas != 3 ou começa com 0) segue decimal: valor de máquina como "3.400000"', () => {
  assert.equal(parseNumBR('3.400000', M), 3.4)
  assert.equal(parseNumBR('1.5', M), 1.5)
  assert.equal(parseNumBR('0.125', M), 0.125)
})

test('formato quebrado é NaN (nunca vira outro número em silêncio)', () => {
  for (const s of ['1,234.5', '1.23,4', '1.2.3', '12.34.567', 'abc', '1,2,3', '1e3', '1.500.5', '--1']) {
    assert.ok(Number.isNaN(parseNumBR(s, M)), s)
  }
})

test('lerNumeroBR: número passa direto; texto segue a mesma regra; vazio/nulo = null', () => {
  assert.equal(lerNumeroBR(12.5, M), 12.5)
  assert.equal(lerNumeroBR('1.500', M), 1500)
  assert.equal(lerNumeroBR('1.234,5', M), 1234.5)
  assert.equal(lerNumeroBR(null, M), null)
  assert.equal(lerNumeroBR(undefined, M), null)
  assert.equal(lerNumeroBR('', M), null)
  assert.ok(Number.isNaN(lerNumeroBR('1,234.5', M)))
  assert.ok(Number.isNaN(lerNumeroBR(Number.NaN, M)))
})

test('ida e volta: formatNumBR → parseNumBR devolve o mesmo número', () => {
  for (const n of [0, 1, 1.5, 1500, 1500.25, 0.125, 1234567.891, 0.0139203299]) {
    assert.equal(parseNumBR(formatNumBR(n), M), n, String(n))
  }
})

test('loja Omie (sem milhar): regra antiga, exatamente como antes', () => {
  assert.equal(parseNumBR('1.500'), 1.5)
  assert.equal(parseNumBR('1.234,5'), 1234.5)
  assert.equal(parseNumBR('1,5'), 1.5)
  assert.equal(parseNumBR('1500'), 1500)
  assert.equal(parseNumBR('3.400000'), 3.4)
  assert.equal(parseNumBR(''), null)
  assert.equal(parseNumBR('1e3'), 1000)
  assert.ok(Number.isNaN(parseNumBR('abc')))
  assert.equal(parseNumBR('1.500', { milhar: false }), 1.5)
  assert.equal(lerNumeroBR('1.500'), 1.5)
  assert.equal(lerNumeroBR(2.5), 2.5)
})

test('o mesmo texto nos dois modos', () => {
  for (const [t, omie, proprio] of [['1.500', 1.5, 1500], ['1.234,5', 1234.5, 1234.5], ['1,5', 1.5, 1.5], ['1500', 1500, 1500]] as const) {
    assert.equal(parseNumBR(t), omie, `omie ${t}`)
    assert.equal(parseNumBR(t, M), proprio, `proprio ${t}`)
  }
})
