'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

function senhaAleatoria(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let s = ''
  // Usa crypto para entropia (disponivel no runtime Node do Next)
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  for (const b of bytes) s += chars[b % chars.length]
  return s + '@1'
}

export async function criarUsuario(input: {
  name: string
  email: string
  perfil: 'Admin' | 'Usuario'
  lojaIds: number[]
}) {
  if (!(await isAdmin())) return { error: 'Apenas administradores' }
  if (!input.name || !input.email) return { error: 'Nome e e-mail obrigatórios' }

  const supabase = createServiceClient()
  const senha = senhaAleatoria()

  const { data: created, error } = await supabase.auth.admin.createUser({
    email: input.email,
    password: senha,
    email_confirm: true,
    user_metadata: { name: input.name },
  })

  if (error || !created.user) {
    return { error: error?.message || 'Falha ao criar usuário' }
  }

  const userId = created.user.id

  await supabase.from('profiles').insert({
    id: userId,
    name: input.name,
    perfil: input.perfil,
    current_loja_id: input.lojaIds[0] ?? null,
  })

  // Vincular as lojas
  for (const lojaId of input.lojaIds) {
    await supabase.from('loja_user').insert({ loja_id: lojaId, user_id: userId })
  }

  // Usuario (nao-admin): concede todas as permissoes nas lojas selecionadas.
  // Granularidade fina pode ser ajustada depois.
  if (input.perfil === 'Usuario') {
    const { data: permissoes } = await supabase.from('permissoes').select('id')
    const rows = input.lojaIds.flatMap((lojaId) =>
      (permissoes ?? []).map((p) => ({ loja_id: lojaId, permissao_id: p.id, user_id: userId }))
    )
    if (rows.length) await supabase.from('permissao_user').insert(rows)
  }

  revalidatePath('/usuario')
  return { ok: true, senha }
}

export async function editarUsuario(
  userId: string,
  input: { name: string; perfil: 'Admin' | 'Usuario'; lojaIds: number[] }
) {
  if (!(await isAdmin())) return { error: 'Apenas administradores' }
  if (!input.name) return { error: 'Nome obrigatório' }

  const supabase = createServiceClient()

  await supabase
    .from('profiles')
    .update({ name: input.name, perfil: input.perfil })
    .eq('id', userId)

  // Sincroniza loja_user: remove as que sairam, adiciona as novas
  const { data: atuais } = await supabase
    .from('loja_user')
    .select('loja_id')
    .eq('user_id', userId)
  const atuaisIds = (atuais ?? []).map((r) => r.loja_id as number)

  const remover = atuaisIds.filter((id) => !input.lojaIds.includes(id))
  const adicionar = input.lojaIds.filter((id) => !atuaisIds.includes(id))

  if (remover.length) {
    await supabase
      .from('loja_user')
      .delete()
      .eq('user_id', userId)
      .in('loja_id', remover)
    // Tira tambem as permissoes/locais das lojas removidas
    await supabase
      .from('permissao_user')
      .delete()
      .eq('user_id', userId)
      .in('loja_id', remover)
    await supabase
      .from('local_estoque_user')
      .delete()
      .eq('user_id', userId)
      .in('loja_id', remover)
  }

  if (adicionar.length) {
    await supabase
      .from('loja_user')
      .insert(adicionar.map((loja_id) => ({ loja_id, user_id: userId })))
  }

  // Se virou Admin, concede todas as permissoes nas lojas vinculadas
  if (input.perfil === 'Admin' && adicionar.length) {
    const { data: permissoes } = await supabase.from('permissoes').select('id')
    const rows = adicionar.flatMap((lojaId) =>
      (permissoes ?? []).map((p) => ({ loja_id: lojaId, permissao_id: p.id, user_id: userId }))
    )
    if (rows.length) await supabase.from('permissao_user').insert(rows)
  }

  // Garante current_loja_id valido
  if (input.lojaIds.length) {
    const { data: prof } = await supabase
      .from('profiles')
      .select('current_loja_id')
      .eq('id', userId)
      .single<{ current_loja_id: number | null }>()
    if (!prof?.current_loja_id || !input.lojaIds.includes(prof.current_loja_id)) {
      await supabase
        .from('profiles')
        .update({ current_loja_id: input.lojaIds[0] })
        .eq('id', userId)
    }
  }

  revalidatePath('/usuario')
  return { ok: true }
}

export async function togglePermissao(
  userId: string,
  lojaId: number,
  permissaoId: number,
  ativar: boolean
) {
  if (!(await isAdmin())) return { error: 'Apenas administradores' }
  const supabase = createServiceClient()

  if (ativar) {
    const { data: existe } = await supabase
      .from('permissao_user')
      .select('id')
      .eq('user_id', userId)
      .eq('loja_id', lojaId)
      .eq('permissao_id', permissaoId)
      .maybeSingle()
    if (!existe) {
      await supabase
        .from('permissao_user')
        .insert({ user_id: userId, loja_id: lojaId, permissao_id: permissaoId })
    }
  } else {
    await supabase
      .from('permissao_user')
      .delete()
      .eq('user_id', userId)
      .eq('loja_id', lojaId)
      .eq('permissao_id', permissaoId)
  }

  revalidatePath('/usuario')
  return { ok: true }
}

export async function toggleLocal(
  userId: string,
  lojaId: number,
  localEstoqueId: number,
  ativar: boolean
) {
  if (!(await isAdmin())) return { error: 'Apenas administradores' }
  const supabase = createServiceClient()

  if (ativar) {
    const { data: existe } = await supabase
      .from('local_estoque_user')
      .select('id')
      .eq('user_id', userId)
      .eq('loja_id', lojaId)
      .eq('local_estoque_id', localEstoqueId)
      .maybeSingle()
    if (!existe) {
      await supabase
        .from('local_estoque_user')
        .insert({ user_id: userId, loja_id: lojaId, local_estoque_id: localEstoqueId })
    }
  } else {
    await supabase
      .from('local_estoque_user')
      .delete()
      .eq('user_id', userId)
      .eq('loja_id', lojaId)
      .eq('local_estoque_id', localEstoqueId)
  }

  revalidatePath('/usuario')
  return { ok: true }
}

export async function excluirUsuario(userId: string) {
  if (!(await isAdmin())) return { error: 'Apenas administradores' }
  const supabase = createServiceClient()
  await supabase.auth.admin.deleteUser(userId)
  revalidatePath('/usuario')
  return { ok: true }
}
