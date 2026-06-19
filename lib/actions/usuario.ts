'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getUser, getAtorGestao, type AtorGestao } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

// Converte erros brutos do Supabase/Postgres em mensagens amigaveis ao usuario.
function mensagemAmigavel(err: { code?: string; message?: string }): string {
  const code = err.code ?? ''
  if (code === '23505') return 'Este registro já existe.'
  if (code === '42501' || code === '42P01') return 'Sem permissão para executar esta ação.'
  if (code.startsWith('PGRST')) return 'Erro de consulta. Tente novamente.'
  return 'Erro ao salvar. Tente novamente.'
}

// Helpers de escopo (frente C). O ator e Admin global OU AdminLoja na propria loja.
//
// AdminLoja: so cria/aprova/edita perfil 'Usuario', so nas lojas dele, e as
// permissoes que concede nao excedem as dele (ele tem acesso total as lojas dele,
// entao qualquer permissao do catalogo e valida para essas lojas).

// Confere que o perfil que o ator quer atribuir e permitido para ele.
function perfilPermitido(ator: AtorGestao, perfil: PerfilUsuario): boolean {
  if (ator.isAdminGlobal) return true
  // AdminLoja: so 'Usuario'.
  return perfil === 'Usuario'
}

// Restringe uma lista de lojas ao que o ator pode gerir. Admin global passa direto.
function lojasNoEscopo(ator: AtorGestao, lojaIds: number[]): number[] {
  if (ator.isAdminGlobal) return lojaIds
  return lojaIds.filter((id) => ator.lojaIds.includes(id))
}

// Verifica que o ator pode mexer no usuario alvo: Admin global pode em todos;
// AdminLoja so em usuarios vinculados a alguma loja dele (e que nao sejam Admin
// global nem outro AdminLoja).
async function podeGerirAlvo(
  ator: AtorGestao,
  supabase: ReturnType<typeof createServiceClient>,
  userId: string
): Promise<boolean> {
  if (ator.isAdminGlobal) return true
  if (!ator.isAdminLoja) return false

  const { data: alvo } = await supabase
    .from('profiles')
    .select('perfil')
    .eq('id', userId)
    .maybeSingle<{ perfil: string | null }>()
  // AdminLoja nao mexe em Admin global nem em outro AdminLoja.
  if (!alvo || alvo.perfil === 'Admin' || alvo.perfil === 'AdminLoja') return false

  // O alvo precisa estar vinculado a pelo menos uma loja do ator (ou ser pendente
  // sem vinculo, caso de aprovacao). Para edicao/exclusao exigimos vinculo.
  const { data: vinc } = await supabase
    .from('loja_user')
    .select('loja_id')
    .eq('user_id', userId)
    .in('loja_id', ator.lojaIds.length ? ator.lojaIds : [-1])
  return (vinc ?? []).length > 0
}

function senhaAleatoria(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let s = ''
  // Usa crypto para entropia (disponivel no runtime Node do Next)
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  for (const b of bytes) s += chars[b % chars.length]
  return s + '@1'
}

// Perfis do sistema:
// - 'Admin'     = admin GLOBAL (todas as lojas, administracao global).
// - 'AdminLoja' = admin DA LOJA (acesso total aos modulos das lojas vinculadas, nao global).
// - 'Usuario'   = restrito por loja + permissoes escolhidas.
export type PerfilUsuario = 'Admin' | 'AdminLoja' | 'Usuario'

