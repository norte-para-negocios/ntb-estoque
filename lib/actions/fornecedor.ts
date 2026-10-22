'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'

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
    .select('id, omie_app_key, omie_app_secret, is_test, modo_estoque')
    .eq('id', lojaId)
    .single<LojaOmie & { modo_estoque: string | null }>()
  return data
}

// Fornecedores que só existem aqui: da nota da SEFAZ/XML (migration 182), da planilha (migration 223) e os cadastrados
// à mão na loja de estoque próprio ('manual'). Editar e excluir não vão ao Omie.
const ORIGENS_SO_LOCAL = ['sefaz', 'planilha', 'manual']

/**
 * Loja de estoque próprio: o fornecedor fica só no banco. Com CNPJ/CPF o código vem da faixa própria
 * (fornecedor_da_nota_sefaz, o mesmo das notas), para as telas que juntam nota × fornecedor pelo código.
 * A função devolve o fornecedor que JÁ existe com o documento; o cadastro só vale se a linha nasceu agora
 * (origem 'sefaz' criada depois do início desta chamada), senão é duplicado e nada é sobrescrito.
 */
async function criarFornecedorProprio(lojaId: number, norm: ReturnType<typeof normalizar>): Promise<{ id: number } | { error: string }> {
  const supabase = createServiceClient()
  const doc = (norm.cnpj_cpf ?? '').replace(/\D/g, '')
  if (doc.length === 11 || doc.length === 14) {
    const inicio = new Date(Date.now() - 1000).toISOString()
    const { data: codigo, error } = await supabase.rpc('fornecedor_da_nota_sefaz', {
      p_loja: lojaId, p_cnpj: doc, p_razao: norm.razao_social, p_fantasia: norm.nome_fantasia, p_ie: norm.inscricao_estadual,
    })
    if (error || codigo == null) return { error: error?.message ?? 'Falha ao gerar o código do fornecedor' }
    const { data: linhas, error: e2 } = await supabase.from('fornecedores')
      .update({ ...norm, origem: 'manual', updated_at: new Date().toISOString() })
      .eq('loja_id', lojaId).eq('codigo_omie', codigo).eq('origem', 'sefaz').gte('created_at', inicio)
      .select('id')
    if (e2) {
      // Não deixa o cadastro pela metade (só razão e documento): desfaz a linha que acabou de nascer.
      await supabase.from('fornecedores').delete().eq('loja_id', lojaId).eq('codigo_omie', codigo).eq('origem', 'sefaz').gte('created_at', inicio)
      return { error: e2.message }
    }
    if (!linhas?.length) return { error: 'Já existe um fornecedor com este CNPJ/CPF' }
    return { id: Number(linhas[0].id) }
  }
  const { data, error } = await supabase.from('fornecedores').insert({ loja_id: lojaId, origem: 'manual', ...norm }).select('id').single()
  if (error) return { error: error.message }
  return { id: Number(data.id) }
}

/**
 * Cria um fornecedor no Omie (IncluirCliente com tag Fornecedor) e grava no banco.
 * Se o Omie falhar, retorna erro e nao salva localmente para manter sincronia.
 */
export async function criarFornecedor(dados: ParceiroInput): Promise<{ ok?: boolean; error?: string; omieError?: string }> {
  const __d = viaDesktop('fornecedor#criarFornecedor', criarFornecedor, [dados]); if (__d) return __d as never
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Fornecedores - Criar'))) return { error: 'Sem permissão' }
  if (!dados.razao_social.trim()) return { error: 'Informe a razão social' }

  const loja = await getLoja(lojaId)
  const norm = normalizar(dados)
  if (loja?.modo_estoque === 'proprio') {
    const r = await criarFornecedorProprio(lojaId, norm)
    if ('error' in r) return { error: r.error }
    await registrarAuditoria('criar', 'fornecedor', r.id, dados.razao_social.trim())
    revalidatePath('/fornecedor')
    return { ok: true }
  }
  if (!loja?.omie_app_key) return { error: 'Loja sem chave do Omie' }

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
  const __d = viaDesktop('fornecedor#editarFornecedor', editarFornecedor, [id, dados]); if (__d) return __d as never
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Fornecedores - Editar'))) return { error: 'Sem permissão' }
  if (!dados.razao_social.trim()) return { error: 'Informe a razão social' }

  const supabase = createServiceClient()

  const { data: atual } = await supabase
    .from('fornecedores')
    .select('codigo_omie, razao_social, origem')
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

  // Fornecedor criado a partir de nota da SEFAZ/XML (estoque próprio, migration 182): o código é da faixa própria e
  // não existe no Omie; a alteração fica só aqui.
  // Fase G: fornecedor importado por planilha (só estoque próprio, migration 223) também não existe no Omie.
  if (ORIGENS_SO_LOCAL.includes(atual.origem as string)) return { ok: true }
  const codigoOmie = (atual.codigo_omie as number | null) ?? null
  const loja = await getLoja(lojaId)
  if (loja?.modo_estoque === 'proprio') return { ok: true }
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
  const __d = viaDesktop('fornecedor#excluirFornecedor', excluirFornecedor, [id]); if (__d) return __d as never
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Fornecedores - Excluir'))) return { error: 'Sem permissão' }

  const supabase = createServiceClient()
  const { data: alvo } = await supabase
    .from('fornecedores')
    .select('razao_social, codigo_omie, origem')
    .eq('id', id)
    .eq('loja_id', lojaId)
    .maybeSingle()
  const { error } = await supabase.from('fornecedores').delete().eq('id', id).eq('loja_id', lojaId)
  if (error) return { error: error.message }

  await registrarAuditoria('excluir', 'fornecedor', id, alvo?.razao_social ?? null)
  revalidatePath('/fornecedor')

  const codigoOmie = (alvo?.codigo_omie as number | null) ?? null
  // Fornecedor da nota da SEFAZ/XML (migration 182): não existe no Omie.
  if (!codigoOmie || ORIGENS_SO_LOCAL.includes(alvo?.origem as string)) return { ok: true }

  const loja = await getLoja(lojaId)
  if (!loja?.omie_app_key || loja.modo_estoque === 'proprio') return { ok: true }

  try {
    await excluirFornecedorOmie(loja, codigoOmie)
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha ao excluir no Omie'
    return { ok: true, omieError: msg }
  }
}

export async function puxarFornecedoresDoOmie() {
  const __d = viaDesktop('fornecedor#puxarFornecedoresDoOmie', puxarFornecedoresDoOmie, []); if (__d) return __d as never
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
