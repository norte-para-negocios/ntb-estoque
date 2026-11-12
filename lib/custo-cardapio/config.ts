import 'server-only'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { lerTaxas, type Taxas } from './preco-puro'
import { COMPRAS_PADRAO, lerConfigCompras, type ConfigCompras } from './config-puro'

// Norte Cozinha: configurações da loja numa leitura só (meta e taxas + compras e contagem, migration 474).
// Sem as colunas da 474 cai para só as taxas (compras no padrão); sem a tabela, tudo no padrão e nada gravável.

export type ConfigCozinha = { taxas: Taxas; compras: ConfigCompras; gravavel: boolean; comprasGravavel: boolean }

export const carregarConfigCozinha = cache(async (lojaId: number): Promise<ConfigCozinha> => {
  const supabase = await createClient()
  const { data, error } = await supabase.from('custo_cardapio_config')
    .select('meta_cmv, imposto_pct, taxa_cartao_pct, taxa_delivery_pct, embalagem, cobertura_dias, whatsapp_compras, dia_contagem')
    .eq('loja_id', lojaId).maybeSingle()
  if (!error) return { taxas: lerTaxas(data), compras: lerConfigCompras(data), gravavel: true, comprasGravavel: true }
  const { data: t, error: e2 } = await supabase.from('custo_cardapio_config')
    .select('meta_cmv, imposto_pct, taxa_cartao_pct, taxa_delivery_pct, embalagem').eq('loja_id', lojaId).maybeSingle()
  if (e2) return { taxas: lerTaxas(null), compras: { ...COMPRAS_PADRAO }, gravavel: false, comprasGravavel: false }
  return { taxas: lerTaxas(t), compras: { ...COMPRAS_PADRAO }, gravavel: true, comprasGravavel: false }
})
