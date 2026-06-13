'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

/**
 * Force-sync da loja (admin): zera os campos *_status para null, fazendo o proximo
 * webhook/sync reprocessar do zero. Espelha o forceSync de loja do sistema Laravel.
 */
export type LojaInput = {
  cnpj: string
  nome: string
  nome_fantasia: string
  cep: string
  uf: string
  cidade: string
  bairro: string
  logradouro: string
  numero: string
  omie_app_key: string
  omie_app_secret: string
  ativo: boolean
}

function normalizarDados(dados: LojaInput) {
  return {
    cnpj: dados.cnpj.trim(),
    nome: dados.nome.trim(),
    nome_fantasia: dados.nome_fantasia.trim() || null,
    cep: dados.cep.trim() || null,
    uf: dados.uf.trim() || null,
    cidade: dados.cidade.trim() || null,
    bairro: dados.bairro.trim() || null,
    logradouro: dados.logradouro.trim() || null,
    numero: dados.numero.trim() || null,
    // Loja "fora do Omie": chaves podem ser vazias -> grava null
    omie_app_key: dados.omie_app_key.trim() || null,
    omie_app_secret: dados.omie_app_secret.trim() || null,
    ativo: dados.ativo,
  }
}

export async function criarLoja(dados: LojaInput) {
  if (!(await isAdmin())) return { error: 'Somente administradores' }
  if (!dados.cnpj.trim() || !dados.nome.trim()) {
    return { error: 'CNPJ e nome são obrigatórios' }
  }

  const supabase = createServiceClient()
  const { error } = await supabase.from('lojas').insert(normalizarDados(dados))

  if (error) return { error: error.message }

  revalidatePath('/loja')
  return { ok: true }
}

export async function editarLoja(lojaId: number, dados: LojaInput) {
  if (!(await isAdmin())) return { error: 'Somente administradores' }
  if (!dados.cnpj.trim() || !dados.nome.trim()) {
    return { error: 'CNPJ e nome são obrigatórios' }
  }

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('lojas')
    .update(normalizarDados(dados))
    .eq('id', lojaId)

  if (error) return { error: error.message }

  revalidatePath('/loja')
  return { ok: true }
}

export async function excluirLoja(lojaId: number) {
  if (!(await isAdmin())) return { error: 'Somente administradores' }

  const supabase = createServiceClient()
  const { error } = await supabase.from('lojas').delete().eq('id', lojaId)

  if (error) return { error: error.message }

  revalidatePath('/loja')
  return { ok: true }
}

export async function forceSyncLoja(lojaId: number) {
  if (!(await isAdmin())) return { error: 'Somente administradores' }

  const supabase = createServiceClient()
  await supabase
    .from('lojas')
    .update({
      produto_status: null,
      local_estoque_status: null,
      posicao_estoque_status: null,
      nota_fiscal_status: null,
      ordem_producao_status: null,
    })
    .eq('id', lojaId)

  revalidatePath('/loja')
  return { ok: true }
}
