// Financeiro A0: ordem das ações do cron da API, varredura de abertos, conferência e erro sem repetição sem teto.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ABERTOS_MAX_H, MAX_CONFERIR_POR_CICLO, aposAcao, aposErro, chamaOmie, coberturaFin, estadoFinInicial, lerEstadoFin, proximaAcao,
  type Acao, type EstadoFin,
} from './planejador.ts'

const H = 3_600_000
const T0 = Date.parse('2026-10-27T13:00:00Z') // 10 h na Bahia
const iso = (ms: number) => new Date(ms).toISOString()
const HOJE = '2026-10-27'

/** Executa ações "com sucesso" até `n` ou nada a fazer; `total(a)` = páginas da resposta. */
function rodar(e: EstadoFin, agoraMs: number, n: number, total: (a: Acao) => number = () => 1, extra: Partial<Parameters<typeof aposAcao>[3]> = {}) {
  const feitas: Acao[] = []
  for (let i = 0; i < n; i++) {
    const a = proximaAcao(e, HOJE, agoraMs)
    if (!a) break
    feitas.push(a)
    e = aposAcao(e, a, iso(agoraMs), { total: total(a), ...extra })
  }
  return { e, feitas }
}

test('estado vazio: cadastros primeiro, depois títulos e baixas recentes, depois varredura de abertos e backfill', () => {
  const { e, feitas } = rodar(estadoFinInicial(), T0, 9, (a) => (a.tipo === 'categorias' ? 3 : 1), { contasAtivas: [11, 12] })
  assert.deepEqual(feitas.map((a) => a.tipo), ['categorias', 'categorias', 'categorias', 'dre', 'contas', 'titulos', 'baixas', 'saldo', 'saldo'])
  const t = feitas[5] as Extract<Acao, { tipo: 'titulos' }>
  assert.equal(t.frente, 'recente')
  assert.equal(t.cursor.ini, '2026-10-26')
  assert.equal(t.cursor.fim, HOJE)
  assert.equal(t.cursor.local, null)
  assert.ok(e.cadastros.categorias_em && e.cadastros.contas_em && e.cadastros.dre_em)
  const prox = proximaAcao(e, HOJE, T0)
  assert.equal(prox?.tipo, 'abertos')
  const e2 = aposAcao(e, prox!, iso(T0), { total: 2 })
  assert.deepEqual([e2.abertos.pagina, e2.abertos.iniciado_em], [2, iso(T0)])
  const e3 = aposAcao(e2, { tipo: 'abertos', pagina: 2, iniciado_em: iso(T0) }, iso(T0 + 60_000), { total: 2 })
  assert.equal(e3.abertos.pagina, null)
  assert.equal(e3.abertos.buscar_sumidos_desde, iso(T0), 'varredura completa → buscar os que sumiram')
  const b = proximaAcao(e3, HOJE, T0 + 60_000)
  assert.deepEqual(b, { tipo: 'buscar-sumidos', desde: iso(T0) })
  assert.equal(chamaOmie(b!), false)
  const e4 = aposAcao(e3, b!, iso(T0), { sumidos: [{ c: 7, n: 'P' }, { c: 8, n: 'R' }] })
  assert.equal(e4.abertos.buscar_sumidos_desde, null)
  assert.deepEqual(proximaAcao(e4, HOJE, T0), { tipo: 'conferir', pendente: { c: 7, n: 'P' } })
  // conferência tem teto por ciclo; depois vai para o backfill
  const semConferir = proximaAcao(e4, HOJE, T0, { conferidos: MAX_CONFERIR_POR_CICLO })
  assert.equal(semConferir?.tipo, 'titulos')
  assert.equal((semConferir as Extract<Acao, { tipo: 'titulos' }>).frente, 'backfill')
  const e5 = aposAcao(e4, { tipo: 'conferir', pendente: { c: 7, n: 'P' } }, iso(T0))
  assert.deepEqual(e5.conferir.pendentes, [{ c: 8, n: 'R' }])
})

