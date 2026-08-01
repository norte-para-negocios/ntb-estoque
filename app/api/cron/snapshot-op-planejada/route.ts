import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getLojasAtivas, assertCronAuth } from '@/lib/omie/sync-all'

export const maxDuration = 300

// Captura a quantidade PLANEJADA das OPs enquanto elas ainda estao ABERTAS
// (migration 103). Motivo: a API da Omie devolve uma quantidade so
// (identificacao.nQtde) e, ao concluir, ela passa a valer o PRODUZIDO -- o
// planejado se perde na origem, entao a comparacao previsto x produzido que a
// consultoria acompanha (aba "OPS" de OP_SVVM_JUN25) e impossivel de
// reconstruir depois. Guardando enquanto a OP esta aberta, a linha congela
// sozinha quando ela conclui (este job so mexe em OP com concluida = false).
//
// Nao chama a API da Omie: le do proprio banco, que ja tem o planejado das OPs
// abertas via sync-ops (a cada 10min). Barato, sem risco de rate limit.
export async function GET(request: Request) {
  if (!assertCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createServiceClient()
  const lojas = await getLojasAtivas()
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const PAGE = 1000

  const resumo: { loja_id: number; ops: number; erro: string | null }[] = []

  for (const loja of lojas) {
    const abertas: { identificacao_n_cod_op: number; identificacao_n_qtde: number | null; identificacao_d_dt_previsao: string | null }[] = []
    // Paginado: lojas com muita OP aberta passam do corte silencioso de 1000
    // do PostgREST (mesma classe de bug ja corrigida varias vezes no projeto).
    for (let p = 0; ; p++) {
      const { data, error } = await supabase
        .from('ordens_producao')
        .select('identificacao_n_cod_op, identificacao_n_qtde, identificacao_d_dt_previsao')
        .eq('loja_id', loja.id)
        .eq('concluida', false)
        .not('identificacao_n_cod_op', 'is', null)
        .range(p * PAGE, p * PAGE + PAGE - 1)
      if (error) {
        resumo.push({ loja_id: loja.id, ops: 0, erro: error.message })
        break
      }
      if (!data?.length) break
      abertas.push(...(data as typeof abertas))
      if (data.length < PAGE) break
    }

    if (!abertas.length) {
      if (!resumo.some((r) => r.loja_id === loja.id)) resumo.push({ loja_id: loja.id, ops: 0, erro: null })
      continue
    }

    // `primeira_vez_em` NAO entra no payload de proposito: com PostgREST, so as
    // colunas enviadas entram no SET do ON CONFLICT -- omitindo, ela e gravada
    // uma unica vez pelo default do banco (current_date) e nunca resetada. As
    // demais sao refrescadas a cada rodada enquanto a OP segue aberta (se
    // alguem editar o planejado no Omie, o snapshot acompanha ate concluir).
    const linhas = abertas.map((o) => ({
      loja_id: loja.id,
      n_cod_op: Number(o.identificacao_n_cod_op),
      qtde_planejada: o.identificacao_n_qtde,
      dt_previsao: o.identificacao_d_dt_previsao,
      ultima_vez_em: hoje,
    }))
    const { error: upErr } = await supabase
      .from('op_qtde_planejada')
      .upsert(linhas, { onConflict: 'loja_id,n_cod_op', ignoreDuplicates: false })
    resumo.push({ loja_id: loja.id, ops: linhas.length, erro: upErr?.message ?? null })
  }

  return NextResponse.json({ total_lojas: lojas.length, resumo })
}
