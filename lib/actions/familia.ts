'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { syncFamilias, incluirFamilia, alterarFamilia, excluirFamiliaOmie } from '@/lib/omie/familia'
import { registrarAuditoria } from '@/lib/auditoria'
import type { LojaOmie } from '@/lib/omie/client'

export type FamiliaInput = {
  nome: string
  codigo: string // codInt opcional
  inativo: boolean
}

async function getLoja(lojaId: number) {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret')
    .eq('id', lojaId)
    .single<LojaOmie>()
  return data
}

/**
 * Cria uma familia no Omie (IncluirFamilia) e grava no banco com o codigo retornado.
 * Se o Omie falhar, retorna erro e nao salva localmente (o codigo e obrigatorio para
 * manter sincronia — uma familia local sem codigo_familia nao pode ser usada no Omie).
 */
export async function criarFamilia(dados: FamiliaInput) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Familias - Criar'))) return { error: 'Sem permissão' }
  if (!dados.nome.trim()) return { error: 'Informe o nome da família' }

  const loja = await getLoja(lojaId)
  if (!loja?.omie_app_key) return { error: 'Loja sem chave do Omie' }

  try {
    const res = await incluirFamilia(loja, {
      nomeFamilia: dados.nome.trim(),
      codInt: dados.codigo.trim() || undefined,
    })

    const supabase = createServiceClient()
    const { error } = await supabase.from('familias').insert({
      loja_id: lojaId,
      codigo_familia: res.codigo,
      nome: dados.nome.trim(),
      codigo: dados.codigo.trim() || null,
      inativo: dados.inativo,
      origem: 'omie',
    })
    if (error) return { error: error.message }

    await registrarAuditoria('criar', 'família', res.codigo, dados.nome.trim())
    revalidatePath('/familia')
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao criar a família no Omie' }
  }
}

export async function editarFamilia(id: number, dados: FamiliaInput) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Familias - Editar'))) return { error: 'Sem permissão' }
  if (!dados.nome.trim()) return { error: 'Informe o nome da família' }

  const supabase = createServiceClient()

  // Le codigo_familia para saber se ja existe no Omie.
  const { data: atual } = await supabase
    .from('familias')
    .select('codigo_familia, nome')
    .eq('id', id)
    .eq('loja_id', lojaId)
    .single()
  if (!atual) return { error: 'Família não encontrada' }

  const { error } = await supabase
    .from('familias')
    .update({
      nome: dados.nome.trim(),
      codigo: dados.codigo.trim() || null,
      inativo: dados.inativo,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('loja_id', lojaId)
  if (error) return { error: error.message }

  await registrarAuditoria('editar', 'família', id, dados.nome.trim())
  revalidatePath('/familia')

  const codigoFamilia = atual.codigo_familia as number | null
  const loja = await getLoja(lojaId)
  if (!loja?.omie_app_key) return { ok: true, omieError: 'Loja sem chave do Omie: alteração salva localmente.' }

  try {
    if (codigoFamilia) {
      // Familia ja existe no Omie: altera.
      await alterarFamilia(loja, {
        codigo: codigoFamilia,
        nomeFamilia: dados.nome.trim(),
        codInt: dados.codigo.trim() || undefined,
        inativo: dados.inativo,
      })
    } else {
      // Familia criada localmente antes desta feature: cria no Omie agora e salva o codigo.
      const res = await incluirFamilia(loja, {
        nomeFamilia: dados.nome.trim(),
        codInt: dados.codigo.trim() || undefined,
      })
      await supabase
        .from('familias')
        .update({ codigo_familia: res.codigo, origem: 'omie' })
        .eq('id', id)
        .eq('loja_id', lojaId)
    }
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha ao enviar ao Omie'
    return { ok: true, omieError: msg }
  }
}

export async function excluirFamilia(id: number) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Familias - Excluir'))) return { error: 'Sem permissão' }

  const supabase = createServiceClient()
  const { data: alvo } = await supabase
    .from('familias')
    .select('nome, codigo_familia')
    .eq('id', id)
    .eq('loja_id', lojaId)
    .maybeSingle()
  const { error } = await supabase.from('familias').delete().eq('id', id).eq('loja_id', lojaId)
  if (error) return { error: error.message }

  await registrarAuditoria('excluir', 'família', id, alvo?.nome ?? null)
  revalidatePath('/familia')

  const codigoFamilia = (alvo?.codigo_familia as number | null) ?? null
  if (!codigoFamilia) return { ok: true }

  const loja = await getLoja(lojaId)
  if (!loja?.omie_app_key) return { ok: true }

  try {
    await excluirFamiliaOmie(loja, codigoFamilia)
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha ao excluir no Omie'
    // Excluido localmente; Omie pode rejeitar se houver produtos vinculados.
    return { ok: true, omieError: msg }
  }
}

/**
 * Puxa as familias do Omie (PesquisarFamilias, so leitura) e grava no banco.
 */
export async function puxarFamiliasDoOmie() {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Familias - Sincronizar'))) return { error: 'Sem permissão' }

  const loja = await getLoja(lojaId)
  if (!loja?.omie_app_key || !loja?.omie_app_secret) return { error: 'Loja sem chave do Omie' }

  try {
    await syncFamilias(loja)
    revalidatePath('/familia')
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao puxar do Omie' }
  }
}
