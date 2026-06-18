'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getAtorGestao } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

// Convites por codigo COM permissoes embutidas (frente A do bloco de permissoes).
// Ao gerar, o admin escolhe perfil + permissoes que o convite concede; a pessoa
// usa o codigo no cadastro e entra JA com aquilo, vinculada a loja. Uso unico.
//
// Seguranca (frente C): cada acao valida o ATOR no servidor.
//  - Admin global: gera convite pra qualquer loja, perfil 'Usuario' ou 'AdminLoja'.
//  - AdminLoja: so pra loja(s) dele, e SO perfil 'Usuario' (nao pode criar AdminLoja
//    nem Admin). As permissoes que concede nao excedem as dele (ele tem acesso total
//    a loja dele, entao qualquer permissao do catalogo e valida).

export type PerfilConvite = 'Usuario' | 'AdminLoja'

// Gera um codigo curto, legivel e sem caracteres ambiguos. Formato NTB-XXXXXXXX.
function gerarCodigo(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // sem I, O, 0, 1
  let s = ''
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  for (const b of bytes) s += chars[b % chars.length]
  return `NTB-${s}`
}

export async function gerarConvite(input: {
  lojaId: number
  perfil: PerfilConvite
  // Nomes de permissao (permissoes.nome). Ignorado quando perfil = 'AdminLoja'.
  permissoes?: string[]
  // Validade opcional em dias (null/0 = nao expira).
  validadeDias?: number
}) {
  const ator = await getAtorGestao()
  if (!ator.podeGerir) return { error: 'Sem permissão para gerar convites.' }

  // Escopo de loja: o ator so pode gerar pra loja que ele gere.
  if (!ator.lojaIds.includes(input.lojaId)) {
    return { error: 'Você não pode gerar convite para esta loja.' }
  }

  // Escopo de perfil: AdminLoja so cria 'Usuario'. Admin global cria os dois.
  const perfil: PerfilConvite = input.perfil
  if (ator.isAdminLoja && perfil !== 'Usuario') {
    return { error: 'Admin da loja só pode convidar usuários comuns.' }
  }
  if (perfil !== 'Usuario' && perfil !== 'AdminLoja') {
    return { error: 'Perfil inválido para convite.' }
  }

  const supabase = createServiceClient()

  // Valida os nomes de permissao contra o banco (so guarda os que existem mesmo).
  // AdminLoja por convite tem acesso total -> nao precisa de lista.
  let permissoesNomes: string[] = []
  if (perfil === 'Usuario') {
    const escolhidas = [...new Set(input.permissoes ?? [])]
    if (escolhidas.length) {
      const { data: existentes } = await supabase
        .from('permissoes')
        .select('nome')
        .in('nome', escolhidas)
      const validas = new Set((existentes ?? []).map((p) => p.nome as string))
      permissoesNomes = escolhidas.filter((n) => validas.has(n))
    }
    if (permissoesNomes.length === 0) {
      return { error: 'Selecione ao menos uma permissão.' }
    }
  }

  const expira_em =
    input.validadeDias && input.validadeDias > 0
      ? new Date(Date.now() + input.validadeDias * 24 * 60 * 60 * 1000).toISOString()
      : null

  // Tenta ate achar um codigo livre (colisao e rarissima).
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const codigo = gerarCodigo()
    const { error } = await supabase.from('convites').insert({
      codigo,
      loja_id: input.lojaId,
      perfil,
      permissoes: permissoesNomes,
      criado_por: ator.id,
      expira_em,
    })
    if (!error) {
      revalidatePath('/usuario')
      revalidatePath('/loja')
      return { ok: true, codigo }
    }
    // 23505 = unique_violation -> tenta outro codigo.
    if (error.code !== '23505') {
      return { error: 'Não foi possível gerar o convite.' }
    }
  }
  return { error: 'Não foi possível gerar um código único. Tente de novo.' }
}

// Revoga (exclui) um convite ainda nao usado. Escopado: o ator so mexe nos convites
// das lojas que ele gere.
export async function revogarConvite(conviteId: number) {
  const ator = await getAtorGestao()
  if (!ator.podeGerir) return { error: 'Sem permissão.' }

  const supabase = createServiceClient()
  const { data: convite } = await supabase
    .from('convites')
    .select('id, loja_id, usado_em')
    .eq('id', conviteId)
    .maybeSingle<{ id: number; loja_id: number; usado_em: string | null }>()

  if (!convite) return { error: 'Convite não encontrado.' }
  if (!ator.lojaIds.includes(convite.loja_id)) {
    return { error: 'Você não pode revogar este convite.' }
  }
  if (convite.usado_em) return { error: 'Este convite já foi usado.' }

  const { error } = await supabase.from('convites').delete().eq('id', conviteId)
  if (error) return { error: 'Não foi possível revogar o convite.' }

  revalidatePath('/usuario')
  revalidatePath('/loja')
  return { ok: true }
}