export async function criarUsuario(input: {
  name: string
  email: string
  perfil: PerfilUsuario
  lojaIds: number[]
  // Ids das permissoes que o usuario tera EM CADA loja selecionada (4.1).
  // Quando ausente/undefined, concede TODAS (compatibilidade com chamadas antigas).
  permissaoIds?: number[]
}) {
  const ator = await getAtorGestao()
  if (!ator.podeGerir) return { error: 'Sem permissão para criar usuários.' }
  if (!input.name || !input.email) return { error: 'Nome e e-mail obrigatórios' }

  // Escopo de perfil (frente C): AdminLoja so cria 'Usuario'.
  if (!perfilPermitido(ator, input.perfil)) {
    return { error: 'Você só pode criar usuários comuns.' }
  }

  // Escopo de loja: Admin global -> todas (quando perfil Admin) ou as escolhidas;
  // AdminLoja -> intersecao com as lojas dele. Admin global criando 'Admin' usa todas.
  let lojaIds: number[]
  if (input.perfil === 'Admin') {
    // So Admin global chega aqui (perfilPermitido ja barrou AdminLoja). Admin global
    // recebe todas as lojas ativas.
    lojaIds = ator.lojaIds
  } else {
    lojaIds = lojasNoEscopo(ator, input.lojaIds)
    if (lojaIds.length === 0) {
      return { error: 'Selecione ao menos uma loja válida.' }
    }
  }

  const supabase = createServiceClient()
  const senha = senhaAleatoria()

  const { data: created, error } = await supabase.auth.admin.createUser({
    email: input.email,
    password: senha,
    email_confirm: true,
    user_metadata: { name: input.name },
  })

  if (error || !created.user) {
    return { error: error ? mensagemAmigavel(error) : 'Falha ao criar usuário.' }
  }

  const userId = created.user.id

  await supabase.from('profiles').insert({
    id: userId,
    name: input.name,
    email: input.email,
    perfil: input.perfil,
    current_loja_id: lojaIds[0] ?? null,
  })

  // Vincular as lojas (ja escopadas ao ator)
  for (const lojaId of lojaIds) {
    await supabase.from('loja_user').insert({ loja_id: lojaId, user_id: userId })
  }

  // Admin de loja: acesso total = TODAS as permissoes nas lojas vinculadas.
  // Usuario: as permissoes ESCOLHIDAS (ou todas, se nao veio lista).
  if (input.perfil === 'AdminLoja' || input.perfil === 'Usuario') {
    let permissaoIds: number[]
    if (input.perfil === 'AdminLoja' || input.permissaoIds === undefined) {
      const { data: permissoes } = await supabase.from('permissoes').select('id')
      permissaoIds = (permissoes ?? []).map((p) => p.id as number)
    } else {
      permissaoIds = input.permissaoIds
    }
    const rows = lojaIds.flatMap((lojaId) =>
      permissaoIds.map((permissao_id) => ({ loja_id: lojaId, permissao_id, user_id: userId }))
    )
    if (rows.length) await supabase.from('permissao_user').insert(rows)
  }

  revalidatePath('/usuario')
  return { ok: true, senha }
}

