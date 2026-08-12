'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { syncFornecedores, incluirFornecedor, alterarFornecedor, excluirFornecedorOmie } from '@/lib/omie/cliente-fornecedor'
import { registrarAuditoria } from '@/lib/auditoria'
import type { LojaOmie } from '@/lib/omie/client'

export type ParceiroInput = {
  razao_social: string
  nome_fantasia: string
  cnpj_cpf: string
  pessoa_fisica: boolean
  inscricao_estadual: string
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

function normalizar(d: ParceiroInput) {
  return {
    razao_social: d.razao_social.trim(),
    nome_fantasia: d.nome_fantasia.trim() || null,
    cnpj_cpf: d.cnpj_cpf.trim() || null,
    pessoa_fisica: d.pessoa_fisica,
    inscricao_estadual: d.inscricao_estadual.trim() || null,
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

async function getLoja(lojaId: number) {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret, is_test')
    .eq('id', lojaId)
    .single<LojaOmie>()
  return data
}

/**
 * Cria um fornecedor no Omie (IncluirCliente com tag Fornecedor) e grava no banco.
 * Se o Omie falhar, retorna erro e nao salva localmente para manter sincronia.
 */
export async function criarFornecedor(dados: ParceiroInput): Promise<{ ok?: boolean; error?: string; omieError?: string }> {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Fornecedores - Criar'))) return { error: 'Sem permissão' }
  if (!dados.razao_social.trim()) return { error: 'Informe a razão social' }

  const loja = await getLoja(lojaId)
  if (!loja?.omie_app_key) return { error: 'Loja sem chave do Omie' }

  const norm = normalizar(dados)
  try {
    const res = await incluirFornecedor(loja, norm)

    const supabase = createServiceClient()
    const { error } = await supabase
      .from('fornecedores')
      .insert({ loja_id: lojaId, codigo_omie: res.codigo, origem: 'omie', ...norm })
    if (error) return { error: error.message }

    await registrarAuditoria('criar', 'fornecedor', res.codigo, dados.razao_social.trim())
    revalidatePath('/fornecedor')
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao criar o fornecedor no Omie' }
  }
}

export async function editarFornecedor(id: number, dados: ParceiroInput): Promise<{ ok?: boolean; error?: string; omieError?: string }> {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Fornecedores - Editar'))) return { error: 'Sem permissão' }
  if (!dados.razao_social.trim()) return { error: 'Informe a razão social' }

  const supabase = createServiceClient()

  const { data: atual } = await supabase
    .from('fornecedores')
    .select('codigo_omie, razao_social')
    .eq('id', id)
    .eq('loja_id', lojaId)
    .single()
  if (!atual) return { error: 'Fornecedor não encontrado' }

  const norm = normalizar(dados)
  const { error } = await supabase
    .from('fornecedores')
    .update({ ...norm, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('loja_id', lojaId)
  if (error) return { error: error.message }

  await registrarAuditoria('editar', 'fornecedor', id, dados.razao_social.trim())
  revalidatePath('/fornecedor')

  const codigoOmie = (atual.codigo_omie as number | null) ?? null
  const loja = await getLoja(lojaId)
  if (!loja?.omie_app_key) return { ok: true, omieError: 'Loja sem chave do Omie: alteração salva localmente.' }

  try {
    if (codigoOmie) {
      await alterarFornecedor(loja, codigoOmie, norm)
    } else {
      // Fornecedor criado localmente antes desta feature: cria no Omie e salva o codigo.
      const res = await incluirFornecedor(loja, norm)
      await supabase
        .from('fornecedores')
        .update({ codigo_omie: res.codigo, origem: 'omie' })
        .eq('id', id)
        .eq('loja_id', lojaId)
    }
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha ao enviar ao Omie'
    return { ok: true, omieError: msg }
  }
}

export async function excluirFornecedor(id: number): Promise<{ ok?: boolean; error?: string; omieError?: string }> {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Fornecedores - Excluir'))) return { error: 'Sem permissão' }

  const supabase = createServiceClient()
  const { data: alvo } = await supabase
    .from('fornecedores')
    .select('razao_social, codigo_omie')
    .eq('id', id)
    .eq('loja_id', lojaId)
    .maybeSingle()
  const { error } = await supabase.from('fornecedores').delete().eq('id', id).eq('loja_id', lojaId)
  if (error) return { error: error.message }

  await registrarAuditoria('excluir', 'fornecedor', id, alvo?.razao_social ?? null)
  revalidatePath('/fornecedor')

  const codigoOmie = (alvo?.codigo_omie as number | null) ?? null
  if (!codigoOmie) return { ok: true }

  const loja = await getLoja(lojaId)
  if (!loja?.omie_app_key) return { ok: true }

  try {
    await excluirFornecedorOmie(loja, codigoOmie)
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha ao excluir no Omie'
    return { ok: true, omieError: msg }
  }
}

export async function puxarFornecedoresDoOmie() {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Fornecedores - Sincronizar'))) return { error: 'Sem permissão' }

  const loja = await getLoja(lojaId)
  if (!loja?.omie_app_key || !loja?.omie_app_secret) return { error: 'Loja sem chave do Omie' }

  try {
    await syncFornecedores(loja)
    revalidatePath('/fornecedor')
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao puxar do Omie' }
  }
}
