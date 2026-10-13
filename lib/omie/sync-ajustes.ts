import { createServiceClient } from '@/lib/supabase/server'
import { omieRequest, OmieError, type LojaOmie } from './client'
import { autorDoAjuste, origemDoAjuste } from '@/lib/estoque/ajuste-autor'
import { aposLeitura, historicoDesde, lerEstado, proximaLeitura, type ConfigFrentes } from '@/lib/estoque/espelho-frentes'
import { ehErroDeLimiteOmie, isoParaBr, relogioBahia } from '@/lib/estoque/espelho-lojas'
import { pegarTravaSync, soltarTravaSync } from './trava-sync'
import { gravarEstadoSync, lerEstadoSync, type ResumoCiclo } from './espelho-estado'

interface OmieAjuste {
  id_ajuste: number
  id_prod: number
  tipo: string
  quantidade: number
  valor: number
  codigo_local_estoque: number
  id_local_ds: number
  data: string
  motivo: string
  obs: string
  origem: string
  cod_int_ajuste?: string
  imp_api?: string
}

interface OmieAjusteResponse {
  pagina: number
  total_de_paginas: number
  total_de_registros: number
  ajuste_estoque_lista: OmieAjuste[]
}

interface MovimentoRow {
  loja_id: number
  id_ajuste: number
  id_prod: number | null
  tipo: string
  quan: number
  valor: number
  codigo_local_estoque: number | null
  codigo_local_estoque_destino: number | null
  data: string
  motivo: string | null
  obs: string | null
  origem: string
  status: string
  autor: string | null
  origem_ajuste: string
  cod_int_ajuste: string | null
}

const LOTE_MOVIMENTOS = 200

