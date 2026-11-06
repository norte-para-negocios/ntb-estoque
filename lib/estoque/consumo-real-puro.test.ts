import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estadoTelaConsumo, maioresDesvios, normalizarConsumo, resumoConsumo, textoSemContagem, type LinhaConsumoDb } from './consumo-real-puro.ts'

// T5.3: consumo teórico (ficha × vendas + OP) × real (contagens), desvio em R$. Sem contagem = não inventa nada.

const ok = (prod: number, desvio: number, custo: number, extra: Partial<LinhaConsumoDb> = {}): LinhaConsumoDb => ({
  codigo_local_estoque: 1, codigo_produto: prod, situacao: 'ok', contagens: 2, inventario_ini: 10, inventario_fim: 11,
  contado_ini_em: '2026-11-01T15:00:00Z', contado_fim_em: '2026-11-20T15:00:00Z', saldo_ini: '10', saldo_fim: '4', entradas: '20',
  teorico_venda: '20', teorico_op: '0', teorico: '20', ajustes_perdas: '0', consumo_real: String(20 + desvio), desvio: String(desvio),
  custo_unitario: String(custo), custo_estimado: false, teorico_valor: String(20 * custo), real_valor: String((20 + desvio) * custo),
  desvio_valor: String(Math.round(desvio * custo * 100) / 100), ...extra,
})
const sem = (prod: number, contagens = 0): LinhaConsumoDb => ({
  codigo_local_estoque: 1, codigo_produto: prod, situacao: 'sem_contagem', contagens, inventario_ini: null, inventario_fim: null,
  contado_ini_em: null, contado_fim_em: null, saldo_ini: null, saldo_fim: null, entradas: null, teorico_venda: '3', teorico_op: '1',
  teorico: '4', ajustes_perdas: '0', consumo_real: null, desvio: null, custo_unitario: '2', custo_estimado: false, teorico_valor: '8',
  real_valor: null, desvio_valor: null,
})

test('normaliza números do banco (string) e mantém null onde não há contagem', () => {
  const [a, b] = normalizarConsumo([ok(1, 2, 3), sem(2)])
  assert.equal(a.desvio, 2)
  assert.equal(a.desvioValor, 6)
  assert.equal(a.saldoIni, 10)
  assert.equal(b.consumoReal, null)
  assert.equal(b.desvio, null)
  assert.equal(b.desvioValor, null)
  assert.equal(b.teorico, 4)
})

test('resumo soma só as linhas com contagem; falta (desvio > 0) e sobra (desvio < 0) separadas', () => {
  const r = resumoConsumo(normalizarConsumo([ok(1, 2, 3), ok(2, -1, 10), sem(3)]))
  assert.equal(r.comContagem, 2)
  assert.equal(r.semContagem, 1)
  assert.equal(r.desvioValor, 6 - 10)
  assert.equal(r.faltaValor, 6)
  assert.equal(r.sobraValor, 10)
  assert.equal(r.teoricoValor, 60 + 200)
  assert.equal(r.teoricoSemContagemValor, 8)
})

test('10 maiores desvios em R$ pelo valor absoluto, nunca das linhas sem contagem', () => {
  const linhas = normalizarConsumo([sem(99), ...Array.from({ length: 12 }, (_, i) => ok(i + 1, i % 2 ? i : -i, 1))])
  const top = maioresDesvios(linhas, 10)
  assert.equal(top.length, 10)
  assert.ok(top.every((l) => l.situacao === 'ok'))
  assert.deepEqual(top.slice(0, 3).map((l) => Math.abs(l.desvioValor!)), [11, 10, 9])
})

test('estado da tela: erro, vazio, só sem contagem, ok', () => {
  assert.equal(estadoTelaConsumo([], 'falhou'), 'erro')
  assert.equal(estadoTelaConsumo([], null), 'vazio')
  assert.equal(estadoTelaConsumo(normalizarConsumo([sem(1)]), null), 'sem_contagem')
  assert.equal(estadoTelaConsumo(normalizarConsumo([sem(1), ok(2, 1, 1)]), null), 'ok')
})

test('texto de "sem contagem" diz quantas contagens faltam', () => {
  assert.equal(textoSemContagem(0), 'Sem contagem no período')
  assert.equal(textoSemContagem(1), 'Só 1 contagem no período: falta a do começo ou a do fim')
})
