'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'

import { revalidatePath } from 'next/cache'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { exigirDevAcao } from '@/lib/recursos-dev'
import { validarTaxas, type Taxas } from '@/lib/custo-cardapio/preco-puro'
import { validarConfigCompras, type ConfigCompras } from '@/lib/custo-cardapio/config-puro'

// Custo e Cardápio (só dev): meta de CMV e taxas da loja. Frações (0,30 = 30%); embalagem em R$.
// `compras` (opcional, migration 474): cobertura da lista de compras, WhatsApp de compras (só dígitos) e dia da contagem.
export async function salvarTaxasCardapio(t: Taxas, compras?: ConfigCompras | null): Promise<{ ok: true } | { error: string }> {
  const __d = viaDesktop('custo-cardapio#salvarTaxasCardapio', salvarTaxasCardapio, [t, compras]); if (__d) return __d as never
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
  let extra: Record<string, unknown> = {}
  if (compras != null) {
    const c = {
      coberturaDias: Number(compras.coberturaDias),
      whatsappCompras: compras.whatsappCompras == null || compras.whatsappCompras === '' ? null : String(compras.whatsappCompras),
      diaContagem: compras.diaContagem == null ? null : Number(compras.diaContagem),
    }
    const e = validarConfigCompras(c)
    if (e.length) return { error: e[0] }
    extra = { cobertura_dias: c.coberturaDias, whatsapp_compras: c.whatsappCompras, dia_contagem: c.diaContagem }
  }
  const r4 = (v: number) => Math.round(v * 10000) / 10000
  const { error } = await createServiceClient().from('custo_cardapio_config').upsert({
    loja_id: lojaId, meta_cmv: r4(taxas.metaCmv), imposto_pct: r4(taxas.impostoPct), taxa_cartao_pct: r4(taxas.taxaCartaoPct),
    taxa_delivery_pct: r4(taxas.taxaDeliveryPct), embalagem: Math.round(taxas.embalagem * 100) / 100, ...extra,
    atualizado_por: ator.id, updated_at: new Date().toISOString(),
  }, { onConflict: 'loja_id' })
  if (error) {
    if (/cobertura_dias|whatsapp_compras|dia_contagem/.test(error.message)) return { error: 'As configurações de compras ainda não existem nesta base (migration 474 pendente).' }
    if (/custo_cardapio_config/.test(error.message)) return { error: 'A tabela das taxas ainda não existe nesta base (migration 473 pendente).' }
    return { error: error.message }
  }
  revalidatePath('/cozinha', 'layout')
  return { ok: true }
}
