import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diasAte, lerFiltroValidade, passaFiltro, situacaoValidade, somarDias } from './validade-regras.ts'

const HOJE = '2026-10-07'

test('somarDias e diasAte atravessam mês e ano', () => {
  assert.equal(somarDias('2026-10-30', 3), '2026-11-02')
  assert.equal(somarDias('2026-12-31', 1), '2027-01-01')
  assert.equal(diasAte('2026-10-10', HOJE), 3)
  assert.equal(diasAte('2026-10-01', HOJE), -6)
})

test('situação do lote', () => {
  assert.equal(situacaoValidade(null, HOJE, 7), 'sem_validade')
  assert.equal(situacaoValidade('2026-10-06', HOJE, 7), 'vencido')
  assert.equal(situacaoValidade(HOJE, HOJE, 7), 'hoje')
  assert.equal(situacaoValidade('2026-10-14', HOJE, 7), 'proximo')
  assert.equal(situacaoValidade('2026-10-15', HOJE, 7), 'ok')
  assert.equal(situacaoValidade('2026-10-08', HOJE, 0), 'proximo', 'alerta mínimo de 1 dia')
})

test('filtro da URL com padrões seguros', () => {
  assert.deepEqual(lerFiltroValidade({}, 7), { modo: 'periodo', dias: 7 })
  assert.deepEqual(lerFiltroValidade({ modo: 'vencidos' }, 7), { modo: 'vencidos', dias: 7 })
  assert.deepEqual(lerFiltroValidade({ dias: '30' }, 7), { modo: 'periodo', dias: 30 })
  assert.deepEqual(lerFiltroValidade({ dias: '-3' }, 10), { modo: 'periodo', dias: 10 })
  assert.deepEqual(lerFiltroValidade({ dias: 'abc', modo: 'xyz' }, 5), { modo: 'periodo', dias: 5 })
})

test('passaFiltro', () => {
  const p = { modo: 'periodo' as const, dias: 7 }
  assert.equal(passaFiltro(HOJE, HOJE, p), true)
  assert.equal(passaFiltro('2026-10-14', HOJE, p), true)
  assert.equal(passaFiltro('2026-10-15', HOJE, p), false)
  assert.equal(passaFiltro('2026-10-06', HOJE, p), false)
  assert.equal(passaFiltro(null, HOJE, p), false)
  assert.equal(passaFiltro('2026-10-06', HOJE, { modo: 'vencidos', dias: 7 }), true)
  assert.equal(passaFiltro(HOJE, HOJE, { modo: 'vencidos', dias: 7 }), false)
  assert.equal(passaFiltro(null, HOJE, { modo: 'sem_validade', dias: 7 }), true)
  assert.equal(passaFiltro('2030-01-01', HOJE, { modo: 'todos', dias: 7 }), true)
  assert.equal(passaFiltro(HOJE, HOJE, { modo: 'periodo', dias: 0 }), true, 'vence hoje')
})
