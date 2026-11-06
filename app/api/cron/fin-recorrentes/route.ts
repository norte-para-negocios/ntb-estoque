import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { assertCronAuth } from '@/lib/omie/sync-all'
import { semMigration } from '@/lib/financeiro/consultas'

export const maxDuration = 120

// Contas recorrentes (migration 370): cria as contas a pagar dos próximos N dias (configuração da loja, padrão 45) de cada
// recorrente ativa, em todas as lojas de estoque próprio (nunca a loja 4). Idempotente: cada vencimento vira uma conta uma vez
// só (conta cancelada não volta). Só o banco: não fala com Omie nem com banco. 1×/dia no scripts/sync-cron.sh.
export async function GET(request: Request) {
  if (!assertCronAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await createServiceClient().rpc('fin_recorrentes_gerar', {})
  if (error) {
    // código no ar antes da migration: nada a fazer, sem alarme diário
    if (semMigration(error)) return NextResponse.json({ ok: true, pulado: 'migration 370 não aplicada' })
    return NextResponse.json({ ok: false, erro: error.message }, { status: 502 })
  }
  const lojas = ((data as { lojas?: { loja_id: number; gerados: number; falhas: number }[] })?.lojas ?? [])
  const falhou = lojas.some((l) => l.falhas > 0)
  return NextResponse.json({ ok: !falhou, lojas }, { status: falhou ? 500 : 200 })
}
