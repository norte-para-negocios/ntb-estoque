import { createServiceClient } from '@/lib/supabase/server'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { buscarFatCupons } from '@/lib/faturamento-frio'
import { agruparCuponsPorDia, preencherDias, type DiaValor } from '@/lib/faturamento-dias'

export type FaturamentoDiario = { dias: DiaValor[]; aviso: string | null }

// Faturamento por dia. Loja Omie: cupons do Contabo (fat_cupons), mesmo fato
// que alimenta "Ver cupons". Loja de estoque proprio: vendas_proprio.
// Cancelado nunca entra; devolvido entra (bate com o total mensal da tela).
export async function carregarFaturamentoDiario(lojaId: number, ini: string, fim: string): Promise<FaturamentoDiario> {
  const modo = await modoDaLoja(lojaId)
  let aviso: string | null = null
  let porDia: Map<string, number>

  if (modo === 'proprio') {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('vendas_proprio')
      .select('data, valor, cancelado')
      .eq('loja_id', lojaId)
      .gte('data', ini)
      .lte('data', fim)
      .limit(50000)
    if (error) aviso = `Falha ao ler as vendas (${error.message}). Os valores abaixo podem estar incompletos.`
    porDia = agruparCuponsPorDia(
      ((data ?? []) as { data: string; valor: number | string; cancelado: boolean }[]).map((v) => ({
        data: v.data, valor: Number(v.valor) || 0, cancelado: v.cancelado,
      })),
    )
  } else {
    let truncou = false
    const cupons = await buscarFatCupons({ lojaId, dataInicio: ini, dataFinal: fim, onTruncado: () => { truncou = true } })
    if (truncou) aviso = 'A consulta ao histórico foi cortada antes do fim. Os valores abaixo podem estar incompletos.'
    if (!cupons.length) aviso = aviso ?? 'Nenhum cupom retornado para o período. Se isso não é esperado, o histórico pode estar indisponível — recarregue a página.'
    porDia = agruparCuponsPorDia(cupons)
  }

  return { dias: preencherDias(ini, fim, porDia), aviso }
}
