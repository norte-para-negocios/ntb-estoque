import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getLojasAtivas, assertCronAuth } from '@/lib/omie/sync-all'

export const maxDuration = 300

// Mantém produto_preco_recente atualizado (migration 090) -- essa tabela existe
// pra tirar a CTE cara de "preço mais recente por produto" do caminho de
// leitura de relatorio_movimentacao_matriz (achado real 2026-07-27: aquela CTE
// ocasionalmente estourava o statement_timeout de 8s do PostgREST, e a tela de
// Movimentação caía em silêncio pro histórico frio, parecendo travada em meses
// antigos). Não chama o Omie -- é só uma função SQL local, roda rápido.
export async function GET(request: Request) {
  if (!assertCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createServiceClient()
  const lojas = await getLojasAtivas()
  const results = await Promise.allSettled(
    lojas.map((loja) => supabase.rpc('atualizar_preco_recente', { p_loja_id: loja.id }))
  )
  const ok = results.filter((r) => r.status === 'fulfilled' && !r.value.error).length
  const falhas = lojas.length - ok
  // Fix round 1 (revisão da Task 9, 2026-08-09): esta rota respondia sempre
  // HTTP 200, mesmo quando TODAS as lojas falhavam -- foi literalmente essa a
  // causa do apagão de 9 dias passar despercebido no log do cron
  // (scripts/sync-cron.sh só grava o código HTTP, e "200" nunca chamou
  // atenção mesmo com `atualizar_preco_recente` inexistente até este fix).
  // Mesmo padrão de app/api/cron/sync-posicao/route.ts e
  // app/api/cron/sync-previsao/route.ts: só falha de verdade (502) quando
  // TODAS as lojas falharam -- falha parcial continua 200 (não é uma
  // condição rara/anormal o bastante pra virar alerta).
  if (lojas.length > 0 && falhas === lojas.length) {
    return NextResponse.json({ ok: false, total: lojas.length, falhas }, { status: 502 })
  }
  return NextResponse.json({ total: lojas.length, ok, falhas })
}
