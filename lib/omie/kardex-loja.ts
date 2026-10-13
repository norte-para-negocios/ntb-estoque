// Cron sync-kardex ("nosso Omie", Fase 1): kardex da loja INTEIRA (ListarMovimentoEstoque sem idProd, um local
// por vez, 100 por página) em kardex_omie. Frente recente = ontem + hoje a cada 30 min; backfill = para trás em
// janelas de até 30 dias até 2026-07-01. Poucas páginas por ciclo; para no 1º erro do Omie sem repetir.
import { createServiceClient } from '@/lib/supabase/server'
import { OmieError, type LojaOmie } from './client'
import { buscarPaginaKardexLocal, normalizarMovOmie, deduplicarMovs } from './kardex'
import { pegarTravaSync, soltarTravaSync } from './trava-sync'
import { gravarEstadoSync, lerEstadoSync, locaisAtivos, sleep, type ResumoCiclo } from './espelho-estado'
import { aposLeitura, historicoDesde, lerEstado, proximaLeitura, type ConfigFrentes } from '@/lib/estoque/espelho-frentes'
import { ehErroDeLimiteOmie, isoParaBr, relogioBahia } from '@/lib/estoque/espelho-lojas'

export const CFG_KARDEX: ConfigFrentes = { diasRecentes: 2, janelaMaxDias: 30, limite: '2026-07-01', intervaloRecenteMin: 30 }
const PAGINAS_POR_CICLO = 12
const PAUSA_MS = 700
const TETO_MS = 150_000
const FRENTE = 'kardex'

export async function sincronizarKardexLoja(loja: LojaOmie, agora = new Date()): Promise<ResumoCiclo> {
  const resumo: ResumoCiclo = { loja: loja.id, paginas: 0, linhas: 0, parouPor: null, historicoDesde: null }
  if (!(await pegarTravaSync(loja.id, 'kardex-loja', 600))) return { ...resumo, parouPor: 'trava (outro ciclo em andamento)' }
  const supabase = createServiceClient()
  const t0 = Date.now()
  try {
    const locais = await locaisAtivos(loja.id)
    let estado = lerEstado(await lerEstadoSync(loja.id, FRENTE))
    const { hoje } = relogioBahia(agora)
    while (resumo.paginas < PAGINAS_POR_CICLO && Date.now() - t0 < TETO_MS) {
      const p = proximaLeitura(estado, CFG_KARDEX, hoje, Date.now(), locais)
      if (!p) break
      if (resumo.paginas > 0) await sleep(PAUSA_MS)
      let pagina
      try {
        pagina = await buscarPaginaKardexLocal(loja, Number(p.cursor.local), isoParaBr(p.cursor.ini), isoParaBr(p.cursor.fim), p.cursor.pagina)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        resumo.parouPor = `${ehErroDeLimiteOmie(msg, e instanceof OmieError ? e.faultCode : undefined) ? 'limite do Omie' : 'erro do Omie'}: ${msg}`.slice(0, 500)
        await gravarEstadoSync(loja.id, FRENTE, p.estado, resumo.parouPor)
        break
      }
      resumo.paginas++
      const agoraISO = new Date().toISOString()
      const linhas = deduplicarMovs(pagina.movs.map((m) => ({ ...normalizarMovOmie(m, loja.id), carregado_em: agoraISO })))
      for (let i = 0; i < linhas.length; i += 500) {
        const { error } = await supabase.from('kardex_omie').upsert(linhas.slice(i, i + 500), { onConflict: 'loja_id,id_mov,codigo_local_estoque' })
        if (error) throw new Error(`kardex_omie: ${error.message}`)
      }
      resumo.linhas += linhas.length
      if (p.frente === 'recente' && linhas.length) {
        // Só carregado_em: `movimentos` é da carga sob demanda por produto (55 dias), não desta página.
        const produtos = [...new Set(linhas.map((l) => l.n_cod_prod))].map((n) => ({ loja_id: loja.id, n_cod_prod: n, carregado_em: agoraISO }))
        const { error } = await supabase.from('kardex_omie_carga').upsert(produtos, { onConflict: 'loja_id,n_cod_prod' })
        if (error) throw new Error(`kardex_omie_carga: ${error.message}`)
      }
      estado = aposLeitura(p.estado, p.frente, pagina.totalPaginas, locais, CFG_KARDEX, agoraISO)
      await gravarEstadoSync(loja.id, FRENTE, estado, null)
    }
    resumo.historicoDesde = historicoDesde(estado)
    return resumo
  } finally {
    await soltarTravaSync(loja.id, 'kardex-loja')
  }
}
