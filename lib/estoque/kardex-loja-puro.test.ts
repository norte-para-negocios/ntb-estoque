import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lerFiltrosKardex, paginaKardex, paraCsv, rotuloOrigemKardex, ORDEM_KARDEX } from './kardex-loja-puro.ts'

const HOJE = '2026-10-13'

test('filtros: padrão últimos 7 dias, página 1', () => {
  const f = lerFiltrosKardex({}, HOJE)
  assert.equal(f.ini, '2026-10-07')
  assert.equal(f.fim, '2026-10-13')
  assert.equal(f.page, 1)
  assert.equal(f.erro, null)
  assert.equal(f.produto, null)
  assert.equal(f.local, null)
})

test('filtros: datas invertidas são trocadas', () => {
  const f = lerFiltrosKardex({ data_inicio: '2026-10-10', data_final: '2026-10-01' }, HOJE)
  assert.equal(f.ini, '2026-10-01')
  assert.equal(f.fim, '2026-10-10')
})

test('filtros: mais de 366 dias corta e avisa; data inválida volta ao padrão', () => {
  const f = lerFiltrosKardex({ data_inicio: '2025-01-01', data_final: '2026-10-13' }, HOJE)
  assert.equal(f.ini, '2025-10-13')
  assert.match(f.erro ?? '', /366/)
  const g = lerFiltrosKardex({ data_inicio: '13/10/2026' }, HOJE)
  assert.equal(g.ini, '2026-10-07')
})

test('filtros: produto, local, origem, autor, página', () => {
  const f = lerFiltrosKardex({ produto: '123', local: '9', origem: 'VEN', autor: ' Ana ', page: '3', q: ' coca ' }, HOJE)
  assert.equal(f.produto, 123)
  assert.equal(f.local, 9)
  assert.equal(f.origem, 'VEN')
  assert.equal(f.autor, 'Ana')
  assert.equal(f.q, 'coca')
  assert.equal(f.page, 3)
  assert.equal(lerFiltrosKardex({ page: 'x', produto: 'abc' }, HOJE).page, 1)
  assert.equal(lerFiltrosKardex({ produto: 'abc' }, HOJE).produto, null)
})

test('paginaKardex: offset por página', () => {
  assert.deepEqual(paginaKardex(1, 100), { from: 0, to: 99 })
  assert.deepEqual(paginaKardex(3, 100), { from: 200, to: 299 })
})

test('ordem total: data, id do movimento e id da linha', () => {
  assert.deepEqual([...ORDEM_KARDEX], ['data_mov', 'id_mov', 'id'])
})

test('paraCsv: BOM, ponto e vírgula, aspas, quebra de linha e vírgula decimal', () => {
  const csv = paraCsv(['Produto', 'Qtd', 'Obs'], [['Coca; lata "350"', 1234.5, null], ['Linha\nnova', -2, 'ok']])
  assert.ok(csv.startsWith('﻿'))
  const linhas = csv.slice(1).split('\r\n')
  assert.equal(linhas[0], 'Produto;Qtd;Obs')
  assert.equal(linhas[1], '"Coca; lata ""350""";1234,5;')
  assert.equal(linhas[2], '"Linha\nnova";-2;ok')
})

test('rotuloOrigemKardex: código com descrição, ou só um deles', () => {
  assert.equal(rotuloOrigemKardex('VEN', 'Venda de produto'), 'Venda de produto')
  assert.equal(rotuloOrigemKardex('VEN', null), 'VEN')
  assert.equal(rotuloOrigemKardex('', null), '-')
})

test('lerPeriodo: padrão e limite configuráveis', async () => {
  const { lerPeriodo } = await import('./kardex-loja-puro.ts')
  assert.deepEqual(lerPeriodo({}, HOJE, 30, 92), { ini: '2026-09-14', fim: '2026-10-13', erro: null })
  const r = lerPeriodo({ data_inicio: '2026-01-01', data_final: '2026-10-13' }, HOJE, 30, 92)
  assert.equal(r.ini, '2026-07-14')
  assert.match(r.erro ?? '', /92/)
})
