// Cron sync-fichas ("nosso Omie", Fase 1): preenche estrutura_produto_cache aos poucos (até 20 produtos PA/PI por
// ciclo, pausa entre chamadas), com local de consumo, autor e datas; refaz cada ficha a cada 7 dias e apaga os
// insumos que saíram. Só lê o Omie (ConsultarEstrutura).
import { createServiceClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { OmieError, type LojaOmie } from './client'
import { consultarEstrutura, type EstruturaItem } from './malha'
import { pegarTravaSync, soltarTravaSync } from './trava-sync'
import { gravarEstadoSync, lerEstadoSync, sleep } from './espelho-estado'
import { ehErroDeLimiteOmie } from '@/lib/estoque/espelho-lojas'
import { escolherProdutosFicha, fichaMudou, insumosQueSairam, itensDaEstrutura, localPorInsumoDaOP } from '@/lib/estoque/fichas-puro'

const PRODUTOS_POR_CICLO = 20
const DIAS_REFAZER = 7
const PAUSA_MS = 1500
const TETO_MS = 150_000

export type ResumoFichas = { loja: number; lidas: number; semFicha: number; gravadas: number; removidas: number; parouPor: string | null }

/** Produto cuja ConsultarEstrutura deu erro do Omie sai da fila por 7 dias (senão erra no começo de todo ciclo). */
const ESPERA_ERRO_MS = DIAS_REFAZER * 86_400_000

export async function sincronizarFichasLoja(loja: LojaOmie, opcoes: { prazoMs?: number } = {}): Promise<ResumoFichas> {
  const r: ResumoFichas = { loja: loja.id, lidas: 0, semFicha: 0, gravadas: 0, removidas: 0, parouPor: null }
  if (!(await pegarTravaSync(loja.id, 'fichas', 600))) return { ...r, parouPor: 'trava (outro ciclo em andamento)' }
  const supabase = createServiceClient({ semAutor: true })
  const t0 = Date.now()
  const prazo = Math.min(t0 + TETO_MS, opcoes.prazoMs ?? Infinity)
  try {
    const estado = ((await lerEstadoSync(loja.id, 'fichas')) ?? {}) as { erros_produto?: Record<string, string> }
    const errosProduto: Record<string, string> = Object.fromEntries(
      Object.entries(estado.erros_produto ?? {}).filter(([, em]) => t0 - Date.parse(em) < ESPERA_ERRO_MS),
    )
    const erros: string[] = []
    const produtos = await buscarTodasLinhas<{ codigo_produto: number; tipo_item: string | null; inativo: boolean | null }>(
      (from, to) => supabase.from('produtos').select('codigo_produto, tipo_item, inativo').eq('loja_id', loja.id).order('id').range(from, to),
      undefined, (e) => erros.push(e.message),
    )
    const syncs = await buscarTodasLinhas<{ codigo_produto: number; sincronizado_em: string }>(
      (from, to) => supabase.from('estrutura_produto_sync').select('codigo_produto, sincronizado_em').eq('loja_id', loja.id).order('codigo_produto').range(from, to),
      undefined, (e) => erros.push(e.message),
    )
    if (erros.length) throw new Error(`sync-fichas: leitura falhou: ${erros[0]}`)
    const tipoPorCodigo = new Map(produtos.map((p) => [Number(p.codigo_produto), p.tipo_item]))
    const candidatos = produtos
      .filter((p) => (p.tipo_item === '03' || p.tipo_item === '04') && p.inativo !== true)
      .map((p) => Number(p.codigo_produto))
      .filter((c) => !errosProduto[String(c)])
    const ultima = new Map(syncs.map((s) => [Number(s.codigo_produto), s.sincronizado_em]))
    const escolhidos = escolherProdutosFicha(candidatos, ultima, Date.now(), PRODUTOS_POR_CICLO, DIAS_REFAZER)

    for (const [i, codigoProduto] of escolhidos.entries()) {
      if (Date.now() > prazo) break
      if (i > 0) await sleep(PAUSA_MS)
      let est
      try {
        est = await consultarEstrutura(loja, codigoProduto, { semRepetir: true })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        const limite = ehErroDeLimiteOmie(msg, e instanceof OmieError ? e.faultCode : undefined)
        r.parouPor = `${limite ? 'limite do Omie' : 'erro do Omie'}: ${msg}`.slice(0, 500)
        if (!limite) {
          errosProduto[String(codigoProduto)] = new Date().toISOString()
          await gravarEstadoSync(loja.id, 'fichas', { erros_produto: errosProduto }, `produto ${codigoProduto}: ${r.parouPor}`.slice(0, 500))
        }
        break
      }
      r.lidas++
      const g = await gravarFichaLida(supabase, loja.id, codigoProduto, est?.itens ?? [], tipoPorCodigo)
      if (!g.itens) r.semFicha++
      r.gravadas += g.gravadas
      r.removidas += g.removidas
    }
    return r
  } finally {
    await soltarTravaSync(loja.id, 'fichas')
  }
}

type ClienteServico = ReturnType<typeof createServiceClient>

/**
 * Grava em estrutura_produto_cache a ficha de UM produto recém-lida do Omie (ConsultarEstrutura): local de consumo
 * pela última OP do produto, só as linhas que mudaram, apaga os insumos que saíram e marca estrutura_produto_sync.
 * Usada pelo cron sync-fichas e pela troca de insumo (Fase 4) logo depois de reler a ficha.
 */
export async function gravarFichaLida(
  supabase: ClienteServico, lojaId: number, codigoProduto: number, itensOmie: EstruturaItem[], tipoPorCodigo: Map<number, string | null>,
): Promise<{ itens: number; gravadas: number; removidas: number }> {
  const { data: op, error: errOp } = await supabase.from('ordens_producao').select('full_object')
    .eq('loja_id', lojaId).eq('identificacao_n_cod_produto', codigoProduto).not('full_object', 'is', null)
    .order('id', { ascending: false }).limit(1).maybeSingle()
  if (errOp) throw new Error(`ordens_producao (local da OP): ${errOp.message}`)
  const linhas = itensDaEstrutura(itensOmie, {
    lojaId, codigoProduto, tipoPorCodigo, localPorInsumoOP: localPorInsumoDaOP(op?.full_object ?? null),
  })
  const { data: atuais, error: errAtuais } = await supabase.from('estrutura_produto_cache').select('*')
    .eq('loja_id', lojaId).eq('codigo_produto', codigoProduto)
  if (errAtuais) throw new Error(`estrutura_produto_cache: ${errAtuais.message}`)
  const porInsumo = new Map(((atuais ?? []) as Record<string, unknown>[]).map((a) => [Number(a.codigo_produto_insumo), a]))
  const agoraISO = new Date().toISOString()
  const mudadas = linhas.filter((l) => { const a = porInsumo.get(l.codigo_produto_insumo); return !a || fichaMudou(a, l) })
    .map((l) => ({ ...l, sincronizado_em: agoraISO }))
  if (mudadas.length) {
    const { error } = await supabase.from('estrutura_produto_cache').upsert(mudadas, { onConflict: 'loja_id,codigo_produto,codigo_produto_insumo' })
    if (error) throw new Error(`estrutura_produto_cache (gravar): ${error.message}`)
  }
  const sairam = insumosQueSairam([...porInsumo.keys()], linhas.map((l) => l.codigo_produto_insumo))
  if (sairam.length) {
    const { error } = await supabase.from('estrutura_produto_cache').delete()
      .eq('loja_id', lojaId).eq('codigo_produto', codigoProduto).in('codigo_produto_insumo', sairam)
    if (error) throw new Error(`estrutura_produto_cache (apagar): ${error.message}`)
  }
  const { error: errSync } = await supabase.from('estrutura_produto_sync')
    .upsert({ loja_id: lojaId, codigo_produto: codigoProduto, sincronizado_em: agoraISO, itens: linhas.length }, { onConflict: 'loja_id,codigo_produto' })
  if (errSync) throw new Error(`estrutura_produto_sync: ${errSync.message}`)
  return { itens: linhas.length, gravadas: mudadas.length, removidas: sairam.length }
}
