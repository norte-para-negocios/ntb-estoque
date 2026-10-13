// Cron sync-ops-abertas ("nosso Omie", Fase 1): TODAS as OPs abertas do Omie (ListarOrdemProducao cConcluida=N,
// sem janela de data) em ordens_producao, com origem/autor/observação, e a ficha gravada na OP
// (ConsultarOrdemProducao → itensDetalhes) em até 30 OPs por ciclo. OP que sumiu da lista vira aberta_omie=false
// (concluída ou excluída no Omie: o sync-ops e o reconciliar resolvem qual). Só lê o Omie.
import { createServiceClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { omieRequest, OmieError, type LojaOmie } from './client'
import { pareceOPNaoExiste } from './ordem-producao'
import { pegarTravaSync, soltarTravaSync } from './trava-sync'
import { gravarEstadoSync, sleep } from './espelho-estado'
import { ehErroDeLimiteOmie } from '@/lib/estoque/espelho-lojas'
import {
  linhaOPAberta, opMudou, opsQueSairamDaLista, precisaConsultarItens, type LinhaOPAberta, type OPOmieLista,
} from '@/lib/estoque/ops-abertas-puro'

const INTERVALO_S = 30 * 60      // a trava fica de pé 30 min depois de um ciclo bom = intervalo entre leituras
const CONSULTAS_POR_CICLO = 30
const PAUSA_MS = 700
const COLUNAS = 'id, identificacao_n_cod_op, num_ordem, identificacao_c_cod_int_op, identificacao_c_num_op, identificacao_n_cod_produto, identificacao_d_dt_previsao, identificacao_n_qtde, identificacao_codigo_local_estoque, dt_inclusao, dt_ultima_alteracao_omie, alterado_por_omie, incluido_por_omie, obs_omie, origem_op, aberta_omie, full_object, itens_consultados_em'

export type ResumoOps = {
  loja: number; abertas: number; novas: number; atualizadas: number; sairam: number; consultadas: number; parouPor: string | null
}

const motivo = (e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e)
  return `${ehErroDeLimiteOmie(msg, e instanceof OmieError ? e.faultCode : undefined) ? 'limite do Omie' : 'erro do Omie'}: ${msg}`.slice(0, 500)
}

