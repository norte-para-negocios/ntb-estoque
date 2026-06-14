import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { syncPosicaoEstoque } from '@/lib/omie/posicao-estoque'
import { getLojasAtivas, assertCronAuth } from '@/lib/omie/sync-all'

export const maxDuration = 300

// Sincroniza a posicao de estoque (CMC) de UMA loja por execucao — a mais
// desatualizada. Chamado a cada 10 min pelo GitHub Actions, cobre todas as
// lojas em rodizio (~1h para 6 lojas) sem estourar o tempo da funcao.
export async function GET(request: Request) {
  if (!assertCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const lojas = await getLojasAtivas()
  if (!lojas.length) return NextResponse.json({ ok: true, msg: 'nenhuma loja' })

  const supabase = createServiceClient()

  // Para cada loja, descobre quando a posicao foi atualizada pela ultima vez.
  // A loja sem registro (null) ou com a data mais antiga e a proxima a rodar.
  const ultimas = await Promise.all(
    lojas.map(async (loja) => {
      const { data } = await supabase
        .from('posicao_estoques')
        .select('updated_at')
        .eq('loja_id', loja.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      return { loja, updated: data?.updated_at ? new Date(data.updated_at).getTime() : 0 }
    })
  )

  ultimas.sort((a, b) => a.updated - b.updated)
  const alvo = ultimas[0].loja

  const registros = await syncPosicaoEstoque(alvo)
  return NextResponse.json({ ok: true, loja: alvo.id, registros })
}
