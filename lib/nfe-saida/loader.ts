import { createClient } from '@/lib/supabase/server'
import type { StatusNfe } from './regras-puro'

// Leitura das NF-e de saída para as telas (sessão do usuário; RLS por loja). Sem a migration 260 devolve null.

export type NfeResumo = {
  id: number; origemTipo: string; origemId: number; tpAmb: 1 | 2; serie: number; numero: number; status: StatusNfe; chave: string | null
  cStat: string | null; xMotivo: string | null; protocolo: string | null; dhRecbto: string | null; dhEmissao: string | null
  valorTotal: number | null; destNome: string | null; enviandoDesde: string | null; cancelProtocolo: string | null; cceSeq: number
  cceUltima: string | null; criadoPor: string | null; createdAt: string
}

const COLUNAS = 'id, origem_tipo, origem_id, tp_amb, serie, numero, status, chave, c_stat, x_motivo, protocolo, dh_recbto, dh_emissao, valor_total, dest_nome, enviando_desde, cancel_protocolo, cce_seq, cce_ultima, criado_por_nome, created_at'

type Linha = Record<string, unknown>
function mapear(r: Linha): NfeResumo {
  return {
    id: Number(r.id), origemTipo: String(r.origem_tipo), origemId: Number(r.origem_id), tpAmb: Number(r.tp_amb) === 1 ? 1 : 2,
    serie: Number(r.serie), numero: Number(r.numero), status: r.status as StatusNfe, chave: (r.chave as string) ?? null,
    cStat: (r.c_stat as string) ?? null, xMotivo: (r.x_motivo as string) ?? null, protocolo: (r.protocolo as string) ?? null,
    dhRecbto: (r.dh_recbto as string) ?? null, dhEmissao: (r.dh_emissao as string) ?? null,
    valorTotal: r.valor_total == null ? null : Number(r.valor_total), destNome: (r.dest_nome as string) ?? null,
    enviandoDesde: (r.enviando_desde as string) ?? null, cancelProtocolo: (r.cancel_protocolo as string) ?? null,
    cceSeq: Number(r.cce_seq ?? 0), cceUltima: (r.cce_ultima as string) ?? null, criadoPor: (r.criado_por_nome as string) ?? null,
    createdAt: String(r.created_at),
  }
}

/** NF-e de cada documento de origem (mais recente primeiro). */
export async function nfesDasOrigens(lojaId: number, origemTipo: 'devolucao' | 'transferencia_loja', ids: number[]): Promise<Map<number, NfeResumo[]> | null> {
  const mapa = new Map<number, NfeResumo[]>()
  if (!ids.length) return mapa
  const { data, error } = await (await createClient()).from('nfe_saida').select(COLUNAS)
    .eq('loja_id', lojaId).eq('origem_tipo', origemTipo).in('origem_id', ids).order('id', { ascending: false })
  if (error) return null
  for (const r of (data ?? []) as Linha[]) {
    const n = mapear(r)
    mapa.set(n.origemId, [...(mapa.get(n.origemId) ?? []), n])
  }
  return mapa
}

export async function listarNfesSaida(lojaId: number, limite = 300): Promise<NfeResumo[] | null> {
  const { data, error } = await (await createClient()).from('nfe_saida').select(COLUNAS).eq('loja_id', lojaId).order('id', { ascending: false }).limit(limite)
  if (error) return null
  return ((data ?? []) as Linha[]).map(mapear)
}
