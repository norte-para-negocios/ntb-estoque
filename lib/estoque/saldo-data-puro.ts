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

export type MovPosterior = { n_cod_prod: number; codigo_local_estoque: number; quantidade: number; saldo_apos: number | null; cmc_apos: number | null; data_mov: string }
type Saida = { saldo: number; cmc: number; valor: number; situacao: Situacao; ultimoMov: string | null; custoSuspeito: boolean }

/**
 * Troca saldo/custo/valor/situação de cada produto pelo que valia no fim do dia escolhido. Por produto + local:
 *  1. último movimento até a data (saldo_em_data) → saldo/custo dele;
 *  2. senão, o 1º movimento depois da data (primeiro_mov_apos) → saldo antes dele = saldo_apos − quantidade
 *     (custo dele só se for saída; entrada muda o custo, aí vale o custo do produto);
 *  3. senão (nenhum movimento desde o início do histórico) → o saldo de hoje não mudou desde então.
 * Valor = soma de saldo × custo de cada local (custo fora de 0..1e7 vale 0, como na tela de hoje).
 */
export function aplicarSaldoEmData<L extends { codigoProduto: number; locais: LocalSaldo[]; minimo: number | null; cmc?: number }>(
  linhas: L[], rows: LinhaSaldoData[], nomeLocal: Map<number, string> = new Map(), posteriores: MovPosterior[] = [],
): (L & Saida)[] {
  const agrupar = <T extends { n_cod_prod: number }>(l: T[]) => {
    const m = new Map<number, T[]>()
    for (const r of l) m.set(Number(r.n_cod_prod), [...(m.get(Number(r.n_cod_prod)) ?? []), r])
    return m
  }
  const ate = agrupar(rows)
  const depois = agrupar(posteriores)
  return linhas.map((l) => {
    const rs = ate.get(l.codigoProduto) ?? []
    const ps = depois.get(l.codigoProduto) ?? []
    const recentes = [...rs].sort((a, b) => b.data_mov.localeCompare(a.data_mov))
    const cmcAteData = Number(recentes.find((r) => Number(r.cmc ?? 0) > 0)?.cmc ?? 0)
    const cmcProduto = cmcAteData || Number(l.cmc ?? 0)
    const codigos = new Set<number>([...rs.map((r) => Number(r.codigo_local_estoque)), ...ps.map((p) => Number(p.codigo_local_estoque)), ...l.locais.map((x) => x.codigoLocal)])
    const minimoLocal = new Map(l.locais.map((x) => [x.codigoLocal, x.minimo]))
    let valor = 0
    const locais: LocalSaldo[] = [...codigos].sort((a, b) => a - b).map((cod) => {
      const r = rs.find((x) => Number(x.codigo_local_estoque) === cod)
      const p = ps.find((x) => Number(x.codigo_local_estoque) === cod)
      let saldo: number
      let cmc: number
      if (r) { saldo = Number(r.saldo ?? 0); cmc = Number(r.cmc ?? 0) || cmcProduto }
      else if (p) { saldo = Number(p.saldo_apos ?? 0) - Number(p.quantidade); cmc = Number(p.quantidade) < 0 && Number(p.cmc_apos ?? 0) > 0 ? Number(p.cmc_apos) : cmcProduto }
      else { saldo = l.locais.find((x) => x.codigoLocal === cod)?.saldo ?? 0; cmc = Number(l.cmc ?? 0) }
      if (plausivel(cmc)) valor += saldo * cmc
      return {
        codigoLocal: cod, saldo, minimo: minimoLocal.get(cod) ?? null,
        local: nomeLocal.get(cod) ?? l.locais.find((x) => x.codigoLocal === cod)?.local ?? String(cod),
      }
    })
    const saldo = locais.reduce((a, x) => a + x.saldo, 0)
    return {
      ...l, locais, saldo, cmc: cmcProduto, valor, situacao: situacaoDe(saldo, l.minimo), ultimoMov: recentes[0]?.data_mov ?? null,
      custoSuspeito: cmcProduto !== 0 && !plausivel(cmcProduto),
    }
  })
}
