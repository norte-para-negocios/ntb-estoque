import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { assertCronAuth } from '@/lib/omie/sync-all'
import { syncOrdensProducao } from '@/lib/omie/ordem-producao'
import { syncNotasFiscais } from '@/lib/omie/nota-fiscal'
import type { LojaOmie } from '@/lib/omie/client'

export const maxDuration = 300

// Backfill MENSAL de OP/NF (o Omie trunca periodos longos -> mes a mes vem completo).
// Reusa as funcoes de sync (mapeamento ja testado). Uso pontual:
//   GET /api/cron/backfill?modelo=op&loja=3                        (ano corrente, jan ate o mes atual)
//   GET /api/cron/backfill?modelo=nf&loja=3&ano=2025&mes_inicio=6  (jun-dez/2025, janela de 12 meses)
//   header Authorization: Bearer <CRON_SECRET>
//   modelo: 'op' (ordens de producao, por conclusao) | 'nf' (notas fiscais)
//   ano (default: corrente) · mes_inicio/mes_fim 1-12 (default: jan..mes atual no ano
//   corrente; ano inteiro se ano passado).

// Gera pares [inicio, fim] no formato DD/MM/AAAA, um por mes do range (1-based, inclusivo).
function gerarMeses(ano: number, mesIni: number, mesFim: number): [string, string][] {
  const pares: [string, string][] = []
  for (let m = mesIni; m <= mesFim; m++) {
    const ultimoDia = new Date(ano, m, 0).getDate() // dia 0 do mes seguinte = ultimo dia do mes m
    const mm = String(m).padStart(2, '0')
    pares.push([`01/${mm}/${ano}`, `${String(ultimoDia).padStart(2, '0')}/${mm}/${ano}`])
  }
  return pares
}

export async function GET(request: Request) {
  if (!assertCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const url = new URL(request.url)
  const lojaId = Number(url.searchParams.get('loja'))
  const modelo = url.searchParams.get('modelo') ?? 'op'
  if (!lojaId) return NextResponse.json({ error: 'parametro loja obrigatorio' }, { status: 400 })

  const hoje = new Date()
  const anoCorrente = hoje.getFullYear()
  const ano = Number(url.searchParams.get('ano')) || anoCorrente
  // Ano corrente: jan ate o mes atual. Ano passado: o ano inteiro (sobrescrevivel).
  const mesFimDefault = ano >= anoCorrente ? hoje.getMonth() + 1 : 12
  const mesIni = Math.min(12, Math.max(1, Number(url.searchParams.get('mes_inicio')) || 1))
  const mesFim = Math.min(12, Math.max(mesIni, Number(url.searchParams.get('mes_fim')) || mesFimDefault))
  const meses = gerarMeses(ano, mesIni, mesFim)

  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret, is_test')
    .eq('id', lojaId)
    .single<LojaOmie>()
  if (!loja) return NextResponse.json({ error: 'loja nao encontrada' }, { status: 404 })

  const fn = modelo === 'nf' ? syncNotasFiscais : syncOrdensProducao
  const erros: string[] = []
  for (const [ini, fim] of meses) {
    try {
      await fn(loja, ini, fim)
    } catch (e) {
      erros.push(`${ini}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return NextResponse.json({ ok: true, loja: lojaId, modelo, ano, meses: meses.map((m) => m[0]), erros })
}
