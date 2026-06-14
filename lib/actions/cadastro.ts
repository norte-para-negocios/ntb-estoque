'use server'

import { createServiceClient } from '@/lib/supabase/server'

// Cadastro publico: a pessoa cria a propria conta (e-mail + senha) e fica PENDENTE.
// Sem confirmacao de e-mail (nao depende de SMTP); o gate real e a aprovacao do admin.
export async function cadastrar(_prevState: unknown, formData: FormData) {
  const name = (formData.get('name') as string)?.trim()
  const email = (formData.get('email') as string)?.trim().toLowerCase()
  const password = formData.get('password') as string

  if (!name || !email || !password) {
    return { error: 'Preencha nome, e-mail e senha.' }
  }
  if (password.length < 6) {
    return { error: 'A senha precisa ter ao menos 6 caracteres.' }
  }

  const supabase = createServiceClient()

  const { data: created, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  })

  if (error || !created.user) {
    const msg = error?.message || ''
    if (/registered|already|exists/i.test(msg)) {
      return { error: 'Já existe uma conta com esse e-mail.' }
    }
    return { error: 'Não foi possível concluir o cadastro. Tente novamente.' }
  }

  const { error: perfilErro } = await supabase.from('profiles').insert({
    id: created.user.id,
    name,
    email,
    perfil: 'Usuario',
    status: 'pendente',
    current_loja_id: null,
  })

  if (perfilErro) {
    // desfaz o usuario de auth para nao deixar conta orfa sem profile
    await supabase.auth.admin.deleteUser(created.user.id)
    return { error: 'Não foi possível concluir o cadastro. Tente novamente.' }
  }

  return { ok: true }
}
