'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'

import { revalidatePath } from 'next/cache'
import { getProfile } from '@/lib/auth'
import { exigirDevAcao } from '@/lib/recursos-dev'
import { createServiceClient } from '@/lib/supabase/server'
import type { ModuloId } from '@/lib/plataforma/modulos-puro'
import { tabelaAusente, validarAssinatura, validarPreco, type DadosAssinatura } from '@/lib/plataforma/admin-puro'

// Plataforma Norte (tela /plataforma/modulos, só equipe da Norte): estado de cada módulo por loja e preço de cada plano.
// Arquivo livre (plataforma-*): sem guarda de módulo. Grava com service role; a tabela só aceita escrita por ele (migration 475).

type Resultado = { ok: true } | { error: string }
const AUSENTE = 'Tabelas da plataforma ainda não aplicadas (migration 475).'

async function soNorte(): Promise<string | null> {
  try {
    await exigirDevAcao()
    return null
  } catch (e) {
    return e instanceof Error ? e.message : 'Sem permissão.'
  }
}

/** estado null apaga a linha: a loja volta ao padrão do módulo. */
export async function salvarAssinatura(lojaId: number, modulo: ModuloId, dados: DadosAssinatura): Promise<Resultado> {
  const __d = viaDesktop('plataforma-modulos#salvarAssinatura', salvarAssinatura, [lojaId, modulo, dados]); if (__d) return __d as never
  const negado = await soNorte()
  if (negado) return { error: negado }
  const d: DadosAssinatura = {
    estado: dados?.estado ?? null,
    planoId: dados?.planoId ?? null,
    precoCombinado: dados?.precoCombinado == null ? null : Number(dados.precoCombinado),
  }
  const invalido = validarAssinatura(Number(lojaId), modulo, d)
  if (invalido) return { error: invalido }
  const sb = createServiceClient()
  const { data: loja, error: eLoja } = await sb.from('lojas').select('id').eq('id', lojaId).maybeSingle()
  if (eLoja) return { error: eLoja.message }
  if (!loja) return { error: 'Loja não encontrada.' }

  const { error } = d.estado === null
    ? await sb.from('plataforma_assinaturas').delete().eq('erp_loja_id', lojaId).eq('modulo_id', modulo)
    : await sb.from('plataforma_assinaturas').upsert({
      erp_loja_id: lojaId, modulo_id: modulo, estado: d.estado, plano_id: d.planoId,
      preco_combinado: d.precoCombinado == null ? null : Math.round(d.precoCombinado * 100) / 100,
      atualizado_por: (await getProfile()).id, updated_at: new Date().toISOString(),
    }, { onConflict: 'erp_loja_id,modulo_id' })
  if (error) return { error: tabelaAusente(error) ? AUSENTE : error.message }
  revalidatePath('/', 'layout')
  return { ok: true }
}

/** preco null = "definir" (sem preço). Nunca aparece para o cliente. */
export async function salvarPrecoPlano(planoId: string, preco: number | null): Promise<Resultado> {
  const __d = viaDesktop('plataforma-modulos#salvarPrecoPlano', salvarPrecoPlano, [planoId, preco]); if (__d) return __d as never
  const negado = await soNorte()
  if (negado) return { error: negado }
  const p = preco == null ? null : Number(preco)
  const invalido = validarPreco(String(planoId), p)
  if (invalido) return { error: invalido }
  const { data, error } = await createServiceClient().from('plataforma_planos')
    .update({ preco_mensal: p == null ? null : Math.round(p * 100) / 100 }).eq('id', planoId).select('id')
  if (error) return { error: tabelaAusente(error) ? AUSENTE : error.message }
  if (!data?.length) return { error: 'Plano não encontrado.' }
  revalidatePath('/', 'layout')
  return { ok: true }
}
