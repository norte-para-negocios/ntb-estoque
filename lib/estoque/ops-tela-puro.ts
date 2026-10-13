// OPs abertas (tela /ordem-producao/abertas, "nosso Omie" Fase 3): regras puras.
// Sem imports: node --test lib/estoque/ops-tela-puro.test.ts.

export const ROTULO_ORIGEM_OP: Record<string, string> = {
  vendas: 'Norte Vendas', app: 'Este app', script: 'Script', cupom: 'Cupom (PDV)', manual: 'Tela do Omie',
}

/** Dias inteiros entre a inclusão (data ou data/hora) e hoje (YYYY-MM-DD, Bahia). */
export function idadeDias(dtInclusao: string | null, hoje: string): number | null {
  const d = (dtInclusao ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null
  const n = Math.round((Date.parse(`${hoje}T12:00:00Z`) - Date.parse(`${d}T12:00:00Z`)) / 86_400_000)
  return Number.isFinite(n) ? n : null
}

/** Ficha gravada na OP (full_object.itensDetalhes do ConsultarOrdemProducao). */
export function itensDaOPGravada(fullObject: unknown): { insumo: number; quantidade: number; local: number | null }[] {
  const itens = (fullObject && typeof fullObject === 'object' ? (fullObject as { itensDetalhes?: unknown }).itensDetalhes : null)
  if (!Array.isArray(itens)) return []
  const r: { insumo: number; quantidade: number; local: number | null }[] = []
  for (const it of itens) {
    const o = it as { nIdProdutoMalha?: unknown; nQtde?: unknown; codigo_local_estoque?: unknown }
    const insumo = Number(o?.nIdProdutoMalha)
    if (!insumo) continue
    const local = Number(o.codigo_local_estoque)
    r.push({ insumo, quantidade: Number(o.nQtde ?? 0) || 0, local: local ? local : null })
  }
  return r
}

export type SituacaoOP = 'sobrando' | 'faltando' | 'ok' | null

/** Prato ainda negativo = falta concluir; OP do PDV com prato >= 0 = sobrando (pode concluir/excluir). */
export function situacaoDaOP(origem: string | null, saldoProduto: number | null): SituacaoOP {
  if (saldoProduto == null) return null
  if (saldoProduto < 0) return 'faltando'
  return origem === 'cupom' ? 'sobrando' : 'ok'
}
