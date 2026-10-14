import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  custoAbsurdo, negativoDesde, saltosRecentes, ultimoCmcAnterior, oscilacoesContagem, opsSobrandoFaltando,
  insumosSemCustoNoLocal, produtosSemFichaQueVendem, cmcPorLocalAtual, type MovSaldo,
} from './saude-puro.ts'

test('custoAbsurdo: R$ 1.000 ou mais é alto; 20x o anterior é salto; resto null', () => {
  assert.equal(custoAbsurdo(1000, null), 'alto')
  assert.equal(custoAbsurdo(999.99, null), null)
  assert.equal(custoAbsurdo(40, 2), 'salto20')
  assert.equal(custoAbsurdo(39, 2), null)
  assert.equal(custoAbsurdo(0, 2), null)
  assert.equal(custoAbsurdo(null, 2), null)
  assert.equal(custoAbsurdo(50, 0), null)
})

const m = (data: string, ordem: number, local: number, saldo: number | null, cmc: number | null = null): MovSaldo => ({ data, ordem, local, saldo, cmc })

test('negativoDesde: começo do trecho negativo ATUAL, por local', () => {
  const movs = [
    m('2026-09-01', 1, 10, -2), m('2026-09-02', 2, 10, 3), m('2026-09-05', 3, 10, -1), m('2026-09-06', 4, 10, -4),
    m('2026-09-03', 5, 20, 5),
  ]
  const r = negativoDesde(movs)
  assert.equal(r.get(10), '2026-09-05')
  assert.equal(r.has(20), false)
})

test('negativoDesde: ordem por data e depois pela ordem do movimento (entrada fora de ordem)', () => {
  const r = negativoDesde([m('2026-09-02', 9, 1, -1), m('2026-09-02', 3, 1, 2), m('2026-09-01', 1, 1, -5)])
  assert.equal(r.get(1), '2026-09-02')
})

test('saltosRecentes: 10x o anterior no mesmo local, só desde a data', () => {
  const movs = [m('2026-09-01', 1, 1, 5, 2), m('2026-09-02', 2, 1, 5, 25), m('2026-10-10', 3, 1, 5, 3), m('2026-10-11', 4, 1, 5, 40), m('2026-10-11', 5, 2, 1, 900)]
  const r = saltosRecentes(movs, '2026-10-06')
  assert.deepEqual(r, [{ local: 1, data: '2026-10-11', de: 3, para: 40 }])
})

test('ultimoCmcAnterior: último cmc > 0 e o diferente anterior', () => {
  const r = ultimoCmcAnterior([m('2026-09-01', 1, 1, 1, 5), m('2026-09-02', 2, 1, 1, 5), m('2026-09-03', 3, 1, 1, 0), m('2026-09-04', 4, 1, 1, 120)])
  assert.deepEqual(r.get(1), { atual: 120, anterior: 5 })
})

test('oscilacoesContagem: razão >= 3 entre contagens seguidas, e zero no meio', () => {
  const c = [
    { produto: 1, local: 1, data: '2026-09-01', ordem: 1, qtd: 10 },
    { produto: 1, local: 1, data: '2026-09-08', ordem: 2, qtd: 3 },
    { produto: 1, local: 1, data: '2026-09-15', ordem: 3, qtd: 4 },
    { produto: 2, local: 1, data: '2026-09-01', ordem: 4, qtd: 5 },
    { produto: 2, local: 1, data: '2026-09-02', ordem: 5, qtd: 0 },
    { produto: 3, local: 1, data: '2026-09-01', ordem: 6, qtd: 5 },
    { produto: 3, local: 2, data: '2026-09-02', ordem: 7, qtd: 50 },
  ]
  assert.deepEqual(oscilacoesContagem(c), [
    { produto: 1, local: 1, data: '2026-09-08', de: 10, para: 3 },
    { produto: 2, local: 1, data: '2026-09-02', de: 5, para: 0 },
  ])
})

test('opsSobrandoFaltando: OP de cupom com saldo >= 0 sobra; PA/PI negativo sem OP falta', () => {
  const saldos = new Map([[1, 0], [2, -3], [3, -1], [4, -2]])
  const tipos = new Map<number, string | null>([[1, '04'], [2, '04'], [3, '03'], [4, '01']])
  const abertas = [{ id: 10, produto: 1, origem: 'cupom' }, { id: 11, produto: 1, origem: 'manual' }, { id: 12, produto: 3, origem: 'cupom' }]
  const r = opsSobrandoFaltando(saldos, tipos, abertas)
  assert.deepEqual(r.sobrando.map((o) => o.id), [10])
  assert.deepEqual(r.faltando, [2])
})

