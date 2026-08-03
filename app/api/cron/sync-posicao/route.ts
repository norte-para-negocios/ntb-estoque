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

  // Acha real 2026-08-03: sempre tentava só a loja MAIS desatualizada -- se
  // essa loja tiver credencial da Omie quebrada (ex.: chave suspensa), ela
  // fica pra sempre no topo do rodizio (nunca atualiza, nunca sai do lugar) e
  // trava a atualização de posição de estoque de TODAS as outras lojas junto,
  // porque o erro não tratado derrubava a requisição inteira com 500 antes de
  // chegar na próxima. Achado ao vivo: loja 7 quebrada desde 31/07 travou a
  // posição de estoque (CMC) das outras 5 lojas no mesmo dia -- 3 dias sem
  // atualizar, sem ninguém perceber. Agora tenta em ordem até uma funcionar,
  // sem deixar uma loja permanentemente quebrada bloquear as demais.
  const falhas: { loja_id: number; erro: string }[] = []
  for (const { loja } of ultimas) {
    try {
      const registros = await syncPosicaoEstoque(loja)
      return NextResponse.json({ ok: true, loja: loja.id, registros, puladas: falhas })
    } catch (e) {
      falhas.push({ loja_id: loja.id, erro: e instanceof Error ? e.message : String(e) })
    }
  }
  return NextResponse.json({ ok: false, msg: 'todas as lojas falharam', falhas }, { status: 502 })
}
