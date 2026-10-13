// Saldo em qualquer data ("nosso Omie" Fase 2, seletor na tela /estoque): validação da data contra a cobertura do
// histórico e montagem das linhas a partir de saldo_em_data (kardex_omie). Puro: node --test lib/estoque/saldo-data-puro.test.ts.

export type MotivoDataInvalida = 'invalida' | 'futuro' | 'sem_historico' | 'antes_cobertura'
const CMC_MAX_PLAUSIVEL = 1e7

function isoValida(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** A data só vale entre o início do histórico completo (`desde`) e hoje. */
export function avaliarDataSaldo(data: string, desde: string | null, hoje: string): { ok: true } | { ok: false; motivo: MotivoDataInvalida } {
  if (!isoValida(data)) return { ok: false, motivo: 'invalida' }
  if (data > hoje) return { ok: false, motivo: 'futuro' }
  if (!desde) return { ok: false, motivo: 'sem_historico' }
  if (data < desde) return { ok: false, motivo: 'antes_cobertura' }
  return { ok: true }
}

export type LinhaSaldoData = { n_cod_prod: number; codigo_local_estoque: number; saldo: number | null; cmc: number | null; data_mov: string }
type Situacao = 'negativo' | 'zerado' | 'baixo' | 'ok'
type LocalSaldo = { codigoLocal: number; local: string; saldo: number; minimo: number | null }

function situacaoDe(saldo: number, minimo: number | null): Situacao {
  if (saldo < 0) return 'negativo'
  if (saldo === 0) return 'zerado'
  if (minimo != null && minimo > 0 && saldo < minimo) return 'baixo'
  return 'ok'
}
const plausivel = (c: number) => c > 0 && c < CMC_MAX_PLAUSIVEL

/**
 * Troca saldo/custo/valor/situação de cada produto pelo que o kardex dizia na data. Só ficam os produtos com
 * movimento até a data (os outros não têm saldo conhecido pelo kardex). Valor = soma de saldo × custo de cada local
 * (custo fora de 0..1e7 vale 0, como na tela de hoje).
 */
export function aplicarSaldoEmData<L extends { codigoProduto: number; locais: LocalSaldo[]; minimo: number | null }>(
  linhas: L[], rows: LinhaSaldoData[], nomeLocal: Map<number, string> = new Map(),
): (L & { saldo: number; cmc: number; valor: number; situacao: Situacao; ultimoMov: string; custoSuspeito: boolean })[] {
  const porProduto = new Map<number, LinhaSaldoData[]>()
  for (const r of rows) {
    const k = Number(r.n_cod_prod)
    porProduto.set(k, [...(porProduto.get(k) ?? []), r])
  }
  const out: (L & { saldo: number; cmc: number; valor: number; situacao: Situacao; ultimoMov: string; custoSuspeito: boolean })[] = []
  for (const l of linhas) {
    const rs = porProduto.get(l.codigoProduto)
    if (!rs?.length) continue
    const minimoLocal = new Map(l.locais.map((x) => [x.codigoLocal, x.minimo]))
    const locais: LocalSaldo[] = rs.map((r) => ({
      codigoLocal: Number(r.codigo_local_estoque),
      local: nomeLocal.get(Number(r.codigo_local_estoque)) ?? l.locais.find((x) => x.codigoLocal === Number(r.codigo_local_estoque))?.local ?? String(r.codigo_local_estoque),
      saldo: Number(r.saldo ?? 0),
      minimo: minimoLocal.get(Number(r.codigo_local_estoque)) ?? null,
    })).sort((a, b) => a.codigoLocal - b.codigoLocal)
    const recentes = [...rs].sort((a, b) => b.data_mov.localeCompare(a.data_mov))
    const cmc = Number(recentes.find((r) => Number(r.cmc ?? 0) > 0)?.cmc ?? 0)
    const saldo = locais.reduce((a, x) => a + x.saldo, 0)
    const valor = rs.reduce((a, r) => a + (plausivel(Number(r.cmc ?? 0)) ? Number(r.saldo ?? 0) * Number(r.cmc) : 0), 0)
    out.push({
      ...l, locais, saldo, cmc, valor, situacao: situacaoDe(saldo, l.minimo), ultimoMov: recentes[0].data_mov,
      custoSuspeito: cmc !== 0 && !plausivel(cmc),
    })
  }
  return out
}
