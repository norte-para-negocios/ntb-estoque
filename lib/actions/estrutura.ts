'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { consultarEstrutura } from '@/lib/omie/malha'
import type { LojaOmie } from '@/lib/omie/client'

export type EstruturaItemView = {
  codigo: string
  descricao: string
  familia: string
  quantidade: number
  unidade: string
  perda: number
}

export type ConsumoView = {
  codigo: string
  descricao: string
  quantidade: number // consumido na ultima OP
  doEstoque: boolean
}

export type EstruturaView = {
  produto: { codigo: string; descricao: string; tipo: string; unidade: string } | null
  itens: EstruturaItemView[]
  consumoOP: { numero: string | null; data: string | null; itens: ConsumoView[] } | null
  semEstrutura: boolean
}

type OPItemDetalhe = {
  nIdProdutoMalha: number
  nQtde: number
  cUtilizarDoEstoque?: string
}

/**
 * Le a ESTRUTURA (BOM) de um produto e o CONSUMO real na ultima OP concluida.
 * SO LEITURA. A estrutura vem do Omie (ConsultarEstrutura). O consumo vem do
 * full_object das OPs ja salvas no banco (itensDetalhes), sem chamada extra ao Omie.
 * A edicao da ficha tecnica fica para validar com o Ramon (nao escrevemos a malha).
 */
export async function verEstrutura(
  codigoProduto: number
): Promise<{ error: string } | { ok: true; view: EstruturaView }> {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produtos'))) return { error: 'Sem permissão' }

  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret')
    .eq('id', lojaId)
    .single<LojaOmie>()
  if (!loja?.omie_app_key || !loja?.omie_app_secret) return { error: 'Loja sem chave do Omie' }

  // Estrutura (BOM) do Omie.
  let estrutura
  try {
    estrutura = await consultarEstrutura(loja, codigoProduto)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao consultar a estrutura no Omie' }
  }

  const itens: EstruturaItemView[] = (estrutura?.itens ?? []).map((i) => ({
    codigo: i.codProdMalha,
    descricao: i.descrProdMalha,
    familia: i.descrFamMalha,
    quantidade: Number(i.quantProdMalha) || 0,
    unidade: i.unidProdMalha,
    perda: Number(i.percPerdaProdMalha) || 0,
  }))

  const produto = estrutura?.ident
    ? {
        codigo: estrutura.ident.codProduto,
        descricao: estrutura.ident.descrProduto,
        tipo: estrutura.ident.tipoProduto,
        unidade: estrutura.ident.unidProduto,
      }
    : null

  // Consumo real: ultima OP concluida desse produto (full_object.itensDetalhes).
  const { data: op } = await supabase
    .from('ordens_producao')
    .select('identificacao_c_num_op, dt_conclusao_real, full_object')
    .eq('loja_id', lojaId)
    .eq('identificacao_n_cod_produto', codigoProduto)
    .eq('concluida', true)
    .order('dt_conclusao_real', { ascending: false })
    .limit(1)
    .maybeSingle()

  let consumoOP: EstruturaView['consumoOP'] = null
  if (op?.full_object) {
    const fo = op.full_object as { itensDetalhes?: OPItemDetalhe[] }
    const det = fo.itensDetalhes ?? []
    if (det.length) {
      // Resolve descricao dos componentes pelo codigo_produto (nIdProdutoMalha).
      const ids = [...new Set(det.map((d) => d.nIdProdutoMalha))]
      const { data: prods } = await supabase
        .from('produtos')
        .select('codigo_produto, codigo, descricao')
        .eq('loja_id', lojaId)
        .in('codigo_produto', ids)
      const mapa = new Map<number, { codigo: string | null; descricao: string | null }>()
      for (const p of prods ?? [])
        mapa.set(p.codigo_produto as number, { codigo: p.codigo as string, descricao: p.descricao as string })

      consumoOP = {
        numero: (op.identificacao_c_num_op as string | null) ?? null,
        data: (op.dt_conclusao_real as string | null) ?? null,
        itens: det.map((d) => {
          const info = mapa.get(d.nIdProdutoMalha)
          return {
            codigo: info?.codigo ?? String(d.nIdProdutoMalha),
            descricao: info?.descricao ?? '(componente)',
            quantidade: Number(d.nQtde) || 0,
            doEstoque: d.cUtilizarDoEstoque === 'S',
          }
        }),
      }
    }
  }

  return {
    ok: true,
    view: {
      produto,
      itens,
      consumoOP,
      semEstrutura: !itens.length,
    },
  }
}