test('backfill desce em janelas de alteração até 2026-07-01 e para', () => {
  let e = estadoFinInicial()
  e = { ...e, cadastros: { ...e.cadastros, categorias_em: iso(T0), dre_em: iso(T0), contas_em: iso(T0) }, abertos: { ...e.abertos, concluido_em: iso(T0) } }
  const janelas: string[] = []
  for (let i = 0; i < 40; i++) {
    const a = proximaAcao(e, HOJE, T0)
    if (!a) break
    if (a.tipo === 'titulos' && a.frente === 'backfill') janelas.push(`${a.cursor.ini}..${a.cursor.fim}`)
    e = aposAcao(e, a, iso(T0), { total: 1 })
  }
  assert.equal(janelas[0], '2026-10-11..2026-10-25')
  assert.equal(janelas[janelas.length - 1].slice(0, 10), '2026-07-01')
  assert.equal(e.titulos.backfill.concluido, true)
  assert.equal(e.baixas.backfill.concluido, true)
  assert.equal(proximaAcao(e, HOJE, T0), null, 'tudo lido: nada a fazer até vencer a próxima leitura recente')
  assert.equal(proximaAcao(e, HOJE, T0 + 3 * H)?.tipo, 'titulos', 'recente de novo a cada 3 h')
  assert.deepEqual(coberturaFin(e), { titulosDesde: '2026-07-01', baixasDesde: '2026-07-01', lidoAte: HOJE, abertosEm: iso(T0) })
})

test('varredura de abertos parada há muito tempo recomeça da página 1', () => {
  let e = estadoFinInicial()
  e = { ...e, cadastros: { ...e.cadastros, categorias_em: iso(T0), dre_em: iso(T0), contas_em: iso(T0) } }
  e = { ...e, titulos: { ...e.titulos, recente: { ...e.titulos.recente, coberto_ate: HOJE, concluido_em: iso(T0) } } }
  e = { ...e, baixas: { ...e.baixas, recente: { ...e.baixas.recente, coberto_ate: HOJE, concluido_em: iso(T0) } } }
  e = { ...e, abertos: { pagina: 40, iniciado_em: iso(T0 - 20 * H), avancado_em: iso(T0 - (ABERTOS_MAX_H + 1) * H), concluido_em: null, buscar_sumidos_desde: null } }
  assert.deepEqual(proximaAcao(e, HOJE, T0), { tipo: 'abertos', pagina: 1, iniciado_em: iso(T0) })
  const recente = { ...e, abertos: { ...e.abertos, avancado_em: iso(T0 - H) } }
  assert.deepEqual(proximaAcao(recente, HOJE, T0), { tipo: 'abertos', pagina: 40, iniciado_em: iso(T0 - 20 * H) })
})

test('erro do Omie: janela conta falha; conferir/saldo saem da fila; página de cadastro fica (a guarda espera)', () => {
  const e0 = rodar(estadoFinInicial(), T0, 3, () => 1, { contasAtivas: [11] }).e
  const a = proximaAcao(e0, HOJE, T0)!
  assert.equal(a.tipo, 'titulos')
  const f1 = aposErro(e0, a, 'erro do Omie: x', iso(T0), false)
  assert.equal(f1.titulos.recente.cursor?.falhas, 1)
  assert.equal(aposErro(e0, a, 'timeout', iso(T0), true).titulos.recente.cursor?.falhas, undefined, 'transitório não conta')
  const s = { tipo: 'saldo', conta: 11 } as const
  assert.deepEqual(aposErro(e0, s, 'conta sem extrato', iso(T0), false).saldos.pendentes, [])
  assert.deepEqual(aposErro(e0, s, 'timeout', iso(T0), true).saldos.pendentes, [11])
  const cat = { tipo: 'categorias', pagina: 2 } as const
  assert.equal(aposErro(e0, cat, 'x', iso(T0), false), e0)
})

test('lerEstadoFin tolera lixo e preserva o gravado', () => {
  const e = lerEstadoFin({ conferir: { pendentes: [{ c: 5, n: 'P' }, { c: 'x', n: 'P' }, { c: 6, n: 'Z' }] }, saldos: { pendentes: [1, -2, 'a'] }, cadastros: { categorias_pagina: 0 } })
  assert.deepEqual(e.conferir.pendentes, [{ c: 5, n: 'P' }])
  assert.deepEqual(e.saldos.pendentes, [1])
  assert.equal(e.cadastros.categorias_pagina, null)
  const ida = rodar(estadoFinInicial(), T0, 6).e
  assert.deepEqual(lerEstadoFin(JSON.parse(JSON.stringify(ida))), ida)
  assert.deepEqual(lerEstadoFin(null), estadoFinInicial())
})
