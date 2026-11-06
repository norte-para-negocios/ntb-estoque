import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { assertCronAuth } from '@/lib/omie/sync-all'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { janelaGeracao } from '@/lib/financeiro/receber-vendas-puro'
import { corpoDoCron, statusDoCron, type ResultadoCronLoja } from '@/lib/cron/resposta-puro'

export const maxDuration = 120

// Contas a receber das vendas do Norte Vendas (migration 380): para cada loja de estoque próprio com a chave
// lojas.fin_cr_vendas_ativo ligada (nunca a 4), gera/atualiza um título por dia × forma de pagamento nos últimos
// FIN_CR_DIAS dias (padrão 7: venda reenviada ou cancelada dias depois ainda entra). Só o banco: nada no Omie nem no Vendas.
// Sem a migration responde 503 (nada é gravado); falha numa loja = 500 com o resumo (lib/cron/resposta-puro.ts).
export async function GET(request: Request) {
  if (!assertCronAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const supabase = createServiceClient()
  const { data: lojas, error } = await supabase.from('lojas').select('id')
    .eq('modo_estoque', 'proprio').eq('ativo', true).eq('fin_cr_vendas_ativo', true).neq('id', 4)
  if (error) {
    const semMigration = error.code === '42703' || error.code === 'PGRST204'
    return NextResponse.json({ ok: false, erro: semMigration ? 'migration 380 não aplicada' : error.message }, { status: semMigration ? 503 : 502 })
  }
  const dias = Number(process.env.FIN_CR_DIAS ?? 7)
  const { de, ate } = janelaGeracao(hojeBahiaISO(), Number.isFinite(dias) ? dias : 7)
  const resultados: ResultadoCronLoja[] = []
  const detalhes: Record<number, unknown> = {}
  for (const l of (lojas ?? []) as { id: number }[]) {
    const { data, error: e } = await supabase.rpc('fin_receber_vendas_gerar', { p_loja: l.id, p_de: de, p_ate: ate, p_user: null, p_user_nome: 'Automático' })
    resultados.push({ loja: l.id, ok: !e, erro: e?.message ?? null })
    detalhes[l.id] = e ? { erro: e.message } : data
  }
  return NextResponse.json({ ...corpoDoCron(resultados), de, ate, detalhes }, { status: statusDoCron(resultados) })
}
