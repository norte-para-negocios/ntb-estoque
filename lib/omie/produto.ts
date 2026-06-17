import { omieRequest, logIntegrationAttempt, type LojaOmie } from './client'
import { createServiceClient } from '@/lib/supabase/server'

interface OmieProduto {
  codigo_produto: number
  codigo: string
  descricao: string
  codigo_familia: number
  descricao_familia: string
  tipoItem: string | null
  unidade: string
  valor_unitario: number
  inativo?: string
  bloqueado?: string
  ncm?: string
  ean?: string
}

interface OmieListarProdutosResponse {
  pagina: number
  total_de_paginas: number
  total_de_registros: number
  produto_servico_cadastro?: OmieProduto[]
}

interface OmieIncluirProdutoResp {
  codigo_produto?: number
  codigo_status?: string
  descricao_status?: string
}

/**
 * Cria um produto no Omie (Bloco 9.1). ESCREVE no Omie da loja.
 * ATENCAO (regra 9.5): confirmar os nomes exatos dos campos de escrita por teste
 * real com o Ramon antes do uso em producao.
 */
export async function incluirProduto(
  loja: LojaOmie,
  dados: {
    codigo: string
    descricao: string
    unidade: string
    ncm: string
    valorUnitario: number
    tipoItem?: string
    codigoFamilia?: number
    origem?: string // origem da mercadoria (0-8); 0 = Nacional
  }
) {
  return omieRequest<OmieIncluirProdutoResp>({
    loja_id: loja.id,
    omie_app_key: loja.omie_app_key,
    omie_app_secret: loja.omie_app_secret,
    endpoint: 'v1/geral/produtos',
    call: 'IncluirProduto',
    data: {
      codigo: dados.codigo,
      codigo_produto_integracao: dados.codigo,
      descricao: dados.descricao,
      unidade: dados.unidade,
      ncm: dados.ncm,
      valor_unitario: dados.valorUnitario,
      ...(dados.tipoItem ? { tipoItem: dados.tipoItem } : {}),
      // Familia (codigo numerico de uma familia ja existente no Omie). Resolve o
      // erro "faltou a familia" da reuniao 16/06.
      ...(dados.codigoFamilia ? { codigo_familia: dados.codigoFamilia } : {}),
      // Origem da mercadoria vai em recomendacoes_fiscais. ATENCAO (regra 9.5):
      // confirmar o caminho exato no teste real com o Ramon.
      ...(dados.origem ? { recomendacoes_fiscais: { origem_mercadoria: dados.origem } } : {}),
    },
  })
}

/**
 * Exclui um produto no Omie (Bloco 9.2 / C2). ESCREVE no Omie.
 * ATENCAO (regra 9.5): confirmar a call exata por teste real com o Ramon.
 */
export async function excluirProdutoOmie(loja: LojaOmie, codigoProduto: number) {
  return omieRequest<OmieIncluirProdutoResp>({
    loja_id: loja.id,
    omie_app_key: loja.omie_app_key,
    omie_app_secret: loja.omie_app_secret,
    endpoint: 'v1/geral/produtos',
    call: 'ExcluirProduto',
    data: { codigo_produto: codigoProduto },
  })
}

export async function syncProdutos(loja: LojaOmie) {
  const supabase = createServiceClient()
  await supabase.from('lojas').update({ produto_status: 'Processando' }).eq('id', loja.id)

  try {
    let pagina = 1
    let totalPaginas = 1

    do {
      const res = await omieRequest<OmieListarProdutosResponse>({
        loja_id: loja.id,
        omie_app_key: loja.omie_app_key,
        omie_app_secret: loja.omie_app_secret,
        endpoint: 'v1/geral/produtos',
        call: 'ListarProdutos',
        data: {
          pagina,
          registros_por_pagina: 500,
          apenas_importado_api: 'N',
          filtrar_apenas_omiepdv: 'N',
          ordem_decrescente: 'S',
        },
      })

      totalPaginas = res.total_de_paginas || 1
      const produtos = res.produto_servico_cadastro ?? []

      if (produtos.length) {
        const rows = produtos.map((p) => ({
          loja_id: loja.id,
          codigo_produto: p.codigo_produto,
          codigo: p.codigo,
          descricao: p.descricao,
          codigo_familia: p.codigo_familia,
          descricao_familia: p.descricao_familia,
          tipo_item: p.tipoItem,
          unidade: p.unidade,
          valor_unitario: p.valor_unitario,
          inativo: p.inativo === 'S',
          bloqueado: p.bloqueado === 'S',
          ncm: p.ncm || null,
          ean: p.ean || null,
          full_object: p,
          updated_at: new Date().toISOString(),
        }))
        await supabase.from('produtos').upsert(rows, { onConflict: 'codigo_produto,loja_id' })
      }

      await logIntegrationAttempt({
        loja_id: loja.id,
        model: 'Produto',
        request: JSON.stringify({ pagina, total_de_paginas: totalPaginas }),
        response: JSON.stringify({ registros: produtos.length }),
        code: '200',
      })

      pagina++
    } while (pagina <= totalPaginas)

    await supabase
      .from('lojas')
      .update({ produto_status: 'Concluido', produto_ultima_atualizacao: new Date().toISOString() })
      .eq('id', loja.id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await supabase.from('lojas').update({ produto_status: 'Erro' }).eq('id', loja.id)
    await logIntegrationAttempt({
      loja_id: loja.id,
      model: 'Produto',
      request: 'syncProdutos',
      error: true,
      error_message: msg,
    })
    throw e
  }
}
