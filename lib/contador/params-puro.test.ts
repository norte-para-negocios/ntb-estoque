import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore: import com .ts exigido pelo node --test
import { lerParamsPacote } from './params-puro.ts'

test('lerParamsPacote: padrão = mês passado e último dia dele', () => {
  assert.deepEqual(lerParamsPacote({}, '2026-10-19'), { mes: '2026-09', data: '2026-09-30' })
  assert.deepEqual(lerParamsPacote({}, '2026-01-05'), { mes: '2025-12', data: '2025-12-31' })
  assert.deepEqual(lerParamsPacote({ mes: '2026-02' }, '2026-10-19'), { mes: '2026-02', data: '2026-02-28' })
  assert.deepEqual(lerParamsPacote({ mes: '2025-12', data: '2025-12-31' }, '2026-10-19'), { mes: '2025-12', data: '2025-12-31' })
})

test('lerParamsPacote recusa mês atual/futuro, lixo, data inexistente e data futura', () => {
  assert.ok('error' in lerParamsPacote({ mes: '2026-10' }, '2026-10-19'))
  assert.ok('error' in lerParamsPacote({ mes: '2026-13' }, '2026-10-19'))
  assert.ok('error' in lerParamsPacote({ mes: 'x' }, '2026-10-19'))
  assert.ok('error' in lerParamsPacote({ mes: '2026-09', data: '2026-11-01' }, '2026-10-19'))
  assert.ok('error' in lerParamsPacote({ mes: '2026-09', data: '2026-09-31' }, '2026-10-19'))
  assert.ok('error' in lerParamsPacote({ mes: '2026-09', data: '30/09/2026' }, '2026-10-19'))
})
