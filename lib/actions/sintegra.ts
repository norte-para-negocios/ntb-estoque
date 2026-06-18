'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { consultarPorCnpj, type ParceiroOmie } from '@/lib/omie/cliente-fornecedor'
import type { LojaOmie } from '@/lib/omie/client'

async function getLoja() {
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret')
    .eq('id', lojaId)
    .single<LojaOmie>()
  return { lojaId, loja, supabase }
}

/**
 * Consulta o cadastro por CNPJ/CPF no Omie (SO LEITURA). Pode ser cliente e/ou
 * fornecedor (identificado pela tag). Base do "puxar por CNPJ" do SINTEGRA.
 */
export async function consultarCnpj(cnpjCpf: string): Promise<
  { error: string } | { ok: true; parceiro: ParceiroOmie | null }
> {
  const lojaId = await getCurrentLojaId()
  // Permissao: basta poder ver fornecedores OU clientes.
  const pode =
    (await requirePermissao(lojaId, 'Fornecedores')) || (await requirePermissao(lojaId, 'Clientes'))
  if (!pode) return { error: 'Sem permissão' }

  const limpo = cnpjCpf.replace(/\s/g, '').trim()
  if (!limpo) return { error: 'Informe um CNPJ ou CPF' }

  const { loja } = await getLoja()
  if (!loja?.omie_app_key || !loja?.omie_app_secret) return { error: 'Loja sem chave do Omie' }

  try {
    const parceiro = await consultarPorCnpj(loja, limpo)
    return { ok: true, parceiro }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao consultar no Omie' }
  }
}

function paraLinha(p: ParceiroOmie, lojaId: number, extra: Record<string, unknown> = {}) {
  return {
    loja_id: lojaId,
    codigo_omie: p.codigo_omie,
    razao_social: p.razao_social,
    nome_fantasia: p.nome_fantasia,
    cnpj_cpf: p.cnpj_cpf,
    pessoa_fisica: p.pessoa_fisica,
    inscricao_estadual: p.inscricao_estadual,
    inscricao_municipal: p.inscricao_municipal,
    email: p.email,
    telefone: p.telefone,
    cep: p.cep,
    uf: p.uf,
    cidade: p.cidade,
    bairro: p.bairro,
    logradouro: p.logradouro,
    numero: p.numero,
    complemento: p.complemento,
    inativo: false,
    origem: 'omie',
    updated_at: new Date().toISOString(),
    ...extra,
  }
}

/**
 * Importa o parceiro consultado para o cadastro local (fornecedor e/ou cliente).
 * Banco = fonte da verdade. NAO escreve no Omie.
 */
export async function importarParceiro(
  p: ParceiroOmie,
  como: { fornecedor: boolean; cliente: boolean }
): Promise<{ error: string } | { ok: true; importados: string[] }> {
  const { lojaId, supabase } = await getLoja()
  const importados: string[] = []

  if (como.fornecedor) {
    if (!(await requirePermissao(lojaId, 'Fornecedores'))) return { error: 'Sem permissão (fornecedor)' }
    const { error } = await supabase
      .from('fornecedores')
      .upsert(paraLinha(p, lojaId), { onConflict: 'loja_id,codigo_omie' })
    if (error) return { error: error.message }
    importados.push('fornecedor')
  }

  if (como.cliente) {
    if (!(await requirePermissao(lojaId, 'Clientes'))) return { error: 'Sem permissão (cliente)' }
    const { error } = await supabase
      .from('clientes')
      .upsert(paraLinha(p, lojaId), { onConflict: 'loja_id,codigo_omie' })
    if (error) return { error: error.message }
    importados.push('cliente')
  }

  if (!importados.length) return { error: 'Escolha importar como fornecedor e/ou cliente' }

  revalidatePath('/fornecedor')
  revalidatePath('/cliente')
  return { ok: true, importados }
}
