// Cron sync-kardex ("nosso Omie", Fase 1): kardex da loja INTEIRA (ListarMovimentoEstoque sem idProd, um local
// por vez, 100 por página) em kardex_omie. Frente recente = ontem + hoje a cada 30 min; backfill = para trás em
// janelas de até 30 dias até 2026-07-01; revisão = 1x/dia relê os 35 dias anteriores já cobertos (lançamento com data
// antiga, saldo/CMC recalculado) e apaga o que sumiu do Omie nessa janela. Poucas páginas por ciclo; para no 1º erro
// do Omie sem repetir.
// D5 (20/10/2026, lojas 2/3/6): frente recente a cada 60 min (era 30) e só nos locais com movimento nos últimos 35 dias
// (revisão/backfill leem todos e descobrem local novo); páginas e prazo por loja vêm da rota (orçamento do ciclo).
import { createServiceClient } from '@/lib/supabase/server'
import { OmieError, type LojaOmie } from './client'
import { buscarPaginaKardexLocal, normalizarMovOmie, deduplicarMovs } from './kardex'
import { pegarTravaSync, soltarTravaSync } from './trava-sync'
import { gravarEstadoSync, lerEstadoSync, locaisAtivos, sleep, type ResumoCiclo } from './espelho-estado'
import {
  aposLeitura, historicoDesde, janelaFechada, lerEstado, marcarLocalComMovimento, proximaLeitura, type ConfigFrentes,
} from '@/lib/estoque/espelho-frentes'
import { ehErroDeLimiteOmie, isoParaBr, relogioBahia } from '@/lib/estoque/espelho-lojas'

export const CFG_KARDEX: ConfigFrentes = {
  diasRecentes: 2, janelaMaxDias: 30, limite: '2026-07-01', intervaloRecenteMin: 60, diasRevisao: 35, intervaloRevisaoHoras: 24,
  locaisRecenteDias: 35,
}
/** Páginas (= chamadas ao Omie) por loja e ciclo de 10 min. */
export const PAGINAS_KARDEX_POR_CICLO = 24
const PAUSA_MS = 700
const TETO_MS = 150_000
const FRENTE = 'kardex'

export async function sincronizarKardexLoja(
  loja: LojaOmie, opcoes: { maxPaginas?: number; prazoMs?: number } = {}, agora = new Date()
): Promise<ResumoCiclo> {
  const maxPaginas = opcoes.maxPaginas ?? PAGINAS_KARDEX_POR_CICLO
  const resumo: ResumoCiclo = { loja: loja.id, paginas: 0, linhas: 0, parouPor: null, historicoDesde: null }
  if (!(await pegarTravaSync(loja.id, 'kardex-loja', 600))) return { ...resumo, parouPor: 'trava (outro ciclo em andamento)' }
  const supabase = createServiceClient({ semAutor: true })
  const t0 = Date.now()
  const prazo = Math.min(t0 + TETO_MS, opcoes.prazoMs ?? Infinity)
  try {
    const locais = await locaisAtivos(loja.id)
    let estado = lerEstado(await lerEstadoSync(loja.id, FRENTE))
    const { hoje } = relogioBahia(agora)
    while (resumo.paginas < maxPaginas && Date.now() < prazo) {
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
      if (linhas.length) estado = marcarLocalComMovimento(estado, Number(p.cursor.local), linhas.reduce((m, l) => (l.data_mov > m ? l.data_mov : m), ''))
      if (p.frente === 'revisao' && p.cursor.iniciado_em && janelaFechada('revisao', p.cursor, estado)) {
        // Janela relida inteira (todos os locais): o que não foi visto nela foi excluído/estornado no Omie.
        const { error } = await supabase.from('kardex_omie').delete().eq('loja_id', loja.id)
          .gte('data_mov', p.cursor.ini).lte('data_mov', p.cursor.fim).in('codigo_local_estoque', locais)
          .lt('carregado_em', p.cursor.iniciado_em)
        if (error) throw new Error(`kardex_omie (apagar sumidos): ${error.message}`)
      }
      await gravarEstadoSync(loja.id, FRENTE, estado, null)
    }
    resumo.historicoDesde = historicoDesde(estado)
    return resumo
  } finally {
    await soltarTravaSync(loja.id, 'kardex-loja')
  }
}
