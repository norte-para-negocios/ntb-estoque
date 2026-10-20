import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estadoInicial, lerEstado, proximaLeitura, aposLeitura, historicoDesde, janelaFechada, type ConfigFrentes, type EstadoFrentes } from './espelho-frentes.ts'

const CFG: ConfigFrentes = { diasRecentes: 2, janelaMaxDias: 30, limite: '2026-07-01', intervaloRecenteMin: 30 }
const LOCAIS = [300, 100, 200] // fora de ordem de propósito
const T0 = Date.parse('2026-10-13T15:00:00Z')

/** Simula leituras até a frente fechar a janela; `paginas(cursor)` diz quantas páginas o Omie devolve. */
function rodar(e: EstadoFrentes, hoje: string, agoraMs: number, paginas: (c: { local: number | null; ini: string }) => number, max = 100) {
  const lidas: string[] = []
  for (let i = 0; i < max; i++) {
    const p = proximaLeitura(e, CFG, hoje, agoraMs, LOCAIS)
    if (!p) break
    lidas.push(`${p.frente}:${p.cursor.ini}..${p.cursor.fim}:${p.cursor.local}:${p.cursor.pagina}`)
    e = aposLeitura(p.estado, p.frente, paginas(p.cursor), LOCAIS, CFG, new Date(agoraMs).toISOString())
  }
  return { e, lidas }
}

test('primeira leitura abre a frente recente em [ontem, hoje] no menor local', () => {
  const p = proximaLeitura(estadoInicial(), CFG, '2026-10-13', T0, LOCAIS)
  assert.equal(p?.frente, 'recente')
  assert.deepEqual(p?.cursor, { ini: '2026-10-12', fim: '2026-10-13', local: 100, pagina: 1, iniciado_em: '2026-10-13T15:00:00.000Z', locais: [100, 200, 300] })
})

test('avança página, depois troca de local, depois fecha a janela', () => {
  let p = proximaLeitura(estadoInicial(), CFG, '2026-10-13', T0, LOCAIS)!
  let e = aposLeitura(p.estado, 'recente', 2, LOCAIS, CFG, '2026-10-13T15:00:00Z')
  assert.deepEqual(e.recente.cursor, { ini: '2026-10-12', fim: '2026-10-13', local: 100, pagina: 2, iniciado_em: '2026-10-13T15:00:00.000Z', avancado_em: '2026-10-13T15:00:00Z', locais: [100, 200, 300] })
  e = aposLeitura(e, 'recente', 2, LOCAIS, CFG, '2026-10-13T15:00:00Z')
  assert.deepEqual(e.recente.cursor, { ini: '2026-10-12', fim: '2026-10-13', local: 200, pagina: 1, iniciado_em: '2026-10-13T15:00:00.000Z', avancado_em: '2026-10-13T15:00:00Z', locais: [100, 200, 300] })
  e = aposLeitura(e, 'recente', 0, LOCAIS, CFG, '2026-10-13T15:00:00Z') // local vazio ("não existem registros")
  assert.equal(e.recente.cursor?.local, 300)
  e = aposLeitura(e, 'recente', 1, LOCAIS, CFG, '2026-10-13T15:00:00Z')
  assert.equal(e.recente.cursor, null)
  assert.equal(e.recente.coberto_ate, '2026-10-13')
  assert.equal(e.recente.desde, '2026-10-12')
  assert.equal(e.recente.concluido_em, '2026-10-13T15:00:00Z')
  assert.equal(e.backfill.proximo_fim, '2026-10-11')
  p = proximaLeitura(e, CFG, '2026-10-13', T0, LOCAIS)!
  assert.equal(p.frente, 'backfill')
  assert.deepEqual(p.cursor, { ini: '2026-09-12', fim: '2026-10-11', local: 100, pagina: 1, iniciado_em: '2026-10-13T15:00:00.000Z', locais: [100, 200, 300] })
})

test('frente recente espera o intervalo antes de reler o mesmo dia', () => {
  const { e } = rodar(estadoInicial(), '2026-10-13', T0, () => 1, 3)
  assert.equal(e.recente.coberto_ate, '2026-10-13')
  const cedo = proximaLeitura(e, CFG, '2026-10-13', T0 + 10 * 60_000, LOCAIS)
  assert.equal(cedo?.frente, 'backfill')
  const depois = proximaLeitura(e, CFG, '2026-10-13', T0 + 31 * 60_000, LOCAIS)
  assert.equal(depois?.frente, 'recente')
  assert.equal(depois?.cursor.ini, '2026-10-12')
})

