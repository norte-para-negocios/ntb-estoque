import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { assertCronAuth } from '@/lib/omie/sync-all'
import { enviarFatoFrio } from '@/lib/estoque/fechamento'

export const maxDuration = 300

// Reenvia ao Contabo as vendas de lojas 'proprio' que ficaram com `frio_enviado_em` nulo (Contabo fora do ar no
// fechamento). A venda nunca se perde: ela já está em vendas_proprio e no faturamento_importado.
export async function GET(request: Request) {
  if (!assertCronAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const supabase = createServiceClient()
  const { data: lojas } = await supabase.from('lojas').select('id').eq('modo_estoque', 'proprio').eq('ativo', true)
  const resumo: { loja_id: number; enviadas: number; pendentes: number; erro?: string }[] = []
  for (const l of lojas ?? []) resumo.push({ loja_id: l.id, ...(await enviarFatoFrio(supabase, l.id, { limite: 200 })) })
  const tinhaTrabalho = resumo.some((r) => r.enviadas > 0 || r.pendentes > 0)
  const algumSucesso = resumo.some((r) => r.enviadas > 0 && !r.erro)
  // 502 só quando havia o que enviar e nada saiu (mesmo padrão dos outros crons).
  return NextResponse.json({ ok: !tinhaTrabalho || algumSucesso, resumo }, { status: tinhaTrabalho && !algumSucesso ? 502 : 200 })
}
