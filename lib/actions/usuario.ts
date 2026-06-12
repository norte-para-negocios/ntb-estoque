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
  if (!input.name || !input.email) return { error: 'Nome e e-mail obrigatorios' }

  const supabase = createServiceClient()
  const senha = senhaAleatoria()

  const { data: created, error } = await supabase.auth.admin.createUser({
    email: input.email,
    password: senha,
    email_confirm: true,
    user_metadata: { name: input.name },
  })

  if (error || !created.user) {
    return { error: error?.message || 'Falha ao criar usuario' }
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

export async function excluirUsuario(userId: string) {
  if (!(await isAdmin())) return { error: 'Apenas administradores' }
  const supabase = createServiceClient()
  await supabase.auth.admin.deleteUser(userId)
  revalidatePath('/usuario')
  return { ok: true }
}
