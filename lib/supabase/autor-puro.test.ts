import { test } from 'node:test'
import assert from 'node:assert/strict'
import { metodoEscreve } from './autor-puro.ts'

test('metodoEscreve: só escrita leva o autor', () => {
  assert.equal(metodoEscreve(undefined), false)
  assert.equal(metodoEscreve('get'), false)
  assert.equal(metodoEscreve('HEAD'), false)
  assert.equal(metodoEscreve('OPTIONS'), false)
  for (const m of ['POST', 'patch', 'PUT', 'DELETE']) assert.equal(metodoEscreve(m), true)
})
