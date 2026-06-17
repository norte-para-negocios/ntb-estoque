import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { assertCronAuth } from '@/lib/omie/sync-all'
import {
  TABELAS_ARQUIVAVEIS,
  mesCorte,
  arquivarPeriodo,
  type TabelaArquivavel,
} from '@/lib/arquivo-morto'

export const maxDuration = 300

// Offload mensal: arquiva no Storage (e apaga do Postgres) os meses fora da janela
// quente de `meses` (default 12). Roda mês a mês por tabela. SEGURANCA: dry_run é o
// padrão; só apaga com dry_run=false explícito. Uso:
//   GET /api/cron/arquivar                       (simula: lista o que sairia)
//   GET /api/cron/arquivar?dry_run=false         (executa de verdade)
//   GET /api/cron/arquivar?tabela=ordens_producao&meses=12&dry_run=false
//   header Authorization: Bearer <CRON_SECRET>
export async function GET(request: Request) {
  if (!assertCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const url = new URL(request.url)
  const meses = Math.max(1, Number(url.searchParams.get('meses')) || 12)
  const dryRun = url.searchParams.get('dry_run') !== 'false'
  const filtro = url.searchParams.get('tabela')

  const tabelas = (
    filtro && filtro in TABELAS_ARQUIVAVEIS ? [filtro] : Object.keys(TABELAS_ARQUIVAVEIS)
  ) as TabelaArquivavel[]
  const corte = mesCorte(new Date(), meses)

  const supabase = createServiceClient()
  const resultados = []
  for (const tabela of tabelas) {
    const { data: periodos, error } = await supabase.rpc('meses_arquivaveis', {
      p_tabela: tabela,
      p_col: TABELAS_ARQUIVAVEIS[tabela],
      p_corte: corte,
    })
    if (error) {
      resultados.push({ tabela, periodo: '*', linhas: 0, status: 'erro', erro: error.message })
      continue
    }
    for (const { periodo, linhas } of (periodos ?? []) as { periodo: string; linhas: number }[]) {
      try {
        resultados.push(await arquivarPeriodo(supabase, tabela, periodo, dryRun, Number(linhas)))
      } catch (e) {
        resultados.push({
          tabela,
          periodo,
          linhas: 0,
          status: 'erro',
          erro: e instanceof Error ? e.message : String(e),
        })
      }
    }
  }
  return NextResponse.json({ ok: true, corte, dry_run: dryRun, meses, resultados })
}