test('insumosSemCustoNoLocal: insumo sem custo no local de consumo, com os pratos', () => {
  const cmc = new Map([['100:1', 5], ['101:1', 0]])
  const itens = [
    { produto: 1, insumo: 100, local: 1 }, { produto: 1, insumo: 101, local: 1 }, { produto: 2, insumo: 101, local: 1 },
    { produto: 2, insumo: 102, local: 2 }, { produto: 3, insumo: 103, local: null },
  ]
  assert.deepEqual(insumosSemCustoNoLocal(itens, cmc), [
    { insumo: 101, local: 1, pratos: [1, 2] },
    { insumo: 102, local: 2, pratos: [2] },
  ])
})

test('produtosSemFichaQueVendem: só PA/PI lido com 0 itens; não lido fica fora', () => {
  const vendidos = new Set([1, 2, 3, 4])
  const lida = new Map([[1, 0], [2, 5], [4, 0]])
  const tipos = new Map<number, string | null>([[1, '04'], [2, '04'], [3, '04'], [4, '00']])
  assert.deepEqual(produtosSemFichaQueVendem(vendidos, lida, tipos), [1])
})

test('cmcPorLocalAtual: foto mais recente com local real; sentinela 0 ignorada', () => {
  const p = [
    { data_posicao: '2026-10-12', codigo_local_estoque: 1, n_cod_prod: 100, n_cmc: 2 },
    { data_posicao: '2026-10-13', codigo_local_estoque: 1, n_cod_prod: 100, n_cmc: 3 },
    { data_posicao: '2026-10-13', codigo_local_estoque: 0, n_cod_prod: 100, n_cmc: 9 },
    { data_posicao: '2026-10-14', codigo_local_estoque: 0, n_cod_prod: 100, n_cmc: 9 },
  ]
  const r = cmcPorLocalAtual(p)
  assert.equal(r.get('100:1'), 3)
  assert.equal(r.has('100:0'), false)
})

test('rotuloNegativoDesde: sem histórico do kardex não inventa data; trecho que começa antes da janela vira "antes de"', async () => {
  const { rotuloNegativoDesde } = await import('./saude-puro.ts')
  assert.deepEqual(rotuloNegativoDesde({ desde: '2026-09-10', primeiraData: '2026-09-10', saldoAntesDaPrimeira: -2, coberturaIni: null }), { tipo: 'sem_historico', data: null })
  assert.deepEqual(rotuloNegativoDesde({ desde: undefined, primeiraData: undefined, saldoAntesDaPrimeira: null, coberturaIni: '2026-08-15' }), { tipo: 'antes', data: '2026-08-15' })
  // 1º movimento lido já era negativo e o saldo antes dele também: começou antes da janela.
  assert.deepEqual(rotuloNegativoDesde({ desde: '2026-09-10', primeiraData: '2026-09-10', saldoAntesDaPrimeira: -2, coberturaIni: '2026-08-15' }), { tipo: 'antes', data: '2026-08-15' })
  // 1º movimento lido deixou negativo (antes estava >= 0): começou nele.
  assert.deepEqual(rotuloNegativoDesde({ desde: '2026-09-10', primeiraData: '2026-09-10', saldoAntesDaPrimeira: 3, coberturaIni: '2026-08-15' }), { tipo: 'desde', data: '2026-09-10' })
  assert.deepEqual(rotuloNegativoDesde({ desde: '2026-09-20', primeiraData: '2026-09-10', saldoAntesDaPrimeira: -2, coberturaIni: '2026-08-15' }), { tipo: 'desde', data: '2026-09-20' })
})

test('opsSobrandoFaltando: sem a lista de OPs (erro de leitura) não acusa prato "sem OP"', () => {
  const r = opsSobrandoFaltando(new Map([[2, -3]]), new Map<number, string | null>([[2, '04']]), [], false)
  assert.deepEqual(r, { sobrando: [], faltando: [], indisponivel: true })
  assert.equal(opsSobrandoFaltando(new Map([[2, -3]]), new Map<number, string | null>([[2, '04']]), []).indisponivel, false)
})

