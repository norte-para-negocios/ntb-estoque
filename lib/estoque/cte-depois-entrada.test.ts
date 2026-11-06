import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decidirCteDepoisDaEntrada, avisoCustoRefeito } from './cte-xml.ts'

// Decisão de 05/11/2026: CT-e pode ser ligado depois da entrada (migration 351). Recurso novo: por enquanto só para dev.
test('nota sem entrada: qualquer um com a permissão liga o CT-e', () => {
  assert.equal(decidirCteDepoisDaEntrada({ algumaLancada: false, dev: false }), null)
})
test('nota já lançada: só dev por enquanto', () => {
  assert.equal(decidirCteDepoisDaEntrada({ algumaLancada: true, dev: true }), null)
  assert.match(decidirCteDepoisDaEntrada({ algumaLancada: true, dev: false })!, /depois da entrada ainda está em teste/)
})
test('aviso do custo refeito pela data da nota', () => {
  assert.equal(avisoCustoRefeito({ entradas_revisadas: 2, desde: '2026-11-04' }), 'Custo da entrada refeito pela data da nota (2 itens, desde 04/11/2026).')
  assert.equal(avisoCustoRefeito({ entradas_revisadas: 1, desde: '2026-11-04' }), 'Custo da entrada refeito pela data da nota (1 item, desde 04/11/2026).')
  assert.equal(avisoCustoRefeito({ entradas_revisadas: 0 }), null)
  assert.equal(avisoCustoRefeito(null), null)
})
