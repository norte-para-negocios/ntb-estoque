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
// Campos confirmados por teste real no Omie (criar+consultar+excluir, 16/06):
// ean/marca/modelo/peso/dimensoes/descr_detalhada/obs_internas sao top-level;
// origem e CEST ficam em recomendacoes_fiscais; CFOP e top-level.
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
    ean?: string
    descrDetalhada?: string
    obsInternas?: string
    marca?: string
    modelo?: string
    pesoLiq?: number
    pesoBruto?: number
    altura?: number
    largura?: number
    profundidade?: number
    cest?: string // recomendacoes_fiscais.id_cest
  }
) {
  const fiscais: Record<string, string> = {}
  if (dados.origem) fiscais.origem_mercadoria = dados.origem
  if (dados.cest) fiscais.id_cest = dados.cest

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
      ...(dados.codigoFamilia ? { codigo_familia: dados.codigoFamilia } : {}),
      ...(dados.ean ? { ean: dados.ean } : {}),
      ...(dados.descrDetalhada ? { descr_detalhada: dados.descrDetalhada } : {}),
      ...(dados.obsInternas ? { obs_internas: dados.obsInternas } : {}),
      ...(dados.marca ? { marca: dados.marca } : {}),
      ...(dados.modelo ? { modelo: dados.modelo } : {}),
      ...(dados.pesoLiq ? { peso_liq: dados.pesoLiq } : {}),
      ...(dados.pesoBruto ? { peso_bruto: dados.pesoBruto } : {}),
      ...(dados.altura ? { altura: dados.altura } : {}),
      ...(dados.largura ? { largura: dados.largura } : {}),
      ...(dados.profundidade ? { profundidade: dados.profundidade } : {}),
      ...(Object.keys(fiscais).length ? { recomendacoes_fiscais: fiscais } : {}),
    },
  })
}

/**
 * Altera um produto no Omie (Bloco 0.3). ESCREVE no Omie.
 * O identificador e codigo_produto (nCodProd, ID interno Omie, campo "codigo_produto"
 * na tabela produtos do NTB). Apenas os campos presentes no payload sao alterados;
 * campos omitidos NAO sao zerados pelo Omie.
 * ATENCAO: confirmar payload exato por teste real com o Ramon (criar+alterar+excluir
 * antes de usar em producao).
 */
export async function alterarProduto(
  loja: LojaOmie,
  dados: {
    codigoProduto: number // nCodProd (codigo_produto na tabela produtos)
    descricao: string
    unidade: string
    ncm?: string | null
    valorUnitario?: number | null
    tipoItem?: string | null
    codigoFamilia?: number | null
    inativo?: boolean
  }
) {
  const fiscais: Record<string, unknown> = {}
  // recomendacoes_fiscais so entra se houver algum campo fiscal a alterar.
  // Por ora nao mapeamos origem/CEST na edicao, pois o formulario nao os expoe.

  return omieRequest<OmieIncluirProdutoResp>({
    loja_id: loja.id,
    omie_app_key: loja.omie_app_key,
    omie_app_secret: loja.omie_app_secret,
    endpoint: 'v1/geral/produtos',
    call: 'AlterarProduto',
    data: {
      codigo_produto: dados.codigoProduto,
      descricao: dados.descricao,
      unidade: dados.unidade,
      ...(dados.ncm != null ? { ncm: dados.ncm } : {}),
      ...(dados.valorUnitario != null ? { valor_unitario: dados.valorUnitario } : {}),
      ...(dados.tipoItem != null ? { tipoItem: dados.tipoItem } : {}),
      // codigo_familia 0 = sem familia no Omie; null no NTB mapeia para 0.
      ...(dados.codigoFamilia != null ? { codigo_familia: dados.codigoFamilia } : { codigo_familia: 0 }),
      ...(dados.inativo != null ? { inativo: dados.inativo ? 'S' : 'N' } : {}),
      ...(Object.keys(fiscais).length ? { recomendacoes_fiscais: fiscais } : {}),
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

// Campos que a edicao manual (NTB) pode proteger do sync. Se o nome estiver em
// produtos.campos_editados, o sync NAO sobrescreve aquele campo daquele produto.
// full_object/ean/bloqueado nunca sao editaveis pela tela, entao ficam livres.
const CAMPOS_PROTEGIVEIS = [
  'descricao',
  'codigo_familia',
  'descricao_familia',
  'tipo_item',
  'unidade',
  'valor_unitario',
  'inativo',
  'ncm',
] as const

export async function syncProdutos(loja: LojaOmie) {
  const supabase = createServiceClient()
  await supabase.from('lojas').update({ produto_status: 'Processando' }).eq('id', loja.id)

  // Mapa codigo_produto -> campos editados a mao (para nao sobrescrever no upsert).
  // Carrega so quem tem algo editado (campos_editados != []), barato mesmo em base grande.
  const editadosPorProduto = new Map<number, Set<string>>()
  {
    const { data: editados } = await supabase
      .from('produtos')
      .select('codigo_produto, campos_editados')
      .eq('loja_id', loja.id)
      .neq('campos_editados', '[]')
    for (const e of editados ?? []) {
      const lista = Array.isArray(e.campos_editados) ? (e.campos_editados as string[]) : []
      if (lista.length) editadosPorProduto.set(e.codigo_produto as number, new Set(lista))
    }
  }

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

        // Caminho rapido: produtos sem nenhuma edicao manual vao no upsert em lote
        // (igual a antes). Produtos editados a mao seguem por update individual que
        // omite os campos protegidos, preservando o que o usuario digitou no NTB.
        const semEdicao = rows.filter((r) => !editadosPorProduto.has(r.codigo_produto))
        const comEdicao = rows.filter((r) => editadosPorProduto.has(r.codigo_produto))

        if (semEdicao.length) {
          // Sem checar o erro, um produto fora de faixa derrubava o lote da página em
          // silêncio enquanto o status virava "Concluido". Agora propaga.
          const { error } = await supabase.from('produtos').upsert(semEdicao, { onConflict: 'codigo_produto,loja_id' })
          if (error) throw new Error(`Falha ao gravar lote de produtos: ${error.message}`)
        }
        for (const row of comEdicao) {
          const protegidos = editadosPorProduto.get(row.codigo_produto)!
          const patch: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(row)) {
            // chave de match e metadados nunca entram no patch; campos protegidos sao pulados.
            if (k === 'codigo_produto' || k === 'loja_id') continue
            if (CAMPOS_PROTEGIVEIS.includes(k as (typeof CAMPOS_PROTEGIVEIS)[number]) && protegidos.has(k)) continue
            patch[k] = v
          }
          const { error } = await supabase
            .from('produtos')
            .update(patch)
            .eq('loja_id', loja.id)
            .eq('codigo_produto', row.codigo_produto)
          if (error) throw new Error(`Falha ao gravar produto ${row.codigo_produto}: ${error.message}`)
        }
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
