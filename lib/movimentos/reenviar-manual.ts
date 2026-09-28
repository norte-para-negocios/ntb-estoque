// Envio de 1 movimento manual (ENT/SAI) ao Omie via IncluirAjusteEstoque.
// Movido de lib/actions/movimentacoes.ts (2026-09-28) para um modulo SEM
// 'use server': exportar de um arquivo de Server Actions transforma a funcao em
// endpoint publico. Aqui ela so e importada por codigo de servidor (actions,
// cron e a rota de integracao com o ntb-vendas).
import { createServiceClient } from '@/lib/supabase/server'
import { getPosicaoProduto } from '@/lib/omie/posicao-estoque'
import { omieRequest, logIntegrationAttempt, type LojaOmie } from '@/lib/omie/client'
import { dataOmieBR } from '@/lib/data-bahia'
import { registrarAuditoria } from '@/lib/auditoria'

// Valores que o Omie aceita na tag `motivo` do IncluirAjusteEstoque.
const MOTIVOS_OMIE = new Set(['INV', 'OPS', 'PER', 'PDV'])

export type MovimentoManualRow = {
  id: number
  codigo_local_estoque: number
  id_prod: number
  quan: number
  tipo: 'ENT' | 'SAI'
  /** Motivo do ajuste no Omie (INV/OPS/PER/PDV). Venda do ntb-vendas grava 'PDV'. */
  motivo?: string | null
  obs: string | null
  data: string // data de criacao do movimento (coluna `data`); vira dataOmieBR(data) no lancamento
  tentativas: number | null
}

/**
 * Reenvia ao Omie 1 movimento manual (ENT/SAI, `transferencia_id IS NULL`) ja
 * gravado em `movimentos`: busca o CMC e lanca o Ajuste de Estoque
 * (IncluirAjusteEstoque). Extraida de `criarAjusteManual` pra reuso entre o envio
 * na hora (criarAjusteManual) e o retry automatico do cron
 * (retryMovimentosManuaisPendentes), sem duplicar a chamada Omie duas vezes.
 * `mov.obs` ja vem com "<motivo digitado> · <carimbo do usuario>" (montado no
 * insert original); reusado tambem como descricao da auditoria em caso de sucesso.
 */
export async function reenviarMovimentoManual(
  mov: MovimentoManualRow,
  loja: LojaOmie,
  lojaId: number,
  opts: { auditar?: boolean } = {}
): Promise<{ id: number; status: string; erro?: string }> {
  const supabase = createServiceClient()

  try {
    const posicao = await getPosicaoProduto(loja, mov.codigo_local_estoque, mov.id_prod, dataOmieBR(null))
    const valor = posicao?.n_cmc ?? 0

    if (valor <= 0) {
      // Grava tentativas/ultima_tentativa_em tambem aqui (nao so no try/catch de
      // baixo) -- sem isso o throttle do retry automatico nunca reconhece uma
      // tentativa de 'Sem CMC' como "recente", e o cron reenviaria esse movimento a
      // cada 10 min pra sempre em vez de 1x/hora com teto (mesmo achado da Task 4
      // em lib/actions/inventario.ts -- gap que existia aqui tambem, corrigido
      // junto com esta extracao).
      await supabase
        .from('movimentos')
        .update({
          status: 'Sem CMC',
          descricao_status: 'Sem CMC',
          tentativas: (mov.tentativas ?? 0) + 1,
          ultima_tentativa_em: new Date().toISOString(),
        })
        .eq('id', mov.id)
      return { id: mov.id, status: 'Sem CMC' }
    }

    const param = {
      codigo_local_estoque: mov.codigo_local_estoque,
      id_prod: mov.id_prod,
      cod_int_ajuste: `MOV-${mov.id}`,
      data: dataOmieBR(mov.data),
      quan: mov.quan,
      valor,
      obs: mov.obs,
      origem: 'AJU',
      tipo: mov.tipo,
      motivo: mov.motivo && MOTIVOS_OMIE.has(mov.motivo) ? mov.motivo : mov.tipo,
    }

    const res = await omieRequest<{
      codigo_status?: string
      descricao_status?: string
      id_movest?: number
      id_ajuste?: number
    }>({
      loja_id: lojaId,
      omie_app_key: loja.omie_app_key,
      omie_app_secret: loja.omie_app_secret,
      is_test: loja.is_test,
      endpoint: 'v1/estoque/ajuste',
      call: 'IncluirAjusteEstoque',
      data: param,
    })

    await logIntegrationAttempt({
      loja_id: lojaId,
      model: 'Movimento',
      request: JSON.stringify(param),
      response: JSON.stringify(res),
      code: res.codigo_status ?? '200',
    })

    const sucesso = res.id_ajuste != null
    await supabase
      .from('movimentos')
      .update({
        status: sucesso ? 'Concluido' : 'Erro',
        codigo_status: res.codigo_status ?? null,
        descricao_status: res.descricao_status ?? (sucesso ? null : 'Omie nao retornou id do ajuste'),
        id_movest: res.id_movest ?? null,
        id_ajuste: res.id_ajuste ?? null,
        response: JSON.stringify(res),
        tentativas: sucesso ? 0 : (mov.tentativas ?? 0) + 1,
        ultima_tentativa_em: new Date().toISOString(),
      })
      .eq('id', mov.id)

    if (sucesso && opts.auditar !== false) await registrarAuditoria('criar', 'movimento', mov.id, `Ajuste manual ${mov.tipo} · ${mov.obs ?? ''}`)
    return { id: mov.id, status: sucesso ? 'Concluido' : 'Erro', erro: sucesso ? undefined : (res.descricao_status ?? 'Omie recusou o ajuste') }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await supabase
      .from('movimentos')
      .update({
        status: 'Erro',
        descricao_status: msg,
        tentativas: (mov.tentativas ?? 0) + 1,
        ultima_tentativa_em: new Date().toISOString(),
      })
      .eq('id', mov.id)
    await logIntegrationAttempt({ loja_id: lojaId, model: 'Movimento', request: `movimento ${mov.id}`, error: true, error_message: msg })
    return { id: mov.id, status: 'Erro', erro: msg }
  }
}

