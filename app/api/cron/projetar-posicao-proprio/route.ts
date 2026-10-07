import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { assertCronAuth } from '@/lib/omie/sync-all'

export const maxDuration = 120

// Loja de estoque próprio: leva os saldos do ledger para a posição do dia (posicao_estoques), para que o Estoque
// Valorizado, o Resumo e os relatórios achem TODOS os itens no dia, mesmo os que não tiveram movimento hoje.
// Nunca toca lojas Omie (a posição delas vem do sync do Omie).
export async function GET(request: Request) {
  if (!assertCronAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const supabase = createServiceClient()
  const { data: lojas, error } = await supabase.from('lojas').select('id').eq('modo_estoque', 'proprio').eq('ativo', true)
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 502 })
  const resultados: { loja_id: number; linhas?: number; erro?: string }[] = []
  for (const l of lojas ?? []) {
    const { data, error: e } = await supabase.rpc('projetar_posicao_dia', { p_loja: l.id })
    resultados.push(e ? { loja_id: l.id, erro: e.message } : { loja_id: l.id, linhas: Number(data) })
  }
  const falhou = resultados.length > 0 && resultados.every((r) => r.erro)
  return NextResponse.json({ ok: !falhou, resultados }, { status: falhou ? 502 : 200 })
}
