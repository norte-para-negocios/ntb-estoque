// T5.3 (Fase 5): consumo teórico × real por insumo. Módulo puro (sem imports @/) para rodar em `node --test`.
// A conta é da função SQL consumo_teorico_real (migration 400); aqui só normaliza, soma e ordena para a tela.
//   teórico = venda (baixa pela ficha) + consumo de OP
//   real    = contagem inicial + entradas − contagem final (só com duas contagens no período)
//   desvio  = real − teórico; em R$ pelo custo efetivo. Desvio > 0 = faltou (saiu mais que a ficha manda); < 0 = sobrou.

export type LinhaConsumoDb = {
  codigo_local_estoque: number | string
  codigo_produto: number | string
  situacao: 'ok' | 'sem_contagem'
  contagens: number | string
  inventario_ini: number | string | null
  inventario_fim: number | string | null
  contado_ini_em: string | null
  contado_fim_em: string | null
  saldo_ini: number | string | null
  saldo_fim: number | string | null
  entradas: number | string | null
  teorico_venda: number | string
  teorico_op: number | string
  teorico: number | string
  ajustes_perdas: number | string
  consumo_real: number | string | null
  desvio: number | string | null
  custo_unitario: number | string | null
  custo_estimado: boolean | null
  teorico_valor: number | string | null
  real_valor: number | string | null
  desvio_valor: number | string | null
}

export type LinhaConsumo = {
  local: number
  produto: number
  situacao: 'ok' | 'sem_contagem'
  contagens: number
  inventarioIni: number | null
  inventarioFim: number | null
  contadoIniEm: string | null
  contadoFimEm: string | null
  saldoIni: number | null
  saldoFim: number | null
  entradas: number | null
  teoricoVenda: number
  teoricoOp: number
  teorico: number
  ajustesPerdas: number
  consumoReal: number | null
  desvio: number | null
  custoUnitario: number | null
  custoEstimado: boolean
  teoricoValor: number
  realValor: number | null
  desvioValor: number | null
}

const n = (v: number | string | null | undefined): number | null => (v == null || v === '' ? null : Number(v))
const z = (v: number | string | null | undefined): number => n(v) ?? 0

export function normalizarConsumo(rows: LinhaConsumoDb[]): LinhaConsumo[] {
  return rows.map((r) => ({
    local: Number(r.codigo_local_estoque), produto: Number(r.codigo_produto), situacao: r.situacao, contagens: Number(r.contagens) || 0,
    inventarioIni: n(r.inventario_ini), inventarioFim: n(r.inventario_fim), contadoIniEm: r.contado_ini_em, contadoFimEm: r.contado_fim_em,
    saldoIni: n(r.saldo_ini), saldoFim: n(r.saldo_fim), entradas: n(r.entradas),
    teoricoVenda: z(r.teorico_venda), teoricoOp: z(r.teorico_op), teorico: z(r.teorico), ajustesPerdas: z(r.ajustes_perdas),
    consumoReal: n(r.consumo_real), desvio: n(r.desvio), custoUnitario: n(r.custo_unitario), custoEstimado: r.custo_estimado === true,
    teoricoValor: z(r.teorico_valor), realValor: n(r.real_valor), desvioValor: n(r.desvio_valor),
  }))
}

const r2 = (v: number) => Math.round(v * 100) / 100

export type ResumoConsumo = {
  comContagem: number
  semContagem: number
  teoricoValor: number
  realValor: number
  desvioValor: number
  faltaValor: number
  sobraValor: number
  teoricoSemContagemValor: number
}

export function resumoConsumo(linhas: LinhaConsumo[]): ResumoConsumo {
  const r: ResumoConsumo = { comContagem: 0, semContagem: 0, teoricoValor: 0, realValor: 0, desvioValor: 0, faltaValor: 0, sobraValor: 0, teoricoSemContagemValor: 0 }
  for (const l of linhas) {
    if (l.situacao !== 'ok') {
      r.semContagem++
      r.teoricoSemContagemValor += l.teoricoValor
      continue
    }
    r.comContagem++
    r.teoricoValor += l.teoricoValor
    r.realValor += l.realValor ?? 0
    const d = l.desvioValor ?? 0
    r.desvioValor += d
    if (d > 0) r.faltaValor += d
    else r.sobraValor += -d
  }
  for (const k of ['teoricoValor', 'realValor', 'desvioValor', 'faltaValor', 'sobraValor', 'teoricoSemContagemValor'] as const) r[k] = r2(r[k])
  return r
}

/** Maiores desvios em R$ (valor absoluto), só das linhas com contagem no começo e no fim. */
export function maioresDesvios(linhas: LinhaConsumo[], limite = 10): LinhaConsumo[] {
  return linhas
    .filter((l) => l.situacao === 'ok' && l.desvioValor != null)
    .sort((a, b) => Math.abs(b.desvioValor!) - Math.abs(a.desvioValor!) || a.produto - b.produto)
    .slice(0, limite)
}

export type EstadoTelaConsumo = 'erro' | 'vazio' | 'sem_contagem' | 'ok'

export function estadoTelaConsumo(linhas: LinhaConsumo[], erro: string | null): EstadoTelaConsumo {
  if (erro) return 'erro'
  if (linhas.length === 0) return 'vazio'
  return linhas.some((l) => l.situacao === 'ok') ? 'ok' : 'sem_contagem'
}

export function textoSemContagem(contagens: number): string {
  return contagens >= 1 ? 'Só 1 contagem no período: falta a do começo ou a do fim' : 'Sem contagem no período'
}