export async function sincronizarOpsAbertas(loja: LojaOmie): Promise<ResumoOps> {
  const r: ResumoOps = { loja: loja.id, abertas: 0, novas: 0, atualizadas: 0, sairam: 0, consultadas: 0, parouPor: null }
  if (!(await pegarTravaSync(loja.id, 'ops-abertas', INTERVALO_S))) return { ...r, parouPor: 'intervalo de 30 min' }
  const supabase = createServiceClient()
  const base = { loja_id: loja.id, omie_app_key: loja.omie_app_key, omie_app_secret: loja.omie_app_secret, is_test: loja.is_test, endpoint: 'v1/produtos/op', semRepetir: true }
  let cicloBom = false
  try {
    // 1. Lista completa das abertas (para no 1º erro sem marcar nada).
    const lista: OPOmieLista[] = []
    try {
      let pagina = 1, total = 1
      do {
        if (pagina > 1) await sleep(PAUSA_MS)
        const resp = await omieRequest<{ total_de_paginas?: number; cadastros?: OPOmieLista[] }>({
          ...base, call: 'ListarOrdemProducao', data: { pagina, registros_por_pagina: 100, cConcluida: 'N' },
        })
        total = Number(resp?.total_de_paginas) || 1
        lista.push(...(resp?.cadastros ?? []).filter((o) => o?.identificacao?.nCodOP && o.outrasInf?.cConcluida !== 'S'))
        pagina++
      } while (pagina <= total)
    } catch (e) {
      r.parouPor = motivo(e)
      await gravarEstadoSync(loja.id, 'ops-abertas', { ...r, em: new Date().toISOString() }, r.parouPor)
      return r
    }
    const novasLinhas = new Map<number, LinhaOPAberta>()
    for (const op of lista) novasLinhas.set(Number(op.identificacao.nCodOP), linhaOPAberta(op, loja.id))
    r.abertas = novasLinhas.size

    // 2. Grava só o que é novo ou mudou (ordens_producao tem gatilho da outbox do desktop).
    const ids = [...novasLinhas.keys()]
    const existentes = new Map<number, Record<string, unknown>>()
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await supabase.from('ordens_producao').select(COLUNAS)
        .eq('loja_id', loja.id).in('identificacao_n_cod_op', ids.slice(i, i + 100))
      if (error) throw new Error(`ordens_producao (existentes): ${error.message}`)
      for (const row of (data ?? []) as unknown as Record<string, unknown>[]) existentes.set(Number(row.identificacao_n_cod_op), row)
    }
    const inserir: (LinhaOPAberta & { concluida: false })[] = []
    const atualizar: LinhaOPAberta[] = []
    for (const [id, linha] of novasLinhas) {
      const ex = existentes.get(id)
      if (!ex) inserir.push({ ...linha, concluida: false })
      else if (opMudou(ex, linha)) atualizar.push(linha)
    }
    for (const [lote, n] of [[inserir, 'novas'], [atualizar, 'atualizadas']] as const) {
      for (let i = 0; i < lote.length; i += 200) {
        const { error } = await supabase.from('ordens_producao').upsert(lote.slice(i, i + 200), { onConflict: 'loja_id,identificacao_n_cod_op' })
        if (error) throw new Error(`ordens_producao (${n}): ${error.message}`)
      }
    }
    r.novas = inserir.length
    r.atualizadas = atualizar.length

    // 3. Abertas aqui que não vieram na lista → aberta_omie = false.
    let leituraOk = true
    const locais = await buscarTodasLinhas<{ id: number; identificacao_n_cod_op: number }>(
      (from, to) => supabase.from('ordens_producao').select('id, identificacao_n_cod_op')
        .eq('loja_id', loja.id).not('concluida', 'is', true).not('aberta_omie', 'is', false)
        .not('identificacao_n_cod_op', 'is', null).order('id').range(from, to),
      undefined,
      () => { leituraOk = false },
    )
    const sairam = opsQueSairamDaLista(locais.map((l) => Number(l.identificacao_n_cod_op)), new Set(ids), leituraOk)
    for (let i = 0; i < sairam.length; i += 100) {
      const { error } = await supabase.from('ordens_producao').update({ aberta_omie: false })
        .eq('loja_id', loja.id).in('identificacao_n_cod_op', sairam.slice(i, i + 100))
      if (error) throw new Error(`ordens_producao (sairam): ${error.message}`)
    }
    r.sairam = sairam.length

    // 4. Ficha gravada na OP (itensDetalhes), no máximo 30 consultas, mais novas primeiro.
    const pendentes = ids
      .filter((id) => { const ex = existentes.get(id); return !ex || precisaConsultarItens(ex as { full_object: unknown; itens_consultados_em: string | null }) })
      .sort((a, b) => b - a)
      .slice(0, CONSULTAS_POR_CICLO)
    for (const nCodOP of pendentes) {
      await sleep(PAUSA_MS)
      const agoraISO = new Date().toISOString()
      try {
        const resp = await omieRequest<{ itensDetalhes?: unknown[] }>({ ...base, call: 'ConsultarOrdemProducao', data: { nCodOP } })
        const itens = Array.isArray(resp?.itensDetalhes) ? resp.itensDetalhes : []
        const { error } = await supabase.from('ordens_producao')
          .update(itens.length ? { full_object: { itensDetalhes: itens }, itens_consultados_em: agoraISO } : { itens_consultados_em: agoraISO })
          .eq('loja_id', loja.id).eq('identificacao_n_cod_op', nCodOP)
        if (error) throw new Error(`ordens_producao (itens): ${error.message}`)
        r.consultadas++
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (e instanceof OmieError && pareceOPNaoExiste(msg)) {
          await supabase.from('ordens_producao').update({ aberta_omie: false, itens_consultados_em: agoraISO })
            .eq('loja_id', loja.id).eq('identificacao_n_cod_op', nCodOP)
          continue
        }
        if (!(e instanceof OmieError) && !/fetch|timeout|abort/i.test(msg)) throw e
        r.parouPor = motivo(e)
        break
      }
    }
    await gravarEstadoSync(loja.id, 'ops-abertas', { ...r, lista_completa_em: new Date().toISOString() }, r.parouPor)
    cicloBom = true
    return r
  } finally {
    if (!cicloBom) await soltarTravaSync(loja.id, 'ops-abertas')
  }
}
