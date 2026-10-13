// OPs abertas da loja (Saúde do estoque e tela /ordem-producao/abertas).
import { createClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { lojaEspelho } from './dados-comum'

export type OPAbertaRow = {
  id: number
  num_ordem: string | null
  identificacao_c_num_op: string | null
  identificacao_c_cod_int_op: string | null
  identificacao_n_cod_op: number | null
  identificacao_n_cod_produto: number | null
  identificacao_n_qtde: number | null
  quantidade: number | null
  identificacao_d_dt_previsao: string | null
  identificacao_codigo_local_estoque: number | null
  dt_inclusao: string | null
  created_at: string | null
  origem_op: string | null
  incluido_por_omie: string | null
  obs_omie: string | null
  criada_por: string | null
  venda_ref: string | null
  itens_consultados_em: string | null
  full_object: unknown
}

const COLS_BASE = 'id, num_ordem, identificacao_c_num_op, identificacao_c_cod_int_op, identificacao_n_cod_op, identificacao_n_cod_produto, identificacao_n_qtde, quantidade, identificacao_d_dt_previsao, identificacao_codigo_local_estoque, dt_inclusao, created_at, full_object'
const COLS_160 = 'origem_op, incluido_por_omie, obs_omie, itens_consultados_em'
const COLS_136 = 'criada_por, venda_ref'

/**
 * Loja Omie com espelho completo: as OPs que o cron sync-ops-abertas viu abertas no Omie (`aberta_omie = true`).
 * Loja Omie sem a flag: `concluida = false` (o que o sync-ops já trouxe; pode faltar OP antiga) e `completa = false`.
 * Loja própria: `concluida = false` (autor em criada_por).
 */
export async function carregarOPsAbertas(lojaId: number, modo: 'omie' | 'proprio'): Promise<{ ops: OPAbertaRow[]; completa: boolean; erro: string | null }> {
  const supabase = await createClient()
  const espelho = modo === 'omie' ? (await lojaEspelho(lojaId)).espelhoCompleto : false
  let erro: string | null = null
  const ler = (cols: string, soEspelho: boolean) => buscarTodasLinhas<OPAbertaRow>((from, to) => {
    let q = supabase.from('ordens_producao').select(cols).eq('loja_id', lojaId)
    q = soEspelho ? q.eq('aberta_omie', true) : q.eq('concluida', false)
    return q.order('id').range(from, to) as unknown as PromiseLike<{ data: OPAbertaRow[] | null; error: { message: string } | null }>
  }, undefined, (e) => { erro = e.message })

  let ops = await ler(`${COLS_BASE}, ${COLS_136}, ${COLS_160}`, espelho)
  if (erro && !espelho) {
    // Migration 160 ainda não aplicada: lê sem as colunas novas.
    erro = null
    ops = await ler(`${COLS_BASE}, ${COLS_136}`, false)
  }
  return { ops, completa: modo === 'proprio' || espelho, erro }
}
