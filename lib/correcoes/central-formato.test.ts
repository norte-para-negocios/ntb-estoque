import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fmtQtd, fmtBRL, fmtBRLCurto, fmtData, hashCurto, b36 } from './central-puro.ts'

test('formatos', () => {
  assert.equal(fmtQtd(-11, 'UN'), '−11 un')
  assert.equal(fmtQtd(64.89, 'KG'), '64,89 kg')
  assert.equal(fmtQtd(1.5, 'G'), '1,5 g')
  assert.equal(fmtQtd(4658, 'KG'), '4.658 kg')
  assert.equal(fmtQtd(null, 'UN'), '—')
  assert.equal(fmtBRL(1589.01), 'R$ 1.589,01')
  assert.equal(fmtBRL(-3), '−R$ 3,00')
  assert.equal(fmtBRLCurto(139200), 'R$ 139,2 mil')
  assert.equal(fmtBRLCurto(1_250_000), 'R$ 1,3 mi')
  assert.equal(fmtBRLCurto(851), 'R$ 851')
  assert.equal(fmtBRLCurto(58.08), 'R$ 58,08')
  assert.equal(fmtData('2026-10-08'), '08/10')
  assert.equal(fmtData(null), '—')
  assert.equal(b36(35), 'z')
  assert.equal(hashCurto('a').length, 13)
  assert.equal(hashCurto('x'), hashCurto('x'))
  assert.notEqual(hashCurto('x'), hashCurto('y'))
})
