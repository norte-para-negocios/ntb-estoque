// Lotes e validade do estoque próprio (migration 145). Só servidor.
// O ledger continua sendo a verdade: estoque_lotes é preenchido por um gatilho em estoque_movimentos.
import { createServiceClient } from '@/lib/supabase/server'
import type { ResultadoMovimento } from './ledger'
import { somarDias } from './validade-regras'

export type LoteValidade = {
  id: number
  codigoLocal: number
  codigoProduto: number
  lote: string | null
  validade: string | null
  saldo: number
  origem: string | null
  ref: string | null
  criadoEm: string
}

/** Entrada com lote/validade (entrada manual): a função do banco passa o lote ao gatilho dentro da mesma transação. */
export async function entradaComLote(b: {
  lojaId: number; local: number; produto: number; quantidade: number; custo?: number | null; origem: string; ref: string
  lote?: string | null; validade?: string | null; user?: string | null; obs?: string | null
}): Promise<ResultadoMovimento> {
  const { data, error } = await createServiceClient().rpc('registrar_entrada_lote', {
    p_loja: b.lojaId, p_local: b.local, p_produto: b.produto, p_quantidade: b.quantidade, p_custo: b.custo ?? null,
    p_origem: b.origem, p_ref: b.ref, p_lote: b.lote ?? null, p_validade: b.validade ?? null, p_user: b.user ?? null, p_obs: b.obs ?? null,
  })
  if (error) throw new Error(error.message)
  return data as ResultadoMovimento
}

/** Baixa por vencimento/perda de UM lote (saída com origem PERDA dirigida àquele lote). */
export async function baixarLote(b: { lojaId: number; loteId: number; quantidade: number; motivo: string; ref: string; user?: string | null }): Promise<ResultadoMovimento> {
  const { data, error } = await createServiceClient().rpc('baixar_lote', {
    p_loja: b.lojaId, p_lote_id: b.loteId, p_quantidade: b.quantidade, p_motivo: b.motivo, p_ref: b.ref, p_user: b.user ?? null,
  })
  if (error) throw new Error(error.message)
  return data as ResultadoMovimento
}

export async function alertaDiasDaLoja(lojaId: number): Promise<number> {
  const { data } = await createServiceClient().from('estoque_config').select('validade_alerta_dias').eq('loja_id', lojaId).maybeSingle()
  const n = Number((data as { validade_alerta_dias?: number } | null)?.validade_alerta_dias)
  return Number.isFinite(n) && n > 0 ? n : 7
}

/** Contagens para alertas (Início, Reposição): vencidos e vencendo até o alerta da loja, só lotes com saldo. */
export async function resumoValidade(lojaId: number, hoje: string): Promise<{ vencidos: number; vencendo: number; alertaDias: number; divergencias: number }> {
  const sb = createServiceClient()
  const alertaDias = await alertaDiasDaLoja(lojaId)
  const limite = somarDias(hoje, alertaDias)
  const [v, p, d] = await Promise.all([
    sb.from('estoque_lotes').select('id', { count: 'exact', head: true }).eq('loja_id', lojaId).gt('saldo', 0).lt('validade', hoje),
    sb.from('estoque_lotes').select('id', { count: 'exact', head: true }).eq('loja_id', lojaId).gt('saldo', 0).gte('validade', hoje).lte('validade', limite),
    sb.from('estoque_lotes_divergencia').select('codigo_produto', { count: 'exact', head: true }).eq('loja_id', lojaId),
  ])
  return { vencidos: v.count ?? 0, vencendo: p.count ?? 0, alertaDias, divergencias: d.count ?? 0 }
}
