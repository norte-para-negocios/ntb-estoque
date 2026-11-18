import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nomesUnicos } from './nomes-unicos-puro.ts'

test('F-14: nome de família repetido aparece uma vez só, na ordem em que veio', () => {
  assert.deepEqual(nomesUnicos(['Bebidas', 'Cozinha', 'Bebidas', ' Cozinha ', 'Limpeza']), ['Bebidas', 'Cozinha', 'Limpeza'])
})

test('F-14: vazio e nulo saem', () => {
  assert.deepEqual(nomesUnicos(['', null, undefined, '  ', 'A']), ['A'])
})
