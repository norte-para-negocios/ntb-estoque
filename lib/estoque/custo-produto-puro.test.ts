import { test } from 'node:test'
import assert from 'node:assert/strict'
import { serieCustoMedio, entradasQueFormaramCusto, custoDoPrato, type MovCusto } from './custo-produto-puro.ts'

const mv = (data: string, ordem: number, local: number, quantidade: number, valorUnit: number | null, cmc: number | null, saldo: number | null, cancelado = false): MovCusto =>
  ({ data, ordem, local, quantidade, valorUnit, cmc, saldo, cancelado })

test('série: último custo > 0 de cada dia, por local, em ordem de data', () => {
  const s = serieCustoMedio([
    mv('2026-10-02', 5, 1, -1, null, 12, 3), mv('2026-10-01', 1, 1, 5, 10, 10, 5), mv('2026-10-02', 2, 1, 5, 14, 11, 10),
    mv('2026-10-03', 6, 1, -1, null, 0, 2), mv('2026-10-01', 3, 2, 1, 7, 7, 1),
  ])
  assert.deepEqual(s.get(1), [{ data: '2026-10-01', cmc: 10 }, { data: '2026-10-02', cmc: 12 }])
  assert.deepEqual(s.get(2), [{ data: '2026-10-01', cmc: 7 }])
})

test('série: movimento cancelado não entra', () => {
  const s = serieCustoMedio([mv('2026-10-01', 1, 1, 5, 10, 10, 5), mv('2026-10-02', 2, 1, 5, 99, 99, 10, true)])
  assert.deepEqual(s.get(1), [{ data: '2026-10-01', cmc: 10 }])
})

test('entradas: só depois do último saldo <= 0 do local, mais recentes primeiro', () => {
  const r = entradasQueFormaramCusto([
    mv('2026-09-01', 1, 1, 10, 5, 5, 10),
    mv('2026-09-02', 2, 1, -10, null, 5, 0),
    mv('2026-09-03', 3, 1, 4, 6, 6, 4),
    mv('2026-09-04', 4, 1, -1, null, 6, 3),
    mv('2026-09-05', 5, 1, 2, 9, 7, 5),
    mv('2026-09-06', 6, 1, 3, 1, 1, 8, true),
    mv('2026-09-06', 7, 2, 1, 0, 0, 1),
  ])
  assert.deepEqual(r.map((x) => x.ordem), [5, 3])
})

test('entradas: respeita o limite', () => {
  const movs = Array.from({ length: 30 }, (_, i) => mv(`2026-09-${String(i + 1).padStart(2, '0')}`, i, 1, 1, 2, 2, i + 1))
  assert.equal(entradasQueFormaramCusto(movs, 5).length, 5)
  assert.equal(entradasQueFormaramCusto(movs, 5)[0].ordem, 29)
})

test('custo do prato: soma insumo x custo; insumo sem custo vai para a lista e conta 0', () => {
  const r = custoDoPrato([
    { insumo: 1, qtdPorUnidade: 0.2, cmc: 10 },
    { insumo: 2, qtdPorUnidade: 3, cmc: 0.5 },
    { insumo: 3, qtdPorUnidade: 1, cmc: null },
    { insumo: 4, qtdPorUnidade: 1, cmc: 0 },
  ])
  assert.equal(r.total, 3.5)
  assert.deepEqual(r.semCusto, [3, 4])
  assert.deepEqual(r.linhas.map((l) => l.custo), [2, 1.5, 0, 0])
})
