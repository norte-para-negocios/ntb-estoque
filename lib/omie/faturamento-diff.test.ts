// Fase I (19/10/2026): syncFaturamento apagava e reinseria o mês atual e o anterior de todas as lojas a cada hora
// (~7,6 mil DELETE + 7,6 mil INSERT por hora em faturamento_importado = 93 % da outbox, e cada linha virava versão
// nova para os desktops). Agora grava só a diferença.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffFaturamentoImportado, type LinhaFat } from './faturamento-diff.ts'

const L = (dimensao: string, rotulo: string, mes: string, valor: number): LinhaFat => ({ dimensao, rotulo, mes, valor })

test('iguais: nada a gravar', () => {
  const a = [L('tipo', '04', '2026-10', 100), L('familia', 'DRINKS', '2026-09', 50.5)]
  const d = diffFaturamentoImportado(a, [...a].reverse())
  assert.deepEqual(d, { inserir: [], atualizar: [], apagar: [] })
})

test('valor comparado como gravado (2 casas)', () => {
  const d1 = diffFaturamentoImportado([L('tipo', '04', '2026-10', 10)], [L('tipo', '04', '2026-10', 10.004)])
  assert.equal(d1.atualizar.length, 0)
  const d2 = diffFaturamentoImportado([L('tipo', '04', '2026-10', 10)], [L('tipo', '04', '2026-10', 10.01)])
  assert.deepEqual(d2.atualizar, [L('tipo', '04', '2026-10', 10.01)])
  assert.equal(d2.inserir.length + d2.apagar.length, 0)
})

test('rótulo que sumiu do mês é apagado; rótulo novo é inserido', () => {
  const d = diffFaturamentoImportado(
    [L('produto', 'Pastel', '2026-10', 30), L('produto', 'Coxinha', '2026-10', 20)],
    [L('produto', 'Pastel', '2026-10', 30), L('produto', 'Suco', '2026-10', 15)],
  )
  assert.deepEqual(d.apagar, [L('produto', 'Coxinha', '2026-10', 20)])
  assert.deepEqual(d.inserir, [L('produto', 'Suco', '2026-10', 15)])
  assert.equal(d.atualizar.length, 0)
})

test('mesmo rótulo em outro mês ou outra dimensão é outra linha', () => {
  const d = diffFaturamentoImportado([L('tipo', '04', '2026-09', 10)], [L('tipo', '04', '2026-10', 10), L('familia', '04', '2026-09', 10)])
  assert.deepEqual(d.apagar, [L('tipo', '04', '2026-09', 10)])
  assert.equal(d.inserir.length, 2)
})

test('rótulo com | e aspas não colide', () => {
  const ex = [L('produto', 'JOHNNIE | BLACK', '2026-10', 10), L('produto', 'a"b', '2026-10', 5)]
  const novos = [L('produto', 'JOHNNIE | BLACK', '2026-10', 10), L('produto', 'JOHNNIE', '2026-10', 7), L('produto', 'a"b', '2026-10', 6)]
  const d = diffFaturamentoImportado(ex, novos)
  assert.deepEqual(d.inserir, [L('produto', 'JOHNNIE', '2026-10', 7)])
  assert.deepEqual(d.atualizar, [L('produto', 'a"b', '2026-10', 6)])
  assert.equal(d.apagar.length, 0)
})

test('valor vindo do banco como texto (numeric do PostgREST) compara pelo número', () => {
  const ex = [{ dimensao: 'tipo', rotulo: '04', mes: '2026-10', valor: '123.40' as unknown as number }]
  assert.equal(diffFaturamentoImportado(ex, [L('tipo', '04', '2026-10', 123.4)]).atualizar.length, 0)
})

// Revisão M2 (19/10/2026): o apagar por rótulo vai num filtro `in` na URL; aspas e barra precisam de escape.
test('filtroInPostgrest: aspas em todos os valores, escapa barra e aspas', async () => {
  const { filtroInPostgrest } = await import('./faturamento-diff.ts')
  assert.equal(filtroInPostgrest(['Pastel']), '("Pastel")')
  assert.equal(filtroInPostgrest(['PIZZA 8"', 'A\\B', 'x,y (z)']), '("PIZZA 8\\"","A\\\\B","x,y (z)")')
  assert.equal(filtroInPostgrest(['JOHNNIE | BLACK', 'Açaí']), '("JOHNNIE | BLACK","Açaí")')
  assert.equal(filtroInPostgrest(['fim\\']), '("fim\\\\")')
})
