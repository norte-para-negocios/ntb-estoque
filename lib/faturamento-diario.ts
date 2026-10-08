import { createServiceClient } from '@/lib/supabase/server'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { buscarFatCupons } from '@/lib/faturamento-frio'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { agruparCuponsPorDia, preencherDias, limitarPeriodo, type DiaValor } from '@/lib/faturamento-dias'

// ini/fim devolvidos sao os efetivamente usados (periodo pode ser cortado em MAX_DIAS).
export type FaturamentoDiario = { dias: DiaValor[]; aviso: string | null; ini: string; fim: string }

// Faturamento por dia. Loja Omie: cupons do Contabo (fat_cupons), mesmo fato
// que alimenta "Ver cupons". Loja de estoque proprio: vendas_proprio.
// Omie: cancelado nunca entra, devolvido entra (bate com o total mensal). Propria: nenhum dos dois.
export async function carregarFaturamentoDiario(lojaId: number, iniPedido: string, fimPedido: string): Promise<FaturamentoDiario> {
  const { ini, fim, cortado } = limitarPeriodo(iniPedido, fimPedido)
  const modo = await modoDaLoja(lojaId)
  let aviso: string | null = cortado ? 'Período limitado a 366 dias: mostrando os dias mais recentes.' : null
  let porDia: Map<string, number>

  if (modo === 'proprio') {
    const supabase = createServiceClient()
    // buscarTodasLinhas pagina (o PostgREST corta em 1000) e sinaliza falha via onErro.
    const vendas = await buscarTodasLinhas<{ data: string; valor: number | string; cancelado: boolean; devolvido: boolean }>(
      (from, to) => supabase
        .from('vendas_proprio')
        .select('data, valor, cancelado, devolvido')
        .eq('loja_id', lojaId)
        .gte('data', ini)
        .lte('data', fim)
        .order('id')
        .range(from, to),
      undefined,
      (e) => { aviso = `Falha ao ler as vendas (${e.message}). Os valores abaixo podem estar incompletos.` },
    )
    // Loja propria: o total mensal (recalcular_faturamento_proprio) exclui cancelado E devolvido.
    porDia = agruparCuponsPorDia(
      vendas.map((v) => ({ data: v.data, valor: Number(v.valor) || 0, cancelado: v.cancelado || v.devolvido })),
    )
  } else {
    let truncou = false
    const cupons = await buscarFatCupons({ lojaId, dataInicio: ini, dataFinal: fim, onTruncado: () => { truncou = true } })
    if (truncou) aviso = 'A consulta ao histórico foi cortada antes do fim. Os valores abaixo podem estar incompletos.'
    porDia = agruparCuponsPorDia(cupons)
  }

  return { dias: preencherDias(ini, fim, porDia), aviso, ini, fim }
}
