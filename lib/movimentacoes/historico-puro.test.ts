import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agregarHistorico, type LinhaHist } from './historico-puro.ts'

const L = (cod: number, data: string, e: number, s: number): LinhaHist => ({ cod_prod: cod, codigo: String(cod), descricao: `P${cod}`, data, entradas: e, saidas: s })
const rows = [L(1, '2026-09-30', 5, 1), L(1, '2026-10-02', 0, 4), L(2, '2026-10-02', 0, 9), L(3, '2026-10-03', 2, 0)]

test('por mês: agrupa produto+mês, ordena mês desc e saídas desc', () => {
  const r = agregarHistorico(rows, { porMes: true, mov: '', codigos: null, page: 1, porPagina: 100 })
  assert.deepEqual(r.linhas.map((l) => `${l.cod_prod}@${l.quando}:${l.entradas}/${l.saidas}`), ['2@2026-10:0/9', '1@2026-10:0/4', '3@2026-10:2/0', '1@2026-09:5/1'])
  assert.deepEqual([r.totalEntradas, r.totalSaidas], [7, 14])
  assert.equal(r.temProxima, false)
})

test('por data: uma linha por produto/dia, filtro de saídas afeta totais', () => {
  const r = agregarHistorico(rows, { porMes: false, mov: 'saida', codigos: null, page: 1, porPagina: 2 })
  assert.deepEqual(r.linhas.map((l) => `${l.cod_prod}@${l.quando}`), ['2@2026-10-02', '1@2026-10-02'])
  assert.deepEqual([r.totalEntradas, r.totalSaidas], [5, 14])
  assert.equal(r.temProxima, true)
  const p2 = agregarHistorico(rows, { porMes: false, mov: 'saida', codigos: null, page: 2, porPagina: 2 })
  assert.deepEqual(p2.linhas.map((l) => `${l.cod_prod}@${l.quando}`), ['1@2026-09-30'])
})

test('filtro de códigos em memória (lista grande não vai para a URL)', () => {
  const r = agregarHistorico(rows, { porMes: false, mov: '', codigos: new Set([1, 3]), page: 1, porPagina: 100 })
  assert.deepEqual(r.linhas.map((l) => l.cod_prod).sort(), [1, 1, 3])
  assert.deepEqual([r.totalEntradas, r.totalSaidas], [7, 5])
})
