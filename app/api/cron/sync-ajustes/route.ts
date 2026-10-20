import { NextResponse } from 'next/server'
import { getLojasAtivas, getLojasEspelhoCompleto, assertCronAuth } from '@/lib/omie/sync-all'
import { FILTRO_IGNORADO, syncAjustes, syncAjustesJanela } from '@/lib/omie/sync-ajustes'
import { janelaProibida } from '@/lib/estoque/espelho-lojas'
import { registrarFrente, verificarGuarda } from '@/lib/omie/espelho-ciclo'

export const maxDuration = 300

// Sincroniza ajustes de estoque (ENT/SAI/TRF/TPQ/SLD) do Omie → movimentos, com autor e origem (migration 160).
// - Lojas com espelho_completo ("nosso Omie"): por janela de data (últimos 3 dias + backfill até 01/07/2026,
//   cursor em espelho_sync_estado), nunca entre 00:00 e 07:00 da Bahia, com a guarda do espelho (lib/omie/espelho-ciclo.ts).
// - Demais lojas: incremental de sempre (id_ajuste maior que o maior já salvo).
export async function GET(request: Request) {
  if (!assertCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const lojas = await getLojasAtivas()
  if (!lojas.length) return NextResponse.json({ ok: true, msg: 'nenhuma loja' })

  // Exclui loja 4 (O SERTAO VAI VIRAR MAR - produção protegida)
  const lojasSync = lojas.filter((l) => l.id !== 4)
  const espelho = new Set((await getLojasEspelhoCompleto()).map((l) => l.id))
  const proibido = janelaProibida(new Date())

  const results = await Promise.allSettled(
    lojasSync.map(async (loja) => {
      if (!espelho.has(loja.id)) return { modo: 'id' as const, linhas: await syncAjustes(loja) }
      if (proibido) return { modo: 'janela' as const, linhas: 0, pulado: 'janela 00:00-07:00' }
      // D5: guarda do espelho (bloqueio/disjuntor/erros seguidos): loja pausada não lê ajustes neste ciclo.
      const g = await verificarGuarda(loja, 'ajustes')
      if (g.motivo) return { modo: 'janela' as const, linhas: 0, pulado: g.motivo }
      let r
      try { r = await syncAjustesJanela(loja) }
      catch (e) { await registrarFrente(loja, 'ajustes', g.guarda, `erro interno: ${e instanceof Error ? e.message : String(e)}`); throw e }
      await registrarFrente(loja, 'ajustes', g.guarda, r.parouPor)
      // Omie ignorou data_movimento_de/ate: não fica sem ajuste nenhum, cai no modo de sempre neste ciclo.
      if (r.parouPor?.startsWith(FILTRO_IGNORADO)) return { modo: 'id' as const, linhas: await syncAjustes(loja), parouPor: r.parouPor }
      return { modo: 'janela' as const, linhas: r.linhas, parouPor: r.parouPor, historicoDesde: r.historicoDesde }
    })
  )

  let totalLinhas = 0
  const falhas: { loja: number; erro: string }[] = []
  const porLoja: Record<number, unknown> = {}

  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    if (r.status === 'fulfilled') {
      totalLinhas += r.value.linhas
      porLoja[lojasSync[i].id] = r.value
    } else {
      falhas.push({ loja: lojasSync[i].id, erro: String(r.reason) })
    }
  }

  return NextResponse.json({
    ok: falhas.length === 0,
    total_lojas: lojasSync.length,
    ok_lojas: lojasSync.length - falhas.length,
    linhas_gravadas: totalLinhas,
    por_loja: porLoja,
    falhas,
  })
}
