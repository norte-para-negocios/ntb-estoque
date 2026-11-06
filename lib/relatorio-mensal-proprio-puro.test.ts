import { test } from 'node:test'
import assert from 'node:assert/strict'
import { baixasDeProducao, perdasPorMesETipo } from './relatorio-mensal-proprio-puro.ts'

const tipos = new Map([[1, '01'], [2, '00'], [3, '04']])

test('perdas por mês e tipo: correção de dados e produto acabado ficam de fora', () => {
  const r = perdasPorMesETipo([
    { data: '2026-10-03', produto: 1, valor: 10, causa: 'vencimento' },
    { data: '2026-10-20', produto: 1, valor: 5.5, causa: 'quebra' },
    { data: '2026-10-21', produto: 2, valor: 7, causa: 'desperdicio' },
    { data: '2026-10-22', produto: 1, valor: 100, causa: 'correcao' },
    { data: '2026-10-22', produto: 3, valor: 50, causa: 'quebra' },
    { data: '2026-11-01', produto: 2, valor: 3, causa: 'outro' },
  ], tipos)
  assert.deepEqual(r.get('2026-10'), { mp: 15.5, revenda: 7 })
  assert.deepEqual(r.get('2026-11'), { mp: 0, revenda: 3 })
})

test('baixas de produção: só saída de insumo, valor = quantidade × custo da baixa; sem custo é contado à parte', () => {
  const nomes = new Map([[1, 'Camarão'], [2, 'Cerveja'], [3, 'Moqueca']])
  const r = baixasDeProducao([
    { codigo_produto: 1, quantidade: -2, custo_unitario: 30 },
    { codigo_produto: 1, quantidade: -0.5, custo_unitario: 32 },
    { codigo_produto: 1, quantidade: 1, custo_unitario: 30 },   // entrada: fora
    { codigo_produto: 2, quantidade: -3, custo_unitario: 4.1 },
    { codigo_produto: 3, quantidade: -1, custo_unitario: 50 },  // produto acabado: fora
    { codigo_produto: 1, quantidade: -1, custo_unitario: 0 },   // sem custo
  ], tipos, nomes)
  assert.equal(r.materiaPrima.get('Camarão'), 76)
  assert.equal(r.revenda.get('Cerveja'), 12.3)
  assert.equal(r.revenda.size + r.materiaPrima.size, 2)
  assert.equal(r.insumosSemCusto, 1)
})
