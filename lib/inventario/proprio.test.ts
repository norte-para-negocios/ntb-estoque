import test from 'node:test'
import assert from 'node:assert/strict'
import { exigeMotivo } from './proprio-regras.ts'

test('diferença pequena não exige motivo', () => assert.equal(exigeMotivo(-2, 5, 50, null), false))
test('diferença acima do limite exige motivo', () => assert.equal(exigeMotivo(-20, 5, 50, null), true))
test('com motivo informado libera', () => assert.equal(exigeMotivo(-20, 5, 50, 'quebra'), false))
test('exatamente no limite não exige', () => assert.equal(exigeMotivo(-10, 5, 50, ''), false))
test('custo zero nunca exige motivo', () => assert.equal(exigeMotivo(-100, 0, 50, ''), false))
