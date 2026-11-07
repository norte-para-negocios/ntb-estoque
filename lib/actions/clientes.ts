'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'

// Fase 6 (migration 450): clientes e transportadoras do ESTOQUE PRÓPRIO (lojas Omie seguem com o cadastro do Omie, sem esta tela).
// Só desenvolvedor por enquanto (layout novo). Nada vai ao Omie.
import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { ehDesenvolvedor } from '@/lib/recursos-dev'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { registrarAuditoria } from '@/lib/auditoria'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { validarCnpjCpf } from '@/lib/importacao/planilha-puro'
import { juntarPapel, planoTransportadoras, soDigitos, validarCliente, type ClienteInput, type Papel, type TransporteNota } from '@/lib/clientes/clientes-puro'

type Erro = { error: string }

async function contexto(permissao: string): Promise<{ lojaId: number } | Erro> {
  if (!(await ehDesenvolvedor())) return { error: 'Recurso ainda em teste.' }
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') return { error: 'Clientes e transportadoras: só no estoque próprio (nas lojas Omie o cadastro é o do Omie).' }
  if (!(await requirePermissao(lojaId, permissao))) return { error: 'Sem permissão' }
  return { lojaId }
}

/** Mesmo documento já cadastrado na loja (outro registro): devolve o nome dele. */
async function documentoEmUso(lojaId: number, doc: string | null, ignorarId?: number): Promise<string | null> {
  if (!doc) return null
  const { data } = await createServiceClient().from('clientes').select('id, razao_social, cnpj_cpf').eq('loja_id', lojaId).ilike('cnpj_cpf', `%${doc.slice(-6)}%`)
  const dono = (data ?? []).find((c) => soDigitos(c.cnpj_cpf as string) === doc && c.id !== ignorarId)
  return dono ? (dono.razao_social as string) : null
}

export async function criarCliente(dados: ClienteInput): Promise<{ ok: true; id: number } | Erro> {
  const __d = viaDesktop('clientes#criarCliente', criarCliente, [dados]); if (__d) return __d as never
  const ctx = await contexto('Clientes - Criar')
  if ('error' in ctx) return ctx
  const v = validarCliente(dados, validarCnpjCpf)
  if (!v.ok) return { error: v.erro }
  const dono = await documentoEmUso(ctx.lojaId, v.linha.cnpj_cpf as string | null)
  if (dono) return { error: `Já existe um cadastro com este CNPJ/CPF: ${dono}` }
  const { data, error } = await createServiceClient().from('clientes').insert({ loja_id: ctx.lojaId, origem: 'local', ...v.linha }).select('id').single()
  if (error) return { error: error.message }
  await registrarAuditoria('criar', 'cliente', data.id as number, v.linha.razao_social as string)
  revalidatePath('/cliente')
  return { ok: true, id: data.id as number }
}

export async function editarCliente(id: number, dados: ClienteInput): Promise<{ ok: true } | Erro> {
  const __d = viaDesktop('clientes#editarCliente', editarCliente, [id, dados]); if (__d) return __d as never
  const ctx = await contexto('Clientes - Editar')
  if ('error' in ctx) return ctx
  const v = validarCliente(dados, validarCnpjCpf)
  if (!v.ok) return { error: v.erro }
  const dono = await documentoEmUso(ctx.lojaId, v.linha.cnpj_cpf as string | null, id)
  if (dono) return { error: `Já existe um cadastro com este CNPJ/CPF: ${dono}` }
  const { data, error } = await createServiceClient().from('clientes').update({ ...v.linha, updated_at: new Date().toISOString() })
    .eq('id', id).eq('loja_id', ctx.lojaId).select('id')
  if (error) return { error: error.message }
  if (!data?.length) return { error: 'Cadastro não encontrado' }
  await registrarAuditoria('editar', 'cliente', id, v.linha.razao_social as string)
  revalidatePath('/cliente')
  return { ok: true }
}

export async function excluirCliente(id: number): Promise<{ ok: true } | Erro> {
  const __d = viaDesktop('clientes#excluirCliente', excluirCliente, [id]); if (__d) return __d as never
  const ctx = await contexto('Clientes - Excluir')
  if ('error' in ctx) return ctx
  const { data, error } = await createServiceClient().from('clientes').delete().eq('id', id).eq('loja_id', ctx.lojaId).select('razao_social')
  if (error) return { error: error.message }
  if (!data?.length) return { error: 'Cadastro não encontrado' }
  await registrarAuditoria('excluir', 'cliente', id, (data[0].razao_social as string) ?? null)
  revalidatePath('/cliente')
  return { ok: true }
}

/** Cadastra as transportadoras que aparecem nas notas de entrada da loja (bloco transporte da NF-e) e ainda não estão aqui. */
export async function trazerTransportadorasDasNotas(): Promise<{ ok: true; novas: number; viraramAmbos: number } | Erro> {
  const __d = viaDesktop('clientes#trazerTransportadorasDasNotas', trazerTransportadorasDasNotas, []); if (__d) return __d as never
  const ctx = await contexto('Clientes - Criar')
  if ('error' in ctx) return ctx
  const sb = createServiceClient()
  try {
    const falhou = (e: { message: string }) => { throw new Error(e.message) }
    const [notas, existentes] = await Promise.all([
      buscarTodasLinhas<{ id: number; transporte: unknown }>((de, ate) => sb.from('notas_fiscais')
        .select('id, transporte:full_object->transporte').eq('loja_id', ctx.lojaId).not('full_object->transporte->>cNomeTransp', 'is', null)
        .order('id').range(de, ate), undefined, falhou),
      buscarTodasLinhas<{ id: number; cnpj_cpf: string | null; papel: Papel }>((de, ate) => sb.from('clientes')
        .select('id, cnpj_cpf, papel').eq('loja_id', ctx.lojaId).order('id').range(de, ate), undefined, falhou),
    ])
    const plano = planoTransportadoras(
      notas.map((n) => (n.transporte && typeof n.transporte === 'object' ? n.transporte : {}) as TransporteNota),
      existentes.filter((c) => soDigitos(c.cnpj_cpf)).map((c) => ({ id: Number(c.id), cnpj: soDigitos(c.cnpj_cpf), papel: c.papel })),
      validarCnpjCpf,
    )
    if (plano.inserir.length) {
      const { error } = await sb.from('clientes').insert(plano.inserir.map((t) => ({ loja_id: ctx.lojaId, origem: 'nota', papel: 'transportadora', ...t })))
      if (error) return { error: error.message }
    }
    for (const id of plano.virarAmbos) {
      const atual = existentes.find((c) => Number(c.id) === id)
      await sb.from('clientes').update({ papel: juntarPapel(atual?.papel ?? 'cliente', 'transportadora'), updated_at: new Date().toISOString() }).eq('id', id).eq('loja_id', ctx.lojaId)
    }
    if (plano.inserir.length || plano.virarAmbos.length) {
      await registrarAuditoria('criar', 'cliente', 0, `${plano.inserir.length} transportadora(s) das notas; ${plano.virarAmbos.length} cliente(s) viraram também transportadora`)
    }
    revalidatePath('/cliente')
    return { ok: true, novas: plano.inserir.length, viraramAmbos: plano.virarAmbos.length }
  } catch (e) {
    return { error: `Não foi possível ler as notas ou o cadastro agora: ${e instanceof Error ? e.message : String(e)}` }
  }
}
