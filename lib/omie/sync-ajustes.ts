import { createServiceClient } from '@/lib/supabase/server'
import { omieRequest, type LojaOmie } from './client'

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
    const lote = linhas.slice(i, i + LOTE_MOVIMENTOS)
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
