'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getAtorGestao } from '@/lib/auth'
import { registrarAuditoria } from '@/lib/auditoria'
import { revalidatePath } from 'next/cache'

export type CargoComPermissoes = {
  id: number
  nome: string
  descricao: string | null
  permissaoIds: number[]
}

// Lista todos os cargos (globais) com os ids de permissão de cada. Leitura para
// montar a tela de Cargos e o dropdown no usuário.
export async function listarCargos(): Promise<CargoComPermissoes[]> {
  const supabase = createServiceClient()
  const { data: cargos } = await supabase.from('cargos').select('id, nome, descricao').order('nome')
  const { data: vinc } = await supabase.from('cargo_permissao').select('cargo_id, permissao_id')
  const porCargo = new Map<number, number[]>()
  for (const v of vinc ?? []) {
    const arr = porCargo.get(v.cargo_id as number) ?? []
    arr.push(v.permissao_id as number)
    porCargo.set(v.cargo_id as number, arr)
  }
  return (cargos ?? []).map((c) => ({
    id: c.id as number,
    nome: c.nome as string,
    descricao: (c.descricao as string | null) ?? null,
    permissaoIds: porCargo.get(c.id as number) ?? [],
  }))
}

async function gerirOuErro() {
  const ator = await getAtorGestao()
  if (!ator.podeGerir) return { error: 'Sem permissão para gerir cargos' as const }
  return { ator }
}

// Substitui as permissões de um cargo pelo conjunto informado (delete + insert).
async function setPermissoesDoCargo(cargoId: number, permissaoIds: number[]) {
  const supabase = createServiceClient()
  await supabase.from('cargo_permissao').delete().eq('cargo_id', cargoId)
  if (permissaoIds.length) {
    await supabase.from('cargo_permissao').insert(permissaoIds.map((permissao_id) => ({ cargo_id: cargoId, permissao_id })))
  }
}

export async function criarCargo(input: { nome: string; descricao?: string; permissaoIds: number[] }) {
  const g = await gerirOuErro()
  if ('error' in g) return g
  const nome = input.nome.trim()
  if (!nome) return { error: 'Informe o nome do cargo' }
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('cargos')
    .insert({ nome, descricao: input.descricao?.trim() || null })
    .select('id')
    .single<{ id: number }>()
  if (error || !data) return { error: error?.code === '23505' ? 'Já existe um cargo com esse nome' : 'Falha ao criar o cargo' }
  await setPermissoesDoCargo(data.id, input.permissaoIds)
  await registrarAuditoria('criar', 'cargo', data.id, nome)
  revalidatePath('/cargo')
  return { ok: true, id: data.id }
}

export async function editarCargo(id: number, input: { nome: string; descricao?: string; permissaoIds: number[] }) {
  const g = await gerirOuErro()
  if ('error' in g) return g
  const nome = input.nome.trim()
  if (!nome) return { error: 'Informe o nome do cargo' }
  const supabase = createServiceClient()
  const { error } = await supabase.from('cargos').update({ nome, descricao: input.descricao?.trim() || null }).eq('id', id)
  if (error) return { error: error.code === '23505' ? 'Já existe um cargo com esse nome' : 'Falha ao salvar o cargo' }
  await setPermissoesDoCargo(id, input.permissaoIds)
  await registrarAuditoria('editar', 'cargo', id, nome)
  revalidatePath('/cargo')
  return { ok: true }
}

export async function excluirCargo(id: number) {
  const g = await gerirOuErro()
  if ('error' in g) return g
  const supabase = createServiceClient()
  // Solta o cargo dos vínculos (loja_user.cargo_id -> null) antes de excluir.
  await supabase.from('loja_user').update({ cargo_id: null }).eq('cargo_id', id)
  const { error } = await supabase.from('cargos').delete().eq('id', id)
  if (error) return { error: 'Falha ao excluir o cargo' }
  await registrarAuditoria('excluir', 'cargo', id, null)
  revalidatePath('/cargo')
  return { ok: true }
}

// Define (ou remove, com cargoId null) o cargo de um usuário NUMA loja.
export async function definirCargoUsuario(userId: string, lojaId: number, cargoId: number | null) {
  const g = await gerirOuErro()
  if ('error' in g) return g
  // AdminLoja só mexe nas lojas dele.
  if (!g.ator.isAdminGlobal && !g.ator.lojaIds.includes(lojaId)) return { error: 'Sem permissão nesta loja' }
  const supabase = createServiceClient()
  const { error } = await supabase.from('loja_user').update({ cargo_id: cargoId }).eq('user_id', userId).eq('loja_id', lojaId)
  if (error) return { error: 'Falha ao definir o cargo' }
  revalidatePath('/usuario')
  return { ok: true }
}
