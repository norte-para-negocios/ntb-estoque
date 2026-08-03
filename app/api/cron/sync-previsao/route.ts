import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { syncPrevisaoVenda } from '@/lib/omie/previsao-venda'
import { getLojasAtivas, assertCronAuth } from '@/lib/omie/sync-all'

export const maxDuration = 300

// Sincroniza a previsao de venda (saidas do mesmo periodo do ano anterior) de UMA
// loja por execucao — a mais desatualizada. A janela muda devagar, entao o GitHub
// Actions chama isto poucas vezes ao dia, cobrindo as lojas em rodizio.
export async function GET(request: Request) {
  if (!assertCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const lojas = await getLojasAtivas()
  if (!lojas.length) return NextResponse.json({ ok: true, msg: 'nenhuma loja' })

  const supabase = createServiceClient()

  // A loja sem previsao (null) ou com a atualizacao mais antiga e a proxima a rodar.
  const ultimas = await Promise.all(
    lojas.map(async (loja) => {
      const { data } = await supabase
        .from('previsao_venda')
        .select('updated_at')
        .eq('loja_id', loja.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      return { loja, updated: data?.updated_at ? new Date(data.updated_at).getTime() : 0 }
    })
  )

  ultimas.sort((a, b) => a.updated - b.updated)

  // Mesmo achado e mesmo fix de app/api/cron/sync-posicao/route.ts (2026-08-03):
  // uma loja com credencial da Omie quebrada travava pra sempre no topo do
  // rodizio e derrubava a atualização das outras. Tenta em ordem até uma funcionar.
  const falhas: { loja_id: number; erro: string }[] = []
  for (const { loja } of ultimas) {
    try {
      const registros = await syncPrevisaoVenda(loja)
      return NextResponse.json({ ok: true, loja: loja.id, registros, puladas: falhas })
    } catch (e) {
      falhas.push({ loja_id: loja.id, erro: e instanceof Error ? e.message : String(e) })
    }
  }
  return NextResponse.json({ ok: false, msg: 'todas as lojas falharam', falhas }, { status: 502 })
}
