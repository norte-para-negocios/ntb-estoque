import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compraDoEvento, diaDaContagemNaSemana, estadoContagem, inicioDaSemana, valorEmEstoque } from './inicio-puro.ts'

test('semana de segunda a domingo', () => {
  assert.equal(inicioDaSemana('2026-11-12'), '2026-11-09') // quinta → segunda
  assert.equal(inicioDaSemana('2026-11-09'), '2026-11-09')
  assert.equal(inicioDaSemana('2026-11-15'), '2026-11-09') // domingo fica na semana que começou na segunda
  assert.equal(diaDaContagemNaSemana('2026-11-12', 1), '2026-11-09')
  assert.equal(diaDaContagemNaSemana('2026-11-12', 0), '2026-11-15')
})

test('lembrete: desligado, ainda não, pendente com atraso, feito com metade', () => {
  assert.deepEqual(estadoContagem('2026-11-12', null, 0, 10), { estado: 'desligada' })
  assert.deepEqual(estadoContagem('2026-11-12', 5, 0, 10), { estado: 'ainda_nao', dia: '2026-11-13' })
  assert.deepEqual(estadoContagem('2026-11-12', 4, 0, 10), { estado: 'pendente', dia: '2026-11-12', contados: 0, total: 10, diasAtraso: 0 })
  assert.deepEqual(estadoContagem('2026-11-12', 1, 4, 10), { estado: 'pendente', dia: '2026-11-09', contados: 4, total: 10, diasAtraso: 3 })
  assert.deepEqual(estadoContagem('2026-11-12', 1, 5, 10), { estado: 'feita', contados: 5, total: 10 })
  assert.deepEqual(estadoContagem('2026-11-12', 1, 6, 11), { estado: 'feita', contados: 6, total: 11 })
})

test('valor em estoque ignora saldo negativo e custo ausente', () => {
  assert.equal(valorEmEstoque([{ saldo: 2, custo: 10 }, { saldo: -1, custo: 5 }, { saldo: 3, custo: null }]), 20)
})

test('compra do evento desconta o que outros eventos reservaram e conta conflitos', () => {
  const nec = new Map([[1, { quantidade: 5, custoUnitario: 2 }], [2, { quantidade: 1, custoUnitario: null }], [3, { quantidade: 4, custoUnitario: 1 }]])
  const saldo = (c: number) => (c === 1 ? 10 : c === 2 ? 3 : undefined)
  const outros = (c: number) => (c === 1 ? 8 : c === 2 ? 4 : 0)
  // 1: livre 2, falta 3 (R$ 6); 2: livre −1 → conflito, falta 1; 3: unidade diferente, compra tudo (R$ 4)
  assert.deepEqual(compraDoEvento(nec, saldo, outros), { aComprar: 3, custoCompra: 10, conflitos: 1 })
})
