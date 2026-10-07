import { test } from 'node:test'
import assert from 'node:assert/strict'
import { casarItem, montarContexto, podeLancarAutomatico, similaridade, unidadesCompativeis, normalizar } from './nf-conferencia.ts'

const produtos = [
  { codigo_produto: 1, codigo: '80001', descricao: 'Limão Tahiti', unidade: 'KG', ean: null },
  { codigo_produto: 2, codigo: '90001', descricao: 'Cerveja Heineken Long Neck 330ml', unidade: 'UN', ean: '7891234567895' },
  { codigo_produto: 3, codigo: '90002', descricao: 'Água Mineral 500ml', unidade: 'UN', ean: '7890000000011', inativo: true },
  { codigo_produto: 4, codigo: '80002', descricao: 'Filé de Peixe', unidade: 'G', ean: null },
]
const depara = [{ c_prod: 'LIM01', codigo_produto: 1, fator: 1 }, { c_prod: 'PXCX', codigo_produto: 4, fator: 5000 }, { c_prod: 'INATIVO', codigo_produto: 3, fator: 1 }]
const ctx = montarContexto(produtos, depara)

test('normaliza acentos, caixa e pontuação', () => { assert.equal(normalizar('  LIMÃO  Tahiti, KG. '), 'limao tahiti kg') })

test('unidades equivalentes', () => {
  assert.ok(unidadesCompativeis('UND', 'un')); assert.ok(unidadesCompativeis('Lt', 'L')); assert.ok(!unidadesCompativeis('CX', 'UN'))
})

test('de-para vence e traz o fator confirmado; produto inativo no de-para não casa', () => {
  const a = casarItem({ cProd: 'PXCX', ean: null, descricao: 'FILE PEIXE CX 5KG', unidade: 'CX' }, ctx)
  assert.deepEqual([a.codigoProduto, a.fator, a.origem, a.automatico], [4, 5000, 'depara', true])
  const b = casarItem({ cProd: 'INATIVO', ean: null, descricao: 'zzz', unidade: 'UN' }, ctx)
  assert.equal(b.codigoProduto, null)
})

test('EAN com a mesma unidade é automático; com unidade diferente só sugere (falta o fator)', () => {
  const a = casarItem({ cProd: 'X', ean: '7891234567895', descricao: 'cerveja', unidade: 'UN' }, ctx)
  assert.deepEqual([a.codigoProduto, a.origem, a.automatico], [2, 'ean', true])
  const b = casarItem({ cProd: 'X', ean: '7891234567895', descricao: 'cerveja fardo', unidade: 'FD' }, ctx)
  assert.deepEqual([b.codigoProduto, b.sugestao, b.automatico], [null, 2, false])
})

test('descrição parecida só sugere, nunca é automática', () => {
  const a = casarItem({ cProd: 'N1', ean: null, descricao: 'LIMAO TAHITI KG', unidade: 'KG' }, ctx)
  assert.equal(a.codigoProduto, null); assert.equal(a.sugestao, 1); assert.equal(a.origem, 'descricao'); assert.equal(a.automatico, false)
  assert.ok((a.score ?? 0) >= 0.9)
  const b = casarItem({ cProd: 'N2', ean: null, descricao: 'Detergente neutro 5L', unidade: 'UN' }, ctx)
  assert.deepEqual([b.codigoProduto, b.sugestao, b.origem], [null, null, null])
})

test('lança sozinho só se TODOS os itens casaram com segurança', () => {
  const ok = [casarItem({ cProd: 'LIM01', ean: null, descricao: 'x', unidade: 'KG' }, ctx), casarItem({ cProd: 'X', ean: '7891234567895', descricao: 'y', unidade: 'UN' }, ctx)]
  assert.equal(podeLancarAutomatico(ok), true)
  const misto = [...ok, casarItem({ cProd: 'N1', ean: null, descricao: 'LIMAO TAHITI KG', unidade: 'KG' }, ctx)]
  assert.equal(podeLancarAutomatico(misto), false)
  assert.equal(podeLancarAutomatico([]), false)
})

test('similaridade tolera ordem e erro de digitação', () => {
  assert.ok(similaridade('Heineken Long Neck 330ml Cerveja', 'Cerveja Heineken Long Neck 330ml') > 0.9)
  assert.ok(similaridade('Cerveja Heinekem 330', 'Cerveja Heineken 330ml') > 0.8)
  assert.ok(similaridade('Arroz', 'Detergente') < 0.3)
})
