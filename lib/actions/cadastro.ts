'use server'

import { createServiceClient } from '@/lib/supabase/server'

// Cadastro publico. Tres caminhos, na ordem de prioridade do codigo informado:
//  (1) COM codigo de CONVITE valido (frente A, tabela `convites`): a conta ja entra
//      APROVADA, vinculada a loja do convite, com o PERFIL e as PERMISSOES embutidas
//      no convite; o convite e marcado como usado (uso unico).
//  (2) COM codigo de ONBOARDING da loja (lojas.codigo_onboarding, fluxo 4.5 antigo):
//      a conta entra APROVADA e vinculada aquela loja, como 'Usuario' SEM permissoes
//      (o chefe ajusta depois). Compatibilidade.
//  (3) SEM codigo: a pessoa cria a conta e fica PENDENTE (admin aprova, vincula loja
//      e define as permissoes na tela de Usuarios). Comportamento original.
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

  // Resolve o codigo ANTES de criar a conta. Convite (rico) tem prioridade; se nao
  // casar, tenta o codigo_onboarding da loja (simples).
  type ConviteResolvido = {
    id: number
    loja_id: number
    perfil: string
    permissoes: string[]
    loja_nome: string
  }
  let convite: ConviteResolvido | null = null
  let lojaSimples: { id: number; nome_fantasia: string | null; nome: string } | null = null

  if (codigo) {
    const { data: c } = await supabase
      .from('convites')
      .select('id, loja_id, perfil, permissoes, usado_em, expira_em, lojas(nome, nome_fantasia, ativo)')
      .eq('codigo', codigo)
      .maybeSingle<{
        id: number
        loja_id: number
        perfil: string
        permissoes: unknown
        usado_em: string | null
        expira_em: string | null
        lojas: { nome: string; nome_fantasia: string | null; ativo: boolean } | null
      }>()

    if (c) {
      if (c.usado_em) return { error: 'Este convite já foi utilizado.' }
      if (c.expira_em && new Date(c.expira_em).getTime() < Date.now()) {
        return { error: 'Este convite expirou. Peça um novo ao responsável.' }
      }
      if (!c.lojas?.ativo) return { error: 'A loja deste convite está inativa.' }
      const perms = Array.isArray(c.permissoes)
        ? (c.permissoes as unknown[]).filter((x): x is string => typeof x === 'string')
        : []
      convite = {
        id: c.id,
        loja_id: c.loja_id,
        perfil: c.perfil,
        permissoes: perms,
        loja_nome: c.lojas.nome_fantasia || c.lojas.nome,
      }
    } else {
      // Nao e convite: tenta o codigo de onboarding da loja (fluxo antigo).
      const { data: loja } = await supabase
        .from('lojas')
        .select('id, nome, nome_fantasia')
        .eq('codigo_onboarding', codigo)
        .eq('ativo', true)
        .maybeSingle<{ id: number; nome_fantasia: string | null; nome: string }>()
      if (!loja) {
        return { error: 'Código inválido. Confira com o responsável.' }
      }
      lojaSimples = loja
    }
  }

  const aprovado = !!(convite || lojaSimples)

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

  // Perfil inicial: o do convite (Usuario/AdminLoja) ou 'Usuario' nos demais casos.
  const perfilInicial = convite?.perfil === 'AdminLoja' ? 'AdminLoja' : 'Usuario'
  const lojaId = convite?.loja_id ?? lojaSimples?.id ?? null

  const { error: perfilErro } = await supabase.from('profiles').insert({
    id: userId,
    name,
    email,
    perfil: perfilInicial,
    status: aprovado ? 'aprovado' : 'pendente',
    current_loja_id: lojaId,
  })

  if (perfilErro) {
    // desfaz o usuario de auth para nao deixar conta orfa sem profile
    await supabase.auth.admin.deleteUser(userId)
    return { error: 'Não foi possível concluir o cadastro. Tente novamente.' }
  }

  // CONVITE: vincula a loja, concede permissoes e marca o convite como usado.
  if (convite) {
    await supabase.from('loja_user').insert({ loja_id: convite.loja_id, user_id: userId })

    // AdminLoja por convite = acesso total a loja -> todas as permissoes.
    // Usuario = exatamente as permissoes (nomes) embutidas no convite.
    let permissaoIds: number[] = []
    if (convite.perfil === 'AdminLoja') {
      const { data: todas } = await supabase.from('permissoes').select('id')
      permissaoIds = (todas ?? []).map((p) => p.id as number)
    } else if (convite.permissoes.length) {
      const { data: ps } = await supabase
        .from('permissoes')
        .select('id')
        .in('nome', convite.permissoes)
      permissaoIds = (ps ?? []).map((p) => p.id as number)
    }
    if (permissaoIds.length) {
      await supabase.from('permissao_user').insert(
        permissaoIds.map((permissao_id) => ({
          loja_id: convite!.loja_id,
          permissao_id,
          user_id: userId,
        }))
      )
    }

    await supabase
      .from('convites')
      .update({ usado_em: new Date().toISOString(), usado_por: userId })
      .eq('id', convite.id)

    return { ok: true, entrou: true, loja: convite.loja_nome }
  }

  // CODIGO DE ONBOARDING DA LOJA: vincula a loja. Sem permissoes (chefe ajusta depois).
  if (lojaSimples) {
    await supabase.from('loja_user').insert({ loja_id: lojaSimples.id, user_id: userId })
    return {
      ok: true,
      entrou: true,
      loja: lojaSimples.nome_fantasia || lojaSimples.nome,
    }
  }

  return { ok: true, entrou: false }
}
