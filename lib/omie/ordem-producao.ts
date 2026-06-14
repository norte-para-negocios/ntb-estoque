import { omieRequest, logIntegrationAttempt, type LojaOmie } from './client'
import { createServiceClient } from '@/lib/supabase/server'

interface OmieOPIdentificacao {
  nCodOP: number
  cCodIntOP: string
  cNumOP: string
  nCodProduto: number
  dDtPrevisao: string
  nQtde: number
  codigo_local_estoque: number
}

interface OmieOP {
  identificacao: OmieOPIdentificacao
  [k: string]: unknown
}

interface OmieOPResponse {
  pagina: number
  total_de_paginas: number
  cadastros?: OmieOP[]
}

export async function syncOrdensProducao(loja: LojaOmie, dataIni?: string, dataFim?: string) {
  const supabase = createServiceClient()
  await supabase.from('lojas').update({ ordem_producao_status: 'Processando' }).eq('id', loja.id)

  try {
    let pagina = 1
    let totalPaginas = 1

    do {
      const data: Record<string, unknown> = {
        pagina,
        registros_por_pagina: 100,
        ordem_decrescente: 'S',
        ordenar_por: 'dConclusao',
      }
      if (dataIni) data.dDtConclusaoDe = dataIni
      if (dataFim) data.dDtConclusaoAte = dataFim

      const res = await omieRequest<OmieOPResponse>({
        loja_id: loja.id,
        omie_app_key: loja.omie_app_key,
        omie_app_secret: loja.omie_app_secret,
        endpoint: 'v1/produtos/op',
        call: 'ListarOrdemProducao',
        data,
      })

      totalPaginas = res.total_de_paginas || 1
      const ordens = res.cadastros ?? []

      if (ordens.length) {
        const rows = ordens.map((op) => ({
          loja_id: loja.id,
          num_ordem: op.identificacao.cNumOP,
          identificacao_n_cod_op: op.identificacao.nCodOP,
          identificacao_c_cod_int_op: op.identificacao.cCodIntOP,
          identificacao_c_num_op: op.identificacao.cNumOP,
          identificacao_n_cod_produto: op.identificacao.nCodProduto,
          identificacao_d_dt_previsao: parseDate(op.identificacao.dDtPrevisao),
          identificacao_n_qtde: op.identificacao.nQtde,
          identificacao_codigo_local_estoque: op.identificacao.codigo_local_estoque,
          full_object: op,
          updated_at: new Date().toISOString(),
        }))
        await supabase
          .from('ordens_producao')
          .upsert(rows, { onConflict: 'loja_id,identificacao_n_cod_op' })
      }

      pagina++
    } while (pagina <= totalPaginas)

    await supabase
      .from('lojas')
      .update({
        ordem_producao_status: 'Concluido',
        ordem_producao_ultima_atualizacao: new Date().toISOString(),
      })
      .eq('id', loja.id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await supabase.from('lojas').update({ ordem_producao_status: 'Erro' }).eq('id', loja.id)
    await logIntegrationAttempt({
      loja_id: loja.id,
      model: 'OrdemProducao',
      request: 'syncOrdensProducao',
      error: true,
      error_message: msg,
    })
    throw e
  }
}

export async function fetchOrdemProducao(loja: LojaOmie, nCodOP: number) {
  const supabase = createServiceClient()
  const res = await omieRequest<OmieOP>({
    loja_id: loja.id,
    omie_app_key: loja.omie_app_key,
    omie_app_secret: loja.omie_app_secret,
    endpoint: 'v1/produtos/op',
    call: 'ConsultarOrdemProducao',
    data: { nCodOP },
  })
  if (res?.identificacao) {
    await supabase.from('ordens_producao').upsert(
      {
        loja_id: loja.id,
        num_ordem: res.identificacao.cNumOP,
        identificacao_n_cod_op: res.identificacao.nCodOP,
        identificacao_c_cod_int_op: res.identificacao.cCodIntOP,
        identificacao_c_num_op: res.identificacao.cNumOP,
        identificacao_n_cod_produto: res.identificacao.nCodProduto,
        identificacao_d_dt_previsao: parseDate(res.identificacao.dDtPrevisao),
        identificacao_n_qtde: res.identificacao.nQtde,
        identificacao_codigo_local_estoque: res.identificacao.codigo_local_estoque,
        full_object: res,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'loja_id,identificacao_n_cod_op' }
    )
  }
}

/**
 * Cria uma Ordem de Producao no Omie (IncluirOrdemProducao). Usa a MESMA data para
 * inicio, conclusao e previsao (no Omie as tres datas devem ser iguais; a validade
 * fica so no nosso sistema). Nao envia `itens`: o Omie monta a malha a partir da
 * ficha tecnica/estrutura do produto. Retorna { nCodOP, cNumOP } da OP criada.
 */
export async function incluirOrdemProducao(
  loja: LojaOmie,
  params: {
    cCodIntOP: string
    nCodProduto: number
    dData: string // d/m/Y (usada para inicio, conclusao e previsao)
    nQtde: number
    codigoLocalEstoque?: number | null
    obs?: string
  }
) {
  const data: Record<string, unknown> = {
    identificacao: {
      cCodIntOP: params.cCodIntOP,
      nCodProduto: params.nCodProduto,
      dDtPrevisao: params.dData,
      nQtde: params.nQtde,
      ...(params.codigoLocalEstoque ? { codigo_local_estoque: params.codigoLocalEstoque } : {}),
    },
    infAdicionais: {
      dDtInicio: params.dData,
      dDtConclusao: params.dData,
    },
    ...(params.obs ? { observacoes: { cObs: params.obs } } : {}),
  }

  return omieRequest<{ nCodOP?: number; cCodIntOP?: string; cNumOP?: string }>({
    loja_id: loja.id,
    omie_app_key: loja.omie_app_key,
    omie_app_secret: loja.omie_app_secret,
    endpoint: 'v1/produtos/op',
    call: 'IncluirOrdemProducao',
    data,
  })
}

export async function concluirOrdemProducao(
  loja: LojaOmie,
  nCodOP: number,
  dataConclusao: string, // d/m/Y
  quantidade: number,
  observacao = ''
) {
  return omieRequest({
    loja_id: loja.id,
    omie_app_key: loja.omie_app_key,
    omie_app_secret: loja.omie_app_secret,
    endpoint: 'v1/produtos/op',
    call: 'ConcluirOrdemProducao',
    data: {
      nCodOP,
      dDtConclusao: dataConclusao,
      nQtdeProduzida: quantidade,
      cObsConclusao: observacao,
    },
  })
}

function parseDate(d: string | null | undefined): string | null {
  if (!d) return null
  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}