test('virada do dia reabre a frente recente sem esperar o intervalo', () => {
  const { e } = rodar(estadoInicial(), '2026-10-13', T0, () => 1, 3)
  const p = proximaLeitura(e, CFG, '2026-10-14', T0 + 60_000, LOCAIS)
  assert.equal(p?.frente, 'recente')
  assert.deepEqual([p?.cursor.ini, p?.cursor.fim], ['2026-10-13', '2026-10-14'])
})

test('cron parado 40 dias: recupera o buraco em janelas de até 30 dias, sem esperar intervalo', () => {
  const { e } = rodar(estadoInicial(), '2026-09-01', T0, () => 1, 3)
  assert.equal(e.recente.coberto_ate, '2026-09-01')
  let p = proximaLeitura(e, CFG, '2026-10-11', T0 + 60_000, LOCAIS)!
  assert.deepEqual([p.frente, p.cursor.ini, p.cursor.fim], ['recente', '2026-09-01', '2026-09-30'])
  let e2 = p.estado
  for (const _ of LOCAIS) e2 = aposLeitura(e2, 'recente', 1, LOCAIS, CFG, new Date(T0 + 60_000).toISOString())
  assert.equal(e2.recente.coberto_ate, '2026-09-30')
  p = proximaLeitura(e2, CFG, '2026-10-11', T0 + 120_000, LOCAIS)!
  assert.deepEqual([p.frente, p.cursor.ini, p.cursor.fim], ['recente', '2026-09-30', '2026-10-11'])
})

test('backfill desce até o limite e marca concluído', () => {
  const { e, lidas } = rodar(estadoInicial(), '2026-08-15', T0, () => 1)
  assert.equal(e.backfill.concluido, true)
  assert.equal(e.backfill.coberto_desde, '2026-07-01')
  assert.equal(historicoDesde(e), '2026-07-01')
  // [08-14..08-15] recente; backfill [07-15..08-13] e [07-01..07-14]; 3 locais cada
  assert.equal(lidas.length, 9)
  assert.ok(lidas.includes('backfill:2026-07-01..2026-07-14:300:1'))
  assert.equal(proximaLeitura(e, CFG, '2026-08-15', T0 + 1000, LOCAIS), null)
})

test('backfill já abaixo do limite conclui sem ler nada', () => {
  const { e, lidas } = rodar(estadoInicial(), '2026-07-02', T0, () => 1)
  assert.equal(lidas.length, 3)
  assert.equal(e.backfill.concluido, true)
  assert.equal(historicoDesde(e), '2026-07-01')
})

test('sem locais não há leitura', () => {
  assert.equal(proximaLeitura(estadoInicial(), CFG, '2026-10-13', T0, []), null)
})

test('frente sem local (ajustes): uma passada por janela', () => {
  const p = proximaLeitura(estadoInicial(), { ...CFG, diasRecentes: 3 }, '2026-10-13', T0, [null])!
  assert.deepEqual(p.cursor, { ini: '2026-10-11', fim: '2026-10-13', local: null, pagina: 1, iniciado_em: '2026-10-13T15:00:00.000Z' })
  const e = aposLeitura(p.estado, 'recente', 3, [null], CFG, '2026-10-13T15:00:00Z')
  assert.deepEqual(e.recente.cursor, { ini: '2026-10-11', fim: '2026-10-13', local: null, pagina: 2, iniciado_em: '2026-10-13T15:00:00.000Z', avancado_em: '2026-10-13T15:00:00Z' })
})

test('local atual saiu da lista: segue para o próximo código maior', () => {
  const p = proximaLeitura(estadoInicial(), CFG, '2026-10-13', T0, LOCAIS)!
  const e = aposLeitura(p.estado, 'recente', 1, [200, 300], CFG, '2026-10-13T15:00:00Z')
  assert.equal(e.recente.cursor?.local, 200)
})

test('lerEstado tolera jsonb vazio, nulo ou faltando partes', () => {
  assert.deepEqual(lerEstado({}), estadoInicial())
  assert.deepEqual(lerEstado(null), estadoInicial())
  assert.equal(lerEstado({ recente: { coberto_ate: '2026-10-01' } }).recente.coberto_ate, '2026-10-01')
  assert.equal(lerEstado({ recente: { coberto_ate: '2026-10-01' } }).backfill.concluido, false)
})

