import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estadoInicial, lerEstado, proximaLeitura, aposLeitura, historicoDesde, type ConfigFrentes, type EstadoFrentes } from './espelho-frentes.ts'

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
  assert.deepEqual(p?.cursor, { ini: '2026-10-12', fim: '2026-10-13', local: 100, pagina: 1 })
})

test('avança página, depois troca de local, depois fecha a janela', () => {
  let p = proximaLeitura(estadoInicial(), CFG, '2026-10-13', T0, LOCAIS)!
  let e = aposLeitura(p.estado, 'recente', 2, LOCAIS, CFG, '2026-10-13T15:00:00Z')
  assert.deepEqual(e.recente.cursor, { ini: '2026-10-12', fim: '2026-10-13', local: 100, pagina: 2 })
  e = aposLeitura(e, 'recente', 2, LOCAIS, CFG, '2026-10-13T15:00:00Z')
  assert.deepEqual(e.recente.cursor, { ini: '2026-10-12', fim: '2026-10-13', local: 200, pagina: 1 })
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
  assert.deepEqual(p.cursor, { ini: '2026-09-12', fim: '2026-10-11', local: 100, pagina: 1 })
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
  assert.deepEqual(p.cursor, { ini: '2026-10-11', fim: '2026-10-13', local: null, pagina: 1 })
  const e = aposLeitura(p.estado, 'recente', 3, [null], CFG, '2026-10-13T15:00:00Z')
  assert.deepEqual(e.recente.cursor, { ini: '2026-10-11', fim: '2026-10-13', local: null, pagina: 2 })
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
