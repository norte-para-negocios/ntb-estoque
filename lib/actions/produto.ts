'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { incluirProduto, excluirProdutoOmie } from '@/lib/omie/produto'
import type { LojaOmie } from '@/lib/omie/client'

// Familias existentes na loja (codigo + descricao), para o seletor do cadastro.
export async function buscarFamilias(): Promise<{ codigo: number; descricao: string }[]> {
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('produtos')
    .select('codigo_familia, descricao_familia')
    .eq('loja_id', lojaId)
    .not('codigo_familia', 'is', null)
    .not('descricao_familia', 'is', null)
  const map = new Map<number, string>()
  for (const p of data ?? []) {
    const cod = p.codigo_familia as number | null
    if (cod != null && !map.has(cod)) map.set(cod, p.descricao_familia as string)
  }
  return [...map.entries()]
    .map(([codigo, descricao]) => ({ codigo, descricao }))
    .sort((a, b) => a.descricao.localeCompare(b.descricao))
}

/**
 * Cria um produto no Omie e grava no banco (Bloco 9.1). ESCREVE no Omie.
 * Disparo real apenas com o Ramon (regra: nao escrever no Omie em teste sozinho).
 */
export async function criarProduto(dados: {
  codigo: string
  descricao: string
  unidade: string
  ncm: string
  valorUnitario: number
  tipoItem?: string
  codigoFamilia?: number | null
  descricaoFamilia?: string | null
  origem?: string // origem da mercadoria (0-8)
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
  cest?: string
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produtos'))) return { error: 'Sem permissão' }

  if (!dados.codigo?.trim()) return { error: 'Informe o código do produto' }
  if (!dados.descricao?.trim()) return { error: 'Informe a descrição' }
  if (!dados.unidade?.trim()) return { error: 'Informe a unidade (ex.: UN, KG)' }
  const ncm = (dados.ncm || '').replace(/\D/g, '')
  if (ncm.length !== 8) return { error: 'O NCM deve ter 8 dígitos' }

  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret')
    .eq('id', lojaId)
    .single<LojaOmie>()
  if (!loja) return { error: 'Loja não encontrada' }

  try {
    const res = await incluirProduto(loja, {
      codigo: dados.codigo.trim(),
      descricao: dados.descricao.trim(),
      unidade: dados.unidade.trim(),
      ncm,
      valorUnitario: Number(dados.valorUnitario) || 0,
      tipoItem: dados.tipoItem?.trim() || undefined,
      codigoFamilia: dados.codigoFamilia || undefined,
      origem: dados.origem || undefined,
      ean: dados.ean?.trim() || undefined,
      descrDetalhada: dados.descrDetalhada?.trim() || undefined,
      obsInternas: dados.obsInternas?.trim() || undefined,
      marca: dados.marca?.trim() || undefined,
      modelo: dados.modelo?.trim() || undefined,
      pesoLiq: dados.pesoLiq || undefined,
      pesoBruto: dados.pesoBruto || undefined,
      altura: dados.altura || undefined,
      largura: dados.largura || undefined,
      profundidade: dados.profundidade || undefined,
      cest: dados.cest?.replace(/\D/g, '') || undefined,
    })

    // Grava o produto recem-criado direto (sem re-sync pesado de toda a base).
    const codigoProduto = res?.codigo_produto
    if (codigoProduto) {
      await supabase.from('produtos').upsert(
        {
          loja_id: lojaId,
          codigo_produto: codigoProduto,
          codigo: dados.codigo.trim(),
          descricao: dados.descricao.trim(),
          unidade: dados.unidade.trim(),
          ncm,
          valor_unitario: Number(dados.valorUnitario) || 0,
          tipo_item: dados.tipoItem?.trim() || null,
          codigo_familia: dados.codigoFamilia || null,
          descricao_familia: dados.descricaoFamilia || null,
          inativo: false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'codigo_produto,loja_id' }
      )
    }

    revalidatePath('/produto')
    return { ok: true, codigoProduto }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao criar o produto no Omie' }
  }
}

/**
 * Edita um produto LOCAL no banco (Supabase = fonte da verdade; visao de substituir
 * o Omie). NAO escreve no Omie: a escrita (AlterarProduto) precisa ser validada com
 * o Ramon em produto de teste antes de virar producao. Aqui salvamos so no banco e
 * marcamos os campos alterados em produtos.campos_editados, para que o sync de
 * produtos (ListarProdutos -> upsert) NAO sobrescreva o que foi editado a mao.
 */
export async function editarProduto(
  id: number,
  dados: {
    descricao: string
    codigoFamilia: number | null
    descricaoFamilia: string | null
    tipoItem: string | null
    unidade: string
    ncm: string | null
    valorUnitario: number | null
    estoqueMinimo: number | null
    inativo: boolean
  }
) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produtos'))) return { error: 'Sem permissão' }
  if (!id) return { error: 'Produto inválido' }

  if (!dados.descricao?.trim()) return { error: 'Informe a descrição' }
  if (!dados.unidade?.trim()) return { error: 'Informe a unidade (ex.: UN, KG)' }
  const ncm = (dados.ncm || '').replace(/\D/g, '')
  if (ncm && ncm.length !== 8) return { error: 'O NCM deve ter 8 dígitos (ou deixe em branco)' }
  if (dados.valorUnitario != null && (Number.isNaN(dados.valorUnitario) || dados.valorUnitario < 0)) {
    return { error: 'Preço de venda inválido' }
  }
  if (dados.estoqueMinimo != null && (Number.isNaN(dados.estoqueMinimo) || dados.estoqueMinimo < 0)) {
    return { error: 'Estoque mínimo inválido' }
  }

  const supabase = createServiceClient()

  // Estado atual para comparar e so marcar como "editado a mao" o que realmente mudou.
  const { data: atual } = await supabase
    .from('produtos')
    .select(
      'descricao, codigo_familia, descricao_familia, tipo_item, unidade, ncm, valor_unitario, estoque_minimo, inativo, campos_editados'
    )
    .eq('id', id)
    .eq('loja_id', lojaId)
    .single()
  if (!atual) return { error: 'Produto não encontrado' }

  const novo = {
    descricao: dados.descricao.trim(),
    codigo_familia: dados.codigoFamilia,
    descricao_familia: dados.descricaoFamilia,
    tipo_item: dados.tipoItem?.trim() || null,
    unidade: dados.unidade.trim(),
    ncm: ncm || null,
    valor_unitario: dados.valorUnitario,
    estoque_minimo: dados.estoqueMinimo,
    inativo: dados.inativo,
  }

  // Campos que o sync sobrescreve e portanto precisam de protecao quando editados.
  // estoque_minimo ja e override historico (o sync nunca o toca), entao nao entra aqui.
  const PROTEGIVEIS = [
    'descricao',
    'codigo_familia',
    'descricao_familia',
    'tipo_item',
    'unidade',
    'ncm',
    'valor_unitario',
    'inativo',
  ] as const

  const editadosAtuais = new Set<string>(
    Array.isArray(atual.campos_editados) ? (atual.campos_editados as string[]) : []
  )
  for (const campo of PROTEGIVEIS) {
    // family vem como par (codigo + descricao): tratar como um conjunto.
    const mudou = String(atual[campo as keyof typeof atual] ?? '') !== String(novo[campo as keyof typeof novo] ?? '')
    if (mudou) {
      editadosAtuais.add(campo)
      if (campo === 'codigo_familia' || campo === 'descricao_familia') {
        editadosAtuais.add('codigo_familia')
        editadosAtuais.add('descricao_familia')
      }
    }
  }

  const { error } = await supabase
    .from('produtos')
    .update({
      ...novo,
      campos_editados: [...editadosAtuais],
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('loja_id', lojaId)

  if (error) return { error: error.message }
  revalidatePath('/produto')
  return { ok: true }
}

/**
 * Exclui um produto no Omie e remove do banco (Bloco 9.2 / C2). ESCREVE no Omie.
 * Disparo real apenas com o Ramon (regra: nao escrever no Omie em teste sozinho).
 */
export async function excluirProduto(codigoProduto: number) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produtos'))) return { error: 'Sem permissão' }
  if (!codigoProduto) return { error: 'Produto inválido' }

  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret')
    .eq('id', lojaId)
    .single<LojaOmie>()
  if (!loja) return { error: 'Loja não encontrada' }

  try {
    await excluirProdutoOmie(loja, codigoProduto)
    await supabase.from('produtos').delete().eq('loja_id', lojaId).eq('codigo_produto', codigoProduto)
    revalidatePath('/produto')
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao excluir o produto no Omie' }
  }
}