test('quaisVenderam: consulta cada produto (um que vende muito não esconde os outros)', async () => {
  const { quaisVenderam } = await import('./saude-puro.ts')
  const chamados: number[] = []
  const r = await quaisVenderam([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], async (c) => { chamados.push(c); return { data: c % 3 === 0 ? [{}] : [] } })
  assert.deepEqual([...r].sort((a, b) => a - b), [3, 6, 9, 12])
  assert.equal(chamados.length, 12)
})

test('opsSobrandoFaltando: com saldo por local, a OP olha o saldo do local dela', () => {
  const saldos = new Map([[1, 5], [2, -1]])
  const tipos = new Map<number, string | null>([[1, '04'], [2, '04']])
  // prato 1: total +5, mas o local 2 da OP está em -1 → não está sobrando
  // prato 2: local 3 negativo e a única OP é do local 2 → faltando
  const saldosLocal = new Map([['1:1', 6], ['1:2', -1], ['2:2', 0], ['2:3', -1]])
  const abertas = [{ id: 10, produto: 1, origem: 'cupom', local: 2 }, { id: 11, produto: 2, origem: 'manual', local: 2 }]
  const r = opsSobrandoFaltando(saldos, tipos, abertas, true, saldosLocal)
  assert.deepEqual(r.sobrando.map((o) => o.id), [])
  assert.deepEqual(r.faltando, [2])
  // OP sem local usa o total e cobre todos os locais
  const r2 = opsSobrandoFaltando(saldos, tipos, [{ id: 12, produto: 1, origem: 'cupom', local: null }, { id: 13, produto: 2, origem: 'manual', local: null }], true, saldosLocal)
  assert.deepEqual(r2.sobrando.map((o) => o.id), [12])
  assert.deepEqual(r2.faltando, [])
  // OP do cupom no local 1 (saldo 6) sobra
  const r3 = opsSobrandoFaltando(saldos, tipos, [{ id: 14, produto: 1, origem: 'cupom', local: 1 }], true, saldosLocal)
  assert.deepEqual(r3.sobrando.map((o) => o.id), [14])
})

import { contagemSuspeitaAtual } from './saude-puro.ts'
test('contagemSuspeitaAtual: só a última contagem, e só quando ela é o erro (não quando desfaz um erro)', () => {
  const c = (produto: number, ordem: number, data: string, qtd: number) => ({ produto, local: 1, data, ordem, qtd })
  const r = contagemSuspeitaAtual([
    // 1: 2 → 3.000 (vírgula) e nada depois: suspeita.
    c(1, 1, '2026-08-01', 2), c(1, 2, '2026-08-31', 3000),
    // 2: 30 → 23.500 → 33: a última desfez o erro, nada a corrigir.
    c(2, 3, '2026-08-01', 30), c(2, 4, '2026-08-20', 23500), c(2, 5, '2026-09-10', 33),
    // 3: 5.500 → 4 sem histórico antes: a anterior era ~1000× (vírgula), a última é a certa.
    c(3, 6, '2026-08-20', 5500), c(3, 7, '2026-09-10', 4),
    // 4: 2 → 2 → 3.100: estável e a última pulou.
    c(4, 8, '2026-08-01', 2), c(4, 9, '2026-08-20', 2), c(4, 10, '2026-09-10', 3100),
    // 7: 3.000 → 2 → 3.100: a última voltou ao nível de antes (o 2 era o erro): nada.
    c(7, 17, '2026-08-01', 3000), c(7, 18, '2026-08-20', 2), c(7, 19, '2026-09-10', 3100),
    // 5: o erro ficou no meio, a última bate com a anterior: nada.
    c(5, 11, '2026-08-01', 10), c(5, 12, '2026-08-20', 10000), c(5, 13, '2026-09-01', 11), c(5, 14, '2026-09-10', 12),
    // 6: 40 → 5 (caiu 8×, sem cara de vírgula): suspeita.
    c(6, 15, '2026-09-01', 40), c(6, 16, '2026-09-10', 5),
  ])
  assert.deepEqual(r.map((x) => [x.produto, x.de, x.para]), [[1, 2, 3000], [4, 2, 3100], [6, 40, 5]])
})
