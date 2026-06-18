'use server'

import { createServiceClient } from '@/lib/supabase/server'

// Cadastro publico. Dois fluxos:
//  (1) SEM codigo de loja: a pessoa cria a conta e fica PENDENTE (admin aprova,
//      vincula loja e permissoes). Comportamento original.
//  (2) COM codigo de loja valido (4.5): a conta ja entra APROVADA e vinculada
//      aquela loja, como 'Usuario' SEM permissoes (o chefe ajusta as permissoes
//      depois, na tela de Usuarios). Perfil mais alto que 'Usuario' nao se
//      auto-concede por codigo: e o admin que promove.
//  >> Fluxo exato (entrar aprovado x pendente, perfil pelo codigo) a CONFIRMAR
//     com o Andre. Esta e uma versao sensata e funcional.
export async function cadastrar(_prevState: unknown, formData: FormData) {
  const name = (formData.get('name') as string)?.trim()
  const email = (formData.get('email') as string)?.trim().toLowerCase()
  const password = formData.get('password') as string
  const codigo = (formData.get('codigo') as string)?.trim().toUpperCase()

  if (!name || !email || !password) {
    return { error: 'Preencha nome, e-mail e senha.' }
  }
  if (password.length < 6) {
    return { error: 'A senha precisa ter ao menos 6 caracteres.' }
  }

  const supabase = createServiceClient()

  // Se informou codigo, valida ANTES de criar a conta.
  let lojaDoCodigo: { id: number; nome_fantasia: string | null; nome: string } | null = null
  if (codigo) {
    const { data: loja } = await supabase
      .from('lojas')
      .select('id, nome, nome_fantasia')
      .eq('codigo_onboarding', codigo)
      .eq('ativo', true)
      .maybeSingle<{ id: number; nome_fantasia: string | null; nome: string }>()
    if (!loja) {
      return { error: 'Código de loja inválido. Confira com o responsável.' }
    }
    lojaDoCodigo = loja
  }

  const aprovado = !!lojaDoCodigo

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

  const userId = created.user.id

  const { error: perfilErro } = await supabase.from('profiles').insert({
    id: userId,
    name,
    email,
    perfil: 'Usuario',
    status: aprovado ? 'aprovado' : 'pendente',
    current_loja_id: lojaDoCodigo?.id ?? null,
  })

  if (perfilErro) {
    // desfaz o usuario de auth para nao deixar conta orfa sem profile
    await supabase.auth.admin.deleteUser(userId)
    return { error: 'Não foi possível concluir o cadastro. Tente novamente.' }
  }

  // Com codigo valido: vincula a loja. Sem permissoes (o chefe ajusta depois).
  if (lojaDoCodigo) {
    await supabase.from('loja_user').insert({ loja_id: lojaDoCodigo.id, user_id: userId })
    return {
      ok: true,
      entrou: true,
      loja: lojaDoCodigo.nome_fantasia || lojaDoCodigo.nome,
    }
  }

  return { ok: true, entrou: false }
}
