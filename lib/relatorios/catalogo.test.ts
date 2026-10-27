import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CUBOS, PRESETS, presetPorSlug, EM_BREVE } from './catalogo.ts'

test('slugs do Omie sao unicos (presets e em breve juntos)', () => {
  const todos = [...PRESETS.map((p) => p.slugOmie), ...EM_BREVE.map((p) => p.slugOmie)]
  assert.equal(new Set(todos).size, todos.length)
})

test('presets de fase 1 apontam para cubo existente e usam so campos do cubo', () => {
  for (const p of PRESETS.filter((x) => x.fase === 1)) {
    const cubo = CUBOS[p.cubo as keyof typeof CUBOS]
    assert.ok(cubo, `${p.slugOmie}: cubo ${p.cubo} nao existe`)
    const campos = new Set(cubo.campos.map((c) => c.id))
    for (const id of [...p.layout.linhas, ...p.layout.colunas, ...p.layout.medidas.map((m) => m.campo), ...Object.keys(p.layout.filtros), ...Object.keys(p.layout.exceto ?? {})]) {
      assert.ok(campos.has(id), `${p.slugOmie}: campo "${id}" nao existe no cubo`)
    }
  }
})

test('os 8 relatorios de Recebimentos do Omie existem', () => {
  for (const s of ['periodo', 'mesano', 'fornecedor', 'produto', 'categoria', 'departamento', 'projeto', 'trasnportadora']) {
    assert.ok(presetPorSlug(`rel-com-recebimentos-por-${s}`), s)
  }
  assert.equal(presetPorSlug('nao-existe'), undefined)
})

test('o relatorio por produto mostra quantidade; todos escondem cancelada', () => {
  assert.equal(presetPorSlug('rel-com-recebimentos-por-produto')!.layout.medidas[0].campo, 'Quantidade')
  for (const p of PRESETS) assert.deepEqual(p.layout.exceto, { Situação: ['Cancelada'] })
})

test('titulos do que vem depois nao se repetem (o hub nao mostra dois cartoes iguais)', () => {
  const t = EM_BREVE.map((p) => p.titulo)
  assert.equal(new Set(t).size, t.length)
})
