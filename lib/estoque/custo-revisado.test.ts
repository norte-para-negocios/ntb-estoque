import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rotuloCustoRevisado } from './custo-revisado.ts'

test('custo revisado: data no fuso da Bahia, dd/mm', () => {
  assert.equal(rotuloCustoRevisado(true, '2026-11-04T04:30:00+00:00'), 'custo revisado em 04/11')
  // 02:00 UTC de 05/11 ainda é 04/11 na Bahia
  assert.equal(rotuloCustoRevisado(true, '2026-11-05T02:00:00Z'), 'custo revisado em 04/11')
})
test('sem revisão não mostra nada; revisão sem data mostra só o aviso', () => {
  assert.equal(rotuloCustoRevisado(false, '2026-11-04T04:30:00Z'), null)
  assert.equal(rotuloCustoRevisado(undefined, undefined), null)
  assert.equal(rotuloCustoRevisado(true, null), 'custo revisado')
  assert.equal(rotuloCustoRevisado(true, 'lixo'), 'custo revisado')
})