export async function editarUsuario(
  userId: string,
  input: { name: string; perfil: PerfilUsuario; lojaIds: number[] }
) {
  const ator = await getAtorGestao()
  if (!ator.podeGerir) return { error: 'Sem permissão para editar usuários.' }
  if (!input.name) return { error: 'Nome obrigatório' }

  const supabase = createServiceClient()

  // Escopo do alvo: AdminLoja so edita 'Usuario' vinculado a loja dele.
  if (!(await podeGerirAlvo(ator, supabase, userId))) {
    return { error: 'Você não pode editar este usuário.' }
  }
  // Escopo de perfil: AdminLoja nao promove ninguem a Admin/AdminLoja.
  if (!perfilPermitido(ator, input.perfil)) {
    return { error: 'Você só pode manter o usuário como usuário comum.' }
  }

  // Escopo de lojas. Para AdminLoja: as lojas FORA do escopo dele que o alvo ja tem
  // devem ser PRESERVADAS (ele nao enxerga nem mexe nelas); ele so soma/remove as
  // lojas dele. Admin global controla a lista inteira.
  const { data: atuais } = await supabase
    .from('loja_user')
    .select('loja_id')
    .eq('user_id', userId)
  const atuaisIds = (atuais ?? []).map((r) => r.loja_id as number)

  let alvoLojaIds: number[]
  if (ator.isAdminGlobal) {
    alvoLojaIds = input.lojaIds
  } else {
    // Lojas fora do escopo do AdminLoja que o alvo ja tinha: mantem.
    const foraDoEscopo = atuaisIds.filter((id) => !ator.lojaIds.includes(id))
    // Dentro do escopo: o que o AdminLoja escolheu (intersecao com as dele).
    const dentro = lojasNoEscopo(ator, input.lojaIds)
    alvoLojaIds = [...new Set([...foraDoEscopo, ...dentro])]
  }
  if (alvoLojaIds.length === 0 && input.perfil !== 'Admin') {
    return { error: 'Selecione ao menos uma loja válida.' }
  }

  await supabase
    .from('profiles')
    .update({ name: input.name, perfil: input.perfil })
    .eq('id', userId)

  const remover = atuaisIds.filter((id) => !alvoLojaIds.includes(id))
  const adicionar = alvoLojaIds.filter((id) => !atuaisIds.includes(id))

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

  // Admin (global) ou Admin de loja: concede todas as permissoes nas lojas
  // recem-adicionadas (acesso total a essas lojas).
  if ((input.perfil === 'Admin' || input.perfil === 'AdminLoja') && adicionar.length) {
    const { data: permissoes } = await supabase.from('permissoes').select('id')
    const rows = adicionar.flatMap((lojaId) =>
      (permissoes ?? []).map((p) => ({ loja_id: lojaId, permissao_id: p.id, user_id: userId }))
    )
    if (rows.length) {
      await supabase
        .from('permissao_user')
        .upsert(rows, { onConflict: 'loja_id,permissao_id,user_id' })
    }
  }

  // Garante current_loja_id valido
  if (alvoLojaIds.length) {
    const { data: prof } = await supabase
      .from('profiles')
      .select('current_loja_id')
      .eq('id', userId)
      .single<{ current_loja_id: number | null }>()
    if (!prof?.current_loja_id || !alvoLojaIds.includes(prof.current_loja_id)) {
      await supabase
        .from('profiles')
        .update({ current_loja_id: alvoLojaIds[0] })
        .eq('id', userId)
    }
  }

  revalidatePath('/usuario')
  return { ok: true }
}

// Aprova um cadastro pendente: define perfil, vincula lojas, concede as PERMISSOES
// escolhidas e muda o status para 'aprovado' (libera o acesso). Frente B: o admin
// escolhe perfil + lojas + permissoes na hora de aprovar.
export async function aprovarUsuario(
  userId: string,
  input: { perfil: PerfilUsuario; lojaIds: number[]; permissaoIds?: number[] }
) {
  const ator = await getAtorGestao()
  if (!ator.podeGerir) return { error: 'Sem permissão para aprovar usuários.' }

  // Escopo de perfil (frente C): AdminLoja so aprova como 'Usuario'.
  if (!perfilPermitido(ator, input.perfil)) {
    return { error: 'Você só pode aprovar como usuário comum.' }
  }

  const supabase = createServiceClient()

  // O alvo precisa estar pendente. AdminLoja so aprova pendentes (que ainda nao tem
  // dono); Admin global aprova qualquer pendente.
  const { data: alvo } = await supabase
    .from('profiles')
    .select('status')
    .eq('id', userId)
    .maybeSingle<{ status: string | null }>()
  if (!alvo) return { error: 'Usuário não encontrado.' }
  if (alvo.status !== 'pendente') return { error: 'Este cadastro não está pendente.' }

  // Lojas: Admin global criando Admin -> todas ativas. Caso contrario -> escolhidas
  // (AdminLoja limitado as lojas dele).
  let lojaIds: number[]
  if (input.perfil === 'Admin') {
    lojaIds = ((await supabase.from('lojas').select('id').eq('ativo', true)).data ?? []).map(
      (l) => l.id as number
    )
  } else {
    lojaIds = lojasNoEscopo(ator, input.lojaIds)
    if (lojaIds.length === 0) return { error: 'Selecione ao menos uma loja válida.' }
  }

  await supabase
    .from('profiles')
    .update({ perfil: input.perfil, status: 'aprovado', current_loja_id: lojaIds[0] ?? null })
    .eq('id', userId)

  // Vincula as lojas (evita duplicar as ja existentes)
  const { data: jaVinc } = await supabase.from('loja_user').select('loja_id').eq('user_id', userId)
  const jaIds = (jaVinc ?? []).map((r) => r.loja_id as number)
  const novas = lojaIds.filter((id) => !jaIds.includes(id))
  if (novas.length) {
    await supabase.from('loja_user').insert(novas.map((loja_id) => ({ loja_id, user_id: userId })))
  }

  // Permissoes: Admin e AdminLoja -> acesso total (todas). Usuario -> as ESCOLHIDAS.
  // Array vazio explicito para perfil Usuario e rejeitado (sem permissao = sem acesso util).
  let permissaoIds: number[]
  if (input.perfil === 'Admin' || input.perfil === 'AdminLoja') {
    const { data: permissoes } = await supabase.from('permissoes').select('id')
    permissaoIds = (permissoes ?? []).map((p) => p.id as number)
  } else {
    // perfil === 'Usuario': exige ao menos uma permissao escolhida
    if (!input.permissaoIds || input.permissaoIds.length === 0) {
      return { error: 'Selecione ao menos uma permissão.' }
    }
    permissaoIds = input.permissaoIds
  }
  const rows = lojaIds.flatMap((lojaId) =>
    permissaoIds.map((permissao_id) => ({ loja_id: lojaId, permissao_id, user_id: userId }))
  )
  if (rows.length) {
    await supabase.from('permissao_user').upsert(rows, { onConflict: 'loja_id,permissao_id,user_id' })
  }

  revalidatePath('/usuario')
  return { ok: true }
}

