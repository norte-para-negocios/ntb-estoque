'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'

import { revalidatePath } from 'next/cache'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { exigirDevAcao } from '@/lib/recursos-dev'
import { validarTaxas, type Taxas } from '@/lib/custo-cardapio/preco-puro'

// Custo e Cardápio (só dev): meta de CMV e taxas da loja. Frações (0,30 = 30%); embalagem em R$.
export async function salvarTaxasCardapio(t: Taxas): Promise<{ ok: true } | { error: string }> {
  const __d = viaDesktop('custo-cardapio#salvarTaxasCardapio', salvarTaxasCardapio, [t]); if (__d) return __d as never
  await exigirDevAcao()
  const ator = await getAtorGestao()
  if (!ator.podeGerir) return { error: 'Sem permissão' }
  const lojaId = await getCurrentLojaId()
  if (!ator.lojaIds.includes(lojaId)) return { error: 'Sem permissão nesta loja' }
  const taxas: Taxas = {
    metaCmv: Number(t.metaCmv), impostoPct: Number(t.impostoPct), taxaCartaoPct: Number(t.taxaCartaoPct),
    taxaDeliveryPct: Number(t.taxaDeliveryPct), embalagem: Number(t.embalagem),
  }
  const erros = validarTaxas(taxas)
  if (erros.length) return { error: erros[0] }
  const r4 = (v: number) => Math.round(v * 10000) / 10000
  const { error } = await createServiceClient().from('custo_cardapio_config').upsert({
    loja_id: lojaId, meta_cmv: r4(taxas.metaCmv), imposto_pct: r4(taxas.impostoPct), taxa_cartao_pct: r4(taxas.taxaCartaoPct),
    taxa_delivery_pct: r4(taxas.taxaDeliveryPct), embalagem: Math.round(taxas.embalagem * 100) / 100,
    atualizado_por: ator.id, updated_at: new Date().toISOString(),
  }, { onConflict: 'loja_id' })
  if (error) {
    if (/custo_cardapio_config/.test(error.message)) return { error: 'A tabela das taxas ainda não existe nesta base (migration 473 pendente).' }
    return { error: error.message }
  }
  revalidatePath('/custo-cardapio', 'layout')
  return { ok: true }
}
