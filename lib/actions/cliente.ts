'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { syncClientes } from '@/lib/omie/cliente-fornecedor'
import type { LojaOmie } from '@/lib/omie/client'

export type ClienteInput = {
  razao_social: string
  nome_fantasia: string
  cnpj_cpf: string
  pessoa_fisica: boolean
  inscricao_estadual: string
  cest: string
  email: string
  telefone: string
  cep: string
  uf: string
  cidade: string
  bairro: string
  logradouro: string
  numero: string
  inativo: boolean
}

function normalizar(d: ClienteInput) {
  return {
    razao_social: d.razao_social.trim(),
    nome_fantasia: d.nome_fantasia.trim() || null,
    cnpj_cpf: d.cnpj_cpf.trim() || null,
    pessoa_fisica: d.pessoa_fisica,
    inscricao_estadual: d.inscricao_estadual.trim() || null,
    cest: d.cest.replace(/\D/g, '') || null,
    email: d.email.trim() || null,
    telefone: d.telefone.trim() || null,
    cep: d.cep.trim() || null,
    uf: d.uf.trim() || null,
    cidade: d.cidade.trim() || null,
    bairro: d.bairro.trim() || null,
    logradouro: d.logradouro.trim() || null,
    numero: d.numero.trim() || null,
    inativo: d.inativo,
  }
}

/**
 * Cria cliente LOCAL no banco (fonte da verdade). NAO escreve no Omie.
 * CEST e campo local (o Omie nao tem CEST no cadastro de cliente, confirmado por probe;
 * CEST e do produto, mas o Ramon pediu o campo no cadastro fiscal de cliente).
 */
export async function criarCliente(dados: ClienteInput) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Clientes'))) return { error: 'Sem permissão' }
  if (!dados.razao_social.trim()) return { error: 'Informe a razão social ou nome' }

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('clientes')
    .insert({ loja_id: lojaId, origem: 'local', ...normalizar(dados) })
  if (error) return { error: error.message }

  revalidatePath('/cliente')
  return { ok: true }
}

export async function editarCliente(id: number, dados: ClienteInput) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Clientes'))) return { error: 'Sem permissão' }
  if (!dados.razao_social.trim()) return { error: 'Informe a razão social ou nome' }

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('clientes')
    .update({ ...normalizar(dados), updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('loja_id', lojaId)
  if (error) return { error: error.message }

  revalidatePath('/cliente')
  return { ok: true }
}

export async function excluirCliente(id: number) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Clientes'))) return { error: 'Sem permissão' }

  const supabase = createServiceClient()
  const { error } = await supabase.from('clientes').delete().eq('id', id).eq('loja_id', lojaId)
  if (error) return { error: error.message }

  revalidatePath('/cliente')
  return { ok: true }
}

export async function puxarClientesDoOmie() {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Clientes - Sincronizar'))) return { error: 'Sem permissão' }

  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret')
    .eq('id', lojaId)
    .single<LojaOmie>()
  if (!loja?.omie_app_key || !loja?.omie_app_secret) return { error: 'Loja sem chave do Omie' }

  try {
    await syncClientes(loja)
    revalidatePath('/cliente')
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao puxar do Omie' }
  }
}
