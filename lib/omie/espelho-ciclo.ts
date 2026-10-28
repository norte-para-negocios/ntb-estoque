// D5 (20/10/2026): um ciclo de um cron do espelho completo em várias lojas, com guarda e orçamento.
// - Antes de cada loja: pula se o nosso disjuntor tem QUALQUER método da chave bloqueado (em memória), se há
//   `[BLOQUEIO OMIE]` da loja nos últimos 35 min (integration_attempts, sobrevive a restart), se a loja está pausada
//   (`espelho_sync_estado` frente `guarda-loja`) ou se esta frente está em espera (`guarda-<frente>`).
//   Falha ao ler a guarda = pula a loja (na dúvida, não chama o Omie).
// - Depois: erro de limite → loja inteira pausada 60 min; outro erro do Omie → espera crescente na frente, com teto.
// - Orçamento: as lojas rodam uma de cada vez, em rodízio, até `orcamentoMs`; a que não couber fica para o próximo ciclo.
// Regras puras em lib/estoque/espelho-guarda.ts.
import { createServiceClient } from '@/lib/supabase/server'
import { OmieError, type LojaOmie } from './client'
import { ehErroDeLimiteOmie } from '@/lib/estoque/espelho-lojas'
import { msRestantesBloqueio } from './erros-omie'
import {
  JANELA_BLOQUEIO_LOG_MIN, aposFrente, classificarParada, lerGuardaFrente, lerGuardaLoja, ordemRodizio, pausadoAgora,
  type GuardaFrente,
} from '@/lib/estoque/espelho-guarda'

export type FrenteEspelho = 'kardex' | 'ajustes' | 'ops-abertas' | 'fichas' | 'financeiro'

/** Por que a loja não roda esta frente agora (null = liberada) + a guarda lida (para gravar o resultado). */
export async function verificarGuarda(loja: LojaOmie, frente: FrenteEspelho, agoraMs = Date.now()): Promise<{ motivo: string | null; guarda: GuardaFrente }> {
  const vazia = lerGuardaFrente(null)
  const restante = msRestantesBloqueio(loja.omie_app_key, agoraMs)
  if (restante > 0) return { motivo: `disjuntor: API do Omie bloqueada nesta chave (~${Math.ceil(restante / 60000)} min)`, guarda: vazia }
  const db = createServiceClient({ semAutor: true })
  const [g, b] = await Promise.all([
    db.from('espelho_sync_estado').select('frente, estado').eq('loja_id', loja.id).in('frente', ['guarda-loja', `guarda-${frente}`]),
    db.from('integration_attempts').select('created_at, model').eq('loja_id', loja.id).like('model', '[BLOQUEIO OMIE]%')
      .gt('created_at', new Date(agoraMs - JANELA_BLOQUEIO_LOG_MIN * 60_000).toISOString()).order('created_at', { ascending: false }).limit(1),
  ])
  if (g.error) return { motivo: `guarda ilegível (${g.error.message}): loja fica fora neste ciclo`, guarda: vazia }
  if (b.error) return { motivo: `integration_attempts ilegível (${b.error.message}): loja fica fora neste ciclo`, guarda: vazia }
  if (b.data?.length) return { motivo: `${b.data[0].model} em ${b.data[0].created_at}: loja fora do espelho por ${JANELA_BLOQUEIO_LOG_MIN} min`, guarda: vazia }
  const linhas = new Map((g.data ?? []).map((l) => [l.frente as string, l.estado as unknown]))
  const gl = lerGuardaLoja(linhas.get('guarda-loja'))
  if (pausadoAgora(gl.pausado_ate, agoraMs)) return { motivo: `loja pausada até ${gl.pausado_ate} (${gl.motivo ?? 'limite do Omie'})`, guarda: vazia }
  const gf = lerGuardaFrente(linhas.get(`guarda-${frente}`))
  if (pausadoAgora(gf.pausado_ate, agoraMs)) return { motivo: `frente em espera até ${gf.pausado_ate} após ${gf.falhas} falha(s): ${gf.ultimo_erro ?? ''}`.slice(0, 500), guarda: gf }
  return { motivo: null, guarda: gf }
}

/** Grava o resultado da frente (só quando muda) e, em erro de limite, pausa a loja inteira. Nunca lança. */
export async function registrarFrente(
  loja: LojaOmie, frente: FrenteEspelho, guarda: GuardaFrente, parouPor: string | null | undefined, agoraMs = Date.now()
): Promise<void> {
  const r = aposFrente(guarda, classificarParada(parouPor), parouPor ?? null, agoraMs)
  if (!r.mudou) return
  const db = createServiceClient({ semAutor: true })
  const agora = new Date(agoraMs).toISOString()
  const linhas: { loja_id: number; frente: string; estado: unknown; ultimo_erro: string | null; atualizado_em: string }[] = [
    { loja_id: loja.id, frente: `guarda-${frente}`, estado: r.guarda, ultimo_erro: r.guarda.ultimo_erro, atualizado_em: agora },
  ]
  if (r.pausaLojaAte) {
    linhas.push({ loja_id: loja.id, frente: 'guarda-loja', estado: { pausado_ate: r.pausaLojaAte, motivo: `${frente}: ${parouPor ?? ''}`.slice(0, 300) }, ultimo_erro: parouPor ?? null, atualizado_em: agora })
  }
  const { error } = await db.from('espelho_sync_estado').upsert(linhas, { onConflict: 'loja_id,frente' })
  if (error) console.error(`[espelho] guarda loja ${loja.id}/${frente}: ${error.message}`)
}

export type ResultadoLoja<R> = { loja: number; pulado?: string; resumo?: R; erro?: string }

/**
 * Roda `fn` em cada loja, uma de cada vez, em rodízio, até `orcamentoMs`. `fn` recebe o prazo (ms epoch) e devolve
 * um resumo com `parouPor` (formato dos crons: "limite do Omie: ..." / "erro do Omie: ..."). Exceção = erro (conta na
 * guarda como erro comum: banco fora, por exemplo, também espera antes de chamar o Omie de novo).
 */
export async function rodarLojasEspelho<R extends { parouPor: string | null }>(
  lojas: LojaOmie[], frente: FrenteEspelho, orcamentoMs: number, fn: (loja: LojaOmie, prazoMs: number) => Promise<R>,
  minimoPorLojaMs = 20_000,
): Promise<ResultadoLoja<R>[]> {
  const t0 = Date.now()
  const prazo = t0 + orcamentoMs
  const out: ResultadoLoja<R>[] = []
  for (const loja of ordemRodizio(lojas, t0)) {
    if (prazo - Date.now() < minimoPorLojaMs) { out.push({ loja: loja.id, pulado: 'orçamento do ciclo esgotado (fica para o próximo)' }); continue }
    const g = await verificarGuarda(loja, frente)
    if (g.motivo) { out.push({ loja: loja.id, pulado: g.motivo }); continue }
    try {
      const resumo = await fn(loja, prazo)
      await registrarFrente(loja, frente, g.guarda, resumo.parouPor)
      out.push({ loja: loja.id, resumo })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const limite = ehErroDeLimiteOmie(msg, e instanceof OmieError ? e.faultCode : undefined)
      await registrarFrente(loja, frente, g.guarda, `${limite ? 'limite do Omie' : 'erro interno'}: ${msg}`.slice(0, 500))
      out.push({ loja: loja.id, erro: msg })
    }
  }
  return out
}