test('historicoDesde antes do backfill = início da 1ª janela recente', () => {
  const { e } = rodar(estadoInicial(), '2026-10-13', T0, () => 1, 3)
  assert.equal(historicoDesde(e), '2026-10-12')
  assert.equal(historicoDesde(estadoInicial()), null)
})

// Revisão (achado da revisão final): movimento lançado HOJE com data de 10 dias atrás cai fora da frente recente e
// o backfill já passou daquela data; a revisão relê os últimos `diasRevisao` dias já cobertos 1x a cada 24 h.
const CFG_REV: ConfigFrentes = { ...CFG, diasRevisao: 35, intervaloRevisaoHoras: 24 }
const coberto = (hoje: string, desde: string): EstadoFrentes => ({
  ...estadoInicial(),
  recente: { cursor: null, coberto_ate: hoje, concluido_em: new Date(T0).toISOString(), desde: '2026-10-12' },
  backfill: { cursor: null, proximo_fim: '2026-08-01', coberto_desde: desde, concluido: false },
})

test('revisão relê os últimos 35 dias já cobertos, em janelas de até 30 dias, antes do backfill', () => {
  let e = coberto('2026-10-13', '2026-08-02')
  let p = proximaLeitura(e, CFG_REV, '2026-10-13', T0 + 60_000, [100])!
  assert.equal(p.frente, 'revisao')
  assert.deepEqual([p.cursor.ini, p.cursor.fim, p.cursor.local], ['2026-09-08', '2026-10-07', 100])
  assert.equal(p.cursor.iniciado_em, new Date(T0 + 60_000).toISOString())
  e = aposLeitura(p.estado, 'revisao', 1, [100], CFG_REV, '2026-10-13T15:01:00Z')
  assert.equal(janelaFechada('revisao', p.cursor, e), true)
  p = proximaLeitura(e, CFG_REV, '2026-10-13', T0 + 120_000, [100])!
  assert.deepEqual([p.frente, p.cursor.ini, p.cursor.fim], ['revisao', '2026-10-08', '2026-10-11'])
  e = aposLeitura(p.estado, 'revisao', 1, [100], CFG_REV, '2026-10-13T15:02:00Z')
  assert.equal(e.revisao.cursor, null)
  assert.equal(e.revisao.concluido_em, '2026-10-13T15:02:00Z')
  p = proximaLeitura(e, CFG_REV, '2026-10-13', T0 + 180_000, [100])!
  assert.equal(p.frente, 'backfill')
  const dia = proximaLeitura({ ...e, backfill: { ...e.backfill, concluido: true } }, CFG_REV, '2026-10-14', T0 + 25 * 3_600_000, [100])
  assert.equal(dia?.frente, 'recente')
})

test('revisão só cobre o que o histórico já tem (nunca antes de historicoDesde nem do limite)', () => {
  const p = proximaLeitura(coberto('2026-10-13', '2026-10-01'), CFG_REV, '2026-10-13', T0 + 60_000, [100])!
  assert.deepEqual([p.frente, p.cursor.ini, p.cursor.fim], ['revisao', '2026-10-01', '2026-10-11'])
  const nada = proximaLeitura({ ...estadoInicial(), recente: { cursor: null, coberto_ate: '2026-10-13', concluido_em: new Date(T0).toISOString(), desde: '2026-10-12' } },
    CFG_REV, '2026-10-13', T0 + 60_000, [100])
  assert.notEqual(nada?.frente, 'revisao')
})

test('sem diasRevisao a revisão fica desligada', () => {
  const p = proximaLeitura(coberto('2026-10-13', '2026-08-02'), CFG, '2026-10-13', T0 + 60_000, [100])
  assert.equal(p?.frente, 'backfill')
})

test('janelaFechada: falso enquanto a mesma janela continua', () => {
  const p = proximaLeitura(coberto('2026-10-13', '2026-08-02'), CFG_REV, '2026-10-13', T0 + 60_000, [100, 200])!
  const e = aposLeitura(p.estado, 'revisao', 1, [100, 200], CFG_REV, '2026-10-13T15:01:00Z')
  assert.equal(janelaFechada('revisao', p.cursor, e), false)
})
