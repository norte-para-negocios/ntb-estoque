import { test } from 'node:test'
import assert from 'node:assert/strict'
import { numeroNf, dataEntradaCurta, textoNfEtiqueta, larguraTextoPt } from './etiqueta-nf.ts'

test('número da NF sem zeros à esquerda', () => {
  assert.equal(numeroNf('000007046'), '7046')
  assert.equal(numeroNf(' 123 '), '123')
  assert.equal(numeroNf('0'), '0')
  assert.equal(numeroNf(''), '')
  assert.equal(numeroNf(null), '')
  assert.equal(numeroNf('AB-12'), 'AB-12')
})

test('data de entrada do Omie (dd/mm/aaaa) e ISO viram dd/mm/aa', () => {
  assert.equal(dataEntradaCurta('14/10/2026'), '14/10/26')
  assert.equal(dataEntradaCurta('2026-10-14'), '14/10/26')
  assert.equal(dataEntradaCurta('2026-10-14T13:00:00Z'), '14/10/26')
  assert.equal(dataEntradaCurta(''), '')
  assert.equal(dataEntradaCurta('lixo'), '')
})

test('sem número de NF não mostra nada (etiqueta avulsa)', () => {
  assert.equal(textoNfEtiqueta({ numero: '', serie: '1', entrada: '14/10/2026' }, 500), '')
  assert.equal(textoNfEtiqueta({ numero: null }, 500), '')
})

test('cabe tudo: número, série e data de entrada', () => {
  assert.equal(textoNfEtiqueta({ numero: '000007046', serie: '1', entrada: '14/10/2026' }, 200, 7.25), 'NF nº 7046 série 1 · 14/10/26')
})

test('espaço só para dia/mês', () => {
  const t = 'NF nº 7046 série 1 · 14/10'
  assert.equal(textoNfEtiqueta({ numero: '7046', serie: '1', entrada: '14/10/2026' }, larguraTextoPt(t, 7.25) + 0.5, 7.25), t)
})

test('negrito ocupa mais: o mesmo espaço pode não caber em negrito', () => {
  const t = 'NF nº 7046 série 1 · 14/10/26'
  const w = larguraTextoPt(t, 7.25) + 0.5
  assert.equal(textoNfEtiqueta({ numero: '7046', serie: '1', entrada: '14/10/2026' }, w, 7.25), t)
  assert.notEqual(textoNfEtiqueta({ numero: '7046', serie: '1', entrada: '14/10/2026' }, w, 7.25, true), t)
})

test('sem espaço para a data: só número e série', () => {
  const t = 'NF nº 7046 série 1'
  const w = larguraTextoPt(t, 7.25)
  assert.equal(textoNfEtiqueta({ numero: '7046', serie: '1', entrada: '14/10/2026' }, w + 1, 7.25), t)
})

test('bem apertado: forma curta, nunca some o número', () => {
  assert.equal(textoNfEtiqueta({ numero: '7046', serie: '1', entrada: '14/10/2026' }, 10, 7.25), 'NF 7046-1')
  assert.equal(textoNfEtiqueta({ numero: '7046', serie: '', entrada: '' }, 10, 7.25), 'NF 7046')
})

test('sem série: não escreve "série"', () => {
  assert.equal(textoNfEtiqueta({ numero: '7046', serie: ' ', entrada: '14/10/2026' }, 200, 7.25), 'NF nº 7046 · 14/10/26')
})

test('largura cresce com o texto e com a fonte', () => {
  assert.ok(larguraTextoPt('NF nº 7046', 8) > larguraTextoPt('NF 7046', 8))
  assert.ok(larguraTextoPt('NF 7046', 9) > larguraTextoPt('NF 7046', 8))
})
