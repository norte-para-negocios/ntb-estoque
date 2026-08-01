'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import {
  concluirRecebimento,
  reverterRecebimento,
  excluirRecebimento,
  pareceRecebimentoNaoExiste,
} from '@/lib/omie/nota-fiscal'
import { registrarAuditoria } from '@/lib/auditoria'
import { statusNF } from '@/lib/nf-status'
import type { LojaOmie } from '@/lib/omie/client'

export async function setQuantidadeNFItem(itemId: number, quantidade: number | null) {
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('nota_fiscal_items')
    .update({ quantidade, updated_at: new Date().toISOString() })
    .eq('id', itemId)
    .eq('loja_id', lojaId)
  if (error) return { error: error.message }
  revalidatePath('/nota-fiscal', 'page')
  return { ok: true as const }
}

export async function setCategoriaContabilNFItem(itemId: number, categoriaId: number | null) {
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('nota_fiscal_items')
    .update({ categoria_contabil_id: categoriaId, updated_at: new Date().toISOString() })
    .eq('id', itemId)
    .eq('loja_id', lojaId)
  if (error) return { error: error.message }
  revalidatePath('/nota-fiscal', 'page')
  return { ok: true as const }
}

// Mesmo padrao de lib/actions/ordem-producao.ts:carregarOPdaLoja -- carrega
// a nota + a loja (com credenciais Omie) na loja ATUAL, verificando
// permissao antes.
async function carregarNFdaLoja(notaId: number, permissao: string) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, permissao))) {
    return { error: 'Sem permissão' }
  }
  const supabase = createServiceClient()
  const { data: nf, error: dbError } = await supabase
    .from('notas_fiscais')
    .select('n_id_receb, c_etapa, c_numero_nfe, full_object, loja:lojas(id, omie_app_key, omie_app_secret)')
    .eq('id', notaId)
    .eq('loja_id', lojaId)
    .single<{
      n_id_receb: string | null
      c_etapa: string | null
      c_numero_nfe: string | null
      full_object: unknown
      loja: LojaOmie
    }>()
  if (dbError) {
    return { error: `Erro ao buscar nota id=${notaId}: ${dbError.message}` }
  }
  if (!nf) {
    return { error: `Nota fiscal não encontrada (id=${notaId}, loja=${lojaId})` }
  }
  if (!nf.n_id_receb) {
    return { error: `Nota id=${notaId} ainda não tem código de recebimento da Omie.` }
  }
  if (!nf.loja) {
    return { error: `Dado inconsistente: nota id=${notaId} sem loja associada.` }
  }
  return { lojaId, supabase, nf }
}

/**
 * Marca a nota como CONCLUÍDA/recebida no Omie ("manifestar" no sentido do
 * fluxo interno de recebimento -- não é a manifestação fiscal oficial
 * junto à SEFAZ, que a API da Omie não expõe).
 */
export async function manifestarNF(notaId: number) {
  const ctx = await carregarNFdaLoja(notaId, 'Notas Fiscais - Manifestar')
  if ('error' in ctx) return { error: ctx.error }
  const { lojaId, supabase, nf } = ctx
  // Defesa no servidor: a Server Action e chamavel diretamente, entao a UI
  // escondendo o botao (AcoesNF.tsx) nao basta. c_etapa === '60' sozinho NAO
  // significa "concluida" de verdade -- uma nota pode estar em c_etapa='60' E
  // cancelada ao mesmo tempo (casos reais confirmados). statusNF ja cruza os
  // dois sinais.
  const statusAtual = statusNF(nf.c_etapa, nf.full_object).label
  if (statusAtual === 'Cancelada') return { error: 'Não dá pra manifestar uma nota cancelada.' }
  if (statusAtual === 'Concluída') return { error: 'Nota já está concluída.' }
  try {
    await concluirRecebimento(nf.loja, Number(nf.n_id_receb))
    const { error: updError } = await supabase
      .from('notas_fiscais')
      .update({ c_etapa: '60', updated_at: new Date().toISOString() })
      .eq('id', notaId)
      .eq('loja_id', lojaId)
    if (updError) return { error: updError.message }
    await registrarAuditoria('concluir', 'nota fiscal', nf.c_numero_nfe, null)
    revalidatePath(`/nota-fiscal/${notaId}`)
    revalidatePath('/nota-fiscal')
    return { ok: true as const }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao manifestar no Omie' }
  }
}

/** Reverte a conclusão -- volta a nota pra Pendente. */
export async function reverterManifestacaoNF(notaId: number) {
  const ctx = await carregarNFdaLoja(notaId, 'Notas Fiscais - Reverter')
  if ('error' in ctx) return { error: ctx.error }
  const { lojaId, supabase, nf } = ctx
  if (nf.c_etapa !== '60') {
    return { error: 'Só dá para reverter uma nota concluída.' }
  }
  try {
    await reverterRecebimento(nf.loja, Number(nf.n_id_receb))
    const { error: updError } = await supabase
      .from('notas_fiscais')
      .update({ c_etapa: '40', updated_at: new Date().toISOString() })
      .eq('id', notaId)
      .eq('loja_id', lojaId)
    if (updError) return { error: updError.message }
    await registrarAuditoria('reverter', 'nota fiscal', nf.c_numero_nfe, null)
    revalidatePath(`/nota-fiscal/${notaId}`)
    revalidatePath('/nota-fiscal')
    return { ok: true as const }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao reverter no Omie' }
  }
}

/**
 * Exclui o recebimento no Omie e soft-deleta a nota no banco local
 * (deleted_at, mesma convencao usada em todo o projeto -- NAO delete fisico:
 * o Contabo guarda historico completo em modo append-only e nunca aprende
 * sobre deleted_at, entao um delete fisico faria a nota "ressuscitar" via
 * leitura hibrida sempre que um relatorio cruzasse os 90 dias). IRREVERSÍVEL
 * do lado da Omie -- a UI precisa confirmar antes de chamar isso.
 */
export async function excluirRecebimentoNF(notaId: number) {
  const ctx = await carregarNFdaLoja(notaId, 'Notas Fiscais - Excluir')
  if ('error' in ctx) return { error: ctx.error }
  const { lojaId, supabase, nf } = ctx
  let fantasma = false
  try {
    try {
      await excluirRecebimento(nf.loja, Number(nf.n_id_receb))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!pareceRecebimentoNaoExiste(msg)) throw e
      fantasma = true
    }
    const { error: delError } = await supabase
      .from('notas_fiscais')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', notaId)
      .eq('loja_id', lojaId)
    if (delError) return { error: delError.message }
    await registrarAuditoria('excluir', 'nota fiscal', nf.c_numero_nfe, null)
    revalidatePath('/nota-fiscal')
    return { ok: true as const, fantasma }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao excluir no Omie' }
  }
}
