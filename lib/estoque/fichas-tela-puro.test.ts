import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agruparFichas, ondeEUsado, type LinhaFichaTela } from './fichas-tela-puro.ts'

const l = (produto: number, insumo: number, extra: Partial<LinhaFichaTela> = {}): LinhaFichaTela => ({
  produto, insumo, quantidade: 1, perda: 0, unidade: 'KG', local: null, localFonte: null,
  alteradoPor: null, alteradoEm: null, incluidoPor: null, incluidoEm: null, ...extra,
})

test('agruparFichas: uma ficha por produto, autor e data da mudança mais recente', () => {
  const r = agruparFichas([
    l(1, 10, { incluidoPor: 'ANA', incluidoEm: '2026-08-01' }),
    l(1, 11, { incluidoPor: 'ANA', incluidoEm: '2026-08-01', alteradoPor: 'BETO', alteradoEm: '2026-09-15' }),
    l(2, 10, { incluidoPor: 'CAIO', incluidoEm: '2026-07-10' }),
    l(3, 12),
  ])
  assert.equal(r.length, 3)
  const f1 = r.find((f) => f.produto === 1)!
  assert.equal(f1.itens.length, 2)
  assert.equal(f1.autor, 'BETO')
  assert.equal(f1.ultimaAlteracao, '2026-09-15')
  const f2 = r.find((f) => f.produto === 2)!
  assert.equal(f2.autor, 'CAIO')
  assert.equal(f2.ultimaAlteracao, '2026-07-10')
  const f3 = r.find((f) => f.produto === 3)!
  assert.equal(f3.autor, null)
  assert.equal(f3.ultimaAlteracao, null)
})

test('ondeEUsado: cada prato que leva o insumo, com quantidade e local', () => {
  const r = ondeEUsado([l(1, 10, { quantidade: 0.2, local: 5 }), l(2, 10, { quantidade: 1.5 }), l(2, 11)], 10)
  assert.deepEqual(r, [{ produto: 1, quantidade: 0.2, local: 5 }, { produto: 2, quantidade: 1.5, local: null }])
  assert.deepEqual(ondeEUsado([l(1, 10)], 99), [])
})
