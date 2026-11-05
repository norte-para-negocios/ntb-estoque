// Confere a SQL reprocessar_custo (312) contra o espelho em TS (lib/estoque/reprocessar-custo-puro.ts) no volume sintético
// (scripts/testes-sql/312_volume_sintetico.sql). Só na CÓPIA local. Uso:
//   PSQL_ANTES="psql ... -d vol_bkp" PSQL_DEPOIS="psql ... -d vol" node scripts/testes-sql/312_comparar_ts.mjs
// vol_bkp = cópia do banco ANTES do reprocessamento; vol = depois de reprocessar_custo(99330, 1..60, '2026-10-13', …).
// Sai com código 1 se algum movimento divergir.
import { execSync } from 'node:child_process'
import { refazerCadeia, valorConsumosDaOP, consumoEstimadoDaOP } from '../../lib/estoque/reprocessar-custo-puro.ts'

const LOJA = 99330
const sql = `select coalesce(json_agg(json_build_object('id', e.id, 'data', e.data_ref, 'local', e.codigo_local_estoque, 'produto', e.codigo_produto,
  'tipo', e.tipo, 'origem', e.origem, 'ref', e.ref, 'quantidade', e.quantidade, 'custoOriginal', e.custo_original, 'custo', e.custo_unitario,
  'cmc', e.cmc_apos, 'saldo', e.saldo_apos, 'saldoTotal', e.saldo_total_apos, 'estimado', e.custo_estimado, 'reversesId', e.reverses_id,
  'consumo', (e.tipo = 'PRD' and e.quantidade < 0) or exists (select 1 from estoque_receita_consumos rc where rc.movimento_id = e.id))
  order by e.id), '[]') from estoque_movimentos_efetivo e where e.loja_id = ${LOJA}`
const ler = (cmd) => JSON.parse(execSync(`${cmd} -At`, { input: sql, maxBuffer: 1 << 28 }).toString()).map((m) => ({
  ...m, quantidade: Number(m.quantidade), custoOriginal: m.custoOriginal == null ? null : Number(m.custoOriginal),
  custo: m.custo == null ? null : Number(m.custo), cmc: m.cmc == null ? null : Number(m.cmc), saldo: Number(m.saldo), saldoTotal: Number(m.saldoTotal),
}))

const antes = ler(process.env.PSQL_ANTES)
const depois = new Map(ler(process.env.PSQL_DEPOIS).map((m) => [m.id, m]))

// ordem do volume sintético: insumos (1-60), PIs (61-80), pratos (81-120)
const porProduto = new Map()
for (const m of antes) { if (!porProduto.has(m.produto)) porProduto.set(m.produto, []); porProduto.get(m.produto).push(m) }
const efetivo = new Map(antes.map((m) => [m.id, { ...m }]))
for (const p of [...porProduto.keys()].sort((a, b) => a - b)) {
  const movs = porProduto.get(p)
  const r = refazerCadeia(movs, { saldo: 0, cmc: 0 }, {
    valorConsumoOP: (ref) => valorConsumosDaOP([...efetivo.values()].filter((x) => x.ref === ref), ref),
    consumoEstimadoOP: (ref) => consumoEstimadoDaOP([...efetivo.values()].filter((x) => x.ref === ref), ref),
  })
  for (const rv of r.revisoes) Object.assign(efetivo.get(rv.id), { custo: rv.custo, cmc: rv.cmc, saldo: rv.saldo, saldoTotal: rv.saldoTotal, estimado: rv.estimado })
}

let dif = 0
for (const [id, t] of efetivo) {
  const s = depois.get(id)
  const igual = s && s.custo === t.custo && s.cmc === t.cmc && s.saldo === t.saldo && s.saldoTotal === t.saldoTotal && s.estimado === t.estimado
  if (!igual) { if (dif < 10) console.log('DIVERGE', id, { ts: t, sql: s }); dif++ }
}
console.log(`${efetivo.size} movimentos comparados, ${dif} divergências`)
process.exit(dif ? 1 : 0)