// Recusa um cadastro pendente: remove a conta de auth (cascade apaga o profile).
export async function recusarUsuario(userId: string) {
  const ator = await getAtorGestao()
  if (!ator.podeGerir) return { error: 'Sem permissão.' }
  const supabase = createServiceClient()
  // So recusa pendentes. AdminLoja tambem pode (pendentes nao tem dono ainda).
  const { data: alvo } = await supabase
    .from('profiles')
    .select('status')
    .eq('id', userId)
    .maybeSingle<{ status: string | null }>()
  if (alvo?.status !== 'pendente') return { error: 'Este cadastro não está pendente.' }
  const { error } = await supabase.auth.admin.deleteUser(userId)
  if (error) return { error: 'Não foi possível recusar o cadastro.' }
  revalidatePath('/usuario')
  return { ok: true }
}

// Exclui um usuario ja existente: remove a conta de auth (cascade apaga profile,
// vinculos de loja, permissoes e locais). O admin nao pode excluir a propria conta.
export async function excluirUsuario(userId: string) {
  const ator = await getAtorGestao()
  if (!ator.podeGerir) return { error: 'Sem permissão para excluir usuários.' }
  const me = await getUser()
  if (me.id === userId) return { error: 'Você não pode excluir a própria conta' }
  const supabase = createServiceClient()
  if (!(await podeGerirAlvo(ator, supabase, userId))) {
    return { error: 'Você não pode excluir este usuário.' }
  }
  const { error } = await supabase.auth.admin.deleteUser(userId)
  if (error) return { error: 'Não foi possível excluir o usuário.' }
  revalidatePath('/usuario')
  return { ok: true }
}

export async function togglePermissao(
  userId: string,
  lojaId: number,
  permissaoId: number,
  ativar: boolean
) {
  const ator = await getAtorGestao()
  if (!ator.podeGerir) return { error: 'Sem permissão.' }
  // Escopo: AdminLoja so mexe nas permissoes de lojas dele e em usuarios dele.
  if (!ator.isAdminGlobal && !ator.lojaIds.includes(lojaId)) {
    return { error: 'Você não pode alterar permissões desta loja.' }
  }
  const supabase = createServiceClient()
  if (!(await podeGerirAlvo(ator, supabase, userId))) {
    return { error: 'Você não pode alterar este usuário.' }
  }

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
  const ator = await getAtorGestao()
  if (!ator.podeGerir) return { error: 'Sem permissão.' }
  if (!ator.isAdminGlobal && !ator.lojaIds.includes(lojaId)) {
    return { error: 'Você não pode alterar locais desta loja.' }
  }
  const supabase = createServiceClient()
  if (!(await podeGerirAlvo(ator, supabase, userId))) {
    return { error: 'Você não pode alterar este usuário.' }
  }

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