// Envia o lote de movimentos pro Contabo, em pedacos de 200. Nao lanca erro
// se o Contabo falhar -- mesma filosofia de gravarFatoNoFrio
// (lib/omie/faturamento.ts) e buscarFrio (lib/historico-contabo.ts): o
// upsert no Supabase, que sustenta o sync hoje, nunca pode quebrar por
// causa do dual-write.
async function gravarMovimentosNoFrio(lojaId: number, linhas: MovimentoRow[]): Promise<void> {
  const url = process.env.NTB_FRIO_API_URL
  const key = process.env.NTB_FRIO_API_KEY
  if (!url || !linhas.length) return
  for (let i = 0; i < linhas.length; i += LOTE_MOVIMENTOS) {
    // Colunas da migration 160 (autor/origem_ajuste/cod_int_ajuste) não existem no Contabo: fora do envio.
    const lote = linhas.slice(i, i + LOTE_MOVIMENTOS).map(({ autor: _a, origem_ajuste: _o, cod_int_ajuste: _c, ...resto }) => resto)
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 15000)
      const resp = await fetch(`${url}/movimentos_bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': key ?? '' },
        body: JSON.stringify({ loja_id: lojaId, movimentos: lote }),
        signal: controller.signal,
      })
      clearTimeout(timeoutId)
      if (!resp.ok) throw new Error(`Contabo respondeu ${resp.status}`)
    } catch (e) {
      console.error('sync-ajustes: falha ao gravar movimentos no Contabo', e)
    }
  }
}

const TIPOS_VALIDOS = new Set(['ENT', 'SAI', 'SLD', 'TRF', 'TPQ'])

function omieDataParaISO(d: string): string | null {
  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  const ano = Number(m[3])
  if (ano < 2020 || ano > 2100) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}

function ajusteParaMovimento(lojaId: number, a: OmieAjuste): MovimentoRow | null {
  const data = omieDataParaISO(a.data)
  if (!data) return null
  if (!TIPOS_VALIDOS.has(a.tipo)) return null
  return {
    loja_id: lojaId,
    id_ajuste: a.id_ajuste,
    id_prod: a.id_prod || null,
    tipo: a.tipo,
    quan: a.quantidade ?? 0,
    valor: a.valor ?? 0,
    codigo_local_estoque: a.codigo_local_estoque || null,
    codigo_local_estoque_destino: a.id_local_ds || null,
    data,
    motivo: a.motivo || null,
    obs: a.obs || null,
    origem: a.origem === 'PDV' ? 'PDV' : 'AJU',
    status: 'Concluido',
    autor: autorDoAjuste(a.obs),
    origem_ajuste: origemDoAjuste(a),
    cod_int_ajuste: a.cod_int_ajuste || null,
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Sync incremental de ajustes de estoque do Omie → movimentos.
 * API sort: ASC por id_ajuste (últimas páginas = mais recentes).
 * Varre das últimas páginas para as primeiras, para no cursor.
 * Retorna o número de registros inseridos/atualizados.
 */
export async function syncAjustes(loja: LojaOmie): Promise<number> {
  const supabase = createServiceClient()

  // Cursor: max id_ajuste já salvo para esta loja
  const { data: cursorRow } = await supabase
    .from('movimentos')
    .select('id_ajuste')
    .eq('loja_id', loja.id)
    .not('id_ajuste', 'is', null)
    .order('id_ajuste', { ascending: false })
    .limit(1)
    .single()
  const cursorId = Number((cursorRow as { id_ajuste: number } | null)?.id_ajuste ?? 0)

  // Busca página 1 para obter o total de páginas
  const resp1 = await omieRequest<OmieAjusteResponse>({
    loja_id: loja.id,
    omie_app_key: loja.omie_app_key,
    omie_app_secret: loja.omie_app_secret,
    is_test: loja.is_test,
    endpoint: 'v1/estoque/ajuste',
    call: 'ListarAjusteEstoque',
    data: { pagina: 1, registros_por_pagina: 50 },
  })
  if (!resp1?.total_de_paginas) return 0

  const totalPaginas = resp1.total_de_paginas
  let totalSalvos = 0

  // Varre do fim para o início (últimas páginas têm ids maiores = mais recentes)
  for (let pagina = totalPaginas; pagina >= 1; pagina--) {
    const resp = pagina === 1
      ? resp1
      : await omieRequest<OmieAjusteResponse>({
          loja_id: loja.id,
          omie_app_key: loja.omie_app_key,
          omie_app_secret: loja.omie_app_secret,
          is_test: loja.is_test,
          endpoint: 'v1/estoque/ajuste',
          call: 'ListarAjusteEstoque',
          data: { pagina, registros_por_pagina: 50 },
        })

    const ajustes = resp?.ajuste_estoque_lista ?? []
    if (!ajustes.length) break

    // Cursor: para quando todos os ids desta página são ≤ já sincronizado
    if (cursorId > 0 && ajustes.every((a) => Number(a.id_ajuste) <= cursorId)) break

    const novos = ajustes
      .filter((a) => Number(a.id_ajuste) > cursorId)
      .map((a) => ajusteParaMovimento(loja.id, a))
      .filter((r): r is MovimentoRow => r !== null)

    if (novos.length) {
      // supabase-js/PostgREST nao consegue expressar ON CONFLICT contra o
      // indice UNICO PARCIAL de (loja_id, id_ajuste) (migration 059, WHERE
      // id_ajuste IS NOT NULL) via .upsert() -- Postgres exige o predicado
      // repetido no ON CONFLICT pra usar um indice parcial como arbitro, e
      // o PostgREST nao gera isso. RPC faz o INSERT ... ON CONFLICT certo
      // direto em SQL (migration 079).
      const { error } = await supabase.rpc('upsert_movimentos_ajuste', { p_rows: novos })
      if (error) throw new Error(`Supabase upsert loja ${loja.id}: ${error.message}`)
      totalSalvos += novos.length
      await gravarMovimentosNoFrio(loja.id, novos)
    }

    await sleep(80)
  }

  return totalSalvos
}

// ---------------------------------------------------------------------------------------------------------
// Lojas com espelho completo ("nosso Omie", Fase 1): por JANELA DE DATA, não pelo maior id_ajuste (que pula
// ajuste antigo lançado depois, e o app grava id_ajuste direto em movimentos). Frente recente = últimos 3 dias a
// cada 30 min; backfill até 2026-07-01 com cursor de data (espelho_sync_estado, frente 'ajustes').
export const CFG_AJUSTES: ConfigFrentes = { diasRecentes: 3, janelaMaxDias: 30, limite: '2026-07-01', intervaloRecenteMin: 30 }
const PAGINAS_AJUSTES_POR_CICLO = 8
const PAUSA_AJUSTES_MS = 700
const TETO_AJUSTES_MS = 150_000

export async function syncAjustesJanela(loja: LojaOmie, agora = new Date()): Promise<ResumoCiclo> {
  const resumo: ResumoCiclo = { loja: loja.id, paginas: 0, linhas: 0, parouPor: null, historicoDesde: null }
  if (!(await pegarTravaSync(loja.id, 'ajustes', 600))) return { ...resumo, parouPor: 'trava (outro ciclo em andamento)' }
  const supabase = createServiceClient()
  const t0 = Date.now()
  try {
    let estado = lerEstado(await lerEstadoSync(loja.id, 'ajustes'))
    const { hoje } = relogioBahia(agora)
    while (resumo.paginas < PAGINAS_AJUSTES_POR_CICLO && Date.now() - t0 < TETO_AJUSTES_MS) {
      const p = proximaLeitura(estado, CFG_AJUSTES, hoje, Date.now(), [null])
      if (!p) break
      if (resumo.paginas > 0) await sleep(PAUSA_AJUSTES_MS)
      let resp: OmieAjusteResponse
      try {
        resp = await omieRequest<OmieAjusteResponse>({
          loja_id: loja.id, omie_app_key: loja.omie_app_key, omie_app_secret: loja.omie_app_secret, is_test: loja.is_test,
          endpoint: 'v1/estoque/ajuste', call: 'ListarAjusteEstoque',
          data: { pagina: p.cursor.pagina, registros_por_pagina: 50, data_movimento_de: isoParaBr(p.cursor.ini), data_movimento_ate: isoParaBr(p.cursor.fim) },
          semRepetir: true,
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        resumo.parouPor = `${ehErroDeLimiteOmie(msg, e instanceof OmieError ? e.faultCode : undefined) ? 'limite do Omie' : 'erro do Omie'}: ${msg}`.slice(0, 500)
        await gravarEstadoSync(loja.id, 'ajustes', p.estado, resumo.parouPor)
        break
      }
      resumo.paginas++
      const ajustes = resp?.ajuste_estoque_lista ?? []
      // Mesmo id_ajuste 2x no lote quebraria o ON CONFLICT da RPC: fica a última ocorrência.
      const porId = new Map<number, MovimentoRow>()
      for (const a of ajustes) {
        const r = ajusteParaMovimento(loja.id, a)
        if (r) porId.set(Number(r.id_ajuste), r)
      }
      const linhas = [...porId.values()]
      if (linhas.length) {
        // Índice único PARCIAL em movimentos(loja_id, id_ajuste): .upsert() não serve, só a RPC (migration 079/160).
        const { error } = await supabase.rpc('upsert_movimentos_ajuste', { p_rows: linhas })
        if (error) throw new Error(`upsert_movimentos_ajuste loja ${loja.id}: ${error.message}`)
        await gravarMovimentosNoFrio(loja.id, linhas)
      }
      resumo.linhas += linhas.length
      const total = ajustes.length ? Number(resp.total_de_paginas) || 1 : Number(resp?.total_de_paginas) || 0
      estado = aposLeitura(p.estado, p.frente, total, [null], CFG_AJUSTES, new Date().toISOString())
      await gravarEstadoSync(loja.id, 'ajustes', estado, null)
    }
    resumo.historicoDesde = historicoDesde(estado)
    return resumo
  } finally {
    await soltarTravaSync(loja.id, 'ajustes')
  }
}
