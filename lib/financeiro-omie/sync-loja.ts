// Financeiro A0: carga inicial + conferência periódica do financeiro do Omie pela API, uma loja por vez (o planejador
// puro decide a próxima ação: lib/financeiro-omie/planejador.ts). SÓ LEITURA no Omie: `lerOmie` recusa qualquer
// método que não comece com Listar. Regras do espelho completo: `semRepetir`, para a loja no 1º erro (o cursor fica),
// pausa entre chamadas, poucas chamadas por ciclo, trava por loja (`sync_trava` 'financeiro') e nunca 00–07 h da Bahia
// (a rota confere). Cursor em espelho_sync_estado frente 'financeiro'.
import { createServiceClient } from '@/lib/supabase/server'
import { omieRequest, OmieError, type LojaOmie } from '@/lib/omie/client'
import { classificarErroOmie } from '@/lib/omie/erros-omie'
import { pegarTravaSync, soltarTravaSync } from '@/lib/omie/trava-sync'
import { gravarEstadoSync, lerEstadoSync, paradaPorDisjuntor, sleep } from '@/lib/omie/espelho-estado'
import { ehErroDeLimiteOmie, isoParaBr, relogioBahia } from '@/lib/estoque/espelho-lojas'
import {
  aposAcao, aposErro, chamaOmie, coberturaFin, lerEstadoFin, proximaAcao, type Acao, type EstadoFin, type Pendente,
} from './planejador'
import {
  baixaDoMovimento, categoriaDoOmie, contaDoOmie, dreDoOmie, saldoDoExtrato, tituloDoMovimento, ultimaPorChave,
  chaveBaixa, chaveTitulo, type LinhaBaixa, type LinhaTitulo,
} from './normalizar'

export const FRENTE_FIN = 'financeiro'
/** Chamadas ao Omie por loja e ciclo de 10 min (o backfill de ~120 dias leva 1–2 dias por loja; ver AGENTS.md). */
export const CHAMADAS_FIN_POR_CICLO = 8
const PAUSA_MS = 1_000
const TETO_MS = 90_000
const POR_PAGINA = 100

type Resp = Record<string, unknown>

/** Única porta para o Omie neste módulo: só métodos de leitura, sempre sem repetir. */
async function lerOmie(loja: LojaOmie, endpoint: string, call: string, data: Record<string, unknown>): Promise<Resp> {
  if (!/^Listar[A-Z]/.test(call)) throw new Error(`financeiro-omie: método ${call} não é de leitura (bloqueado)`)
  return omieRequest<Resp>({ ...loja, loja_id: loja.id, endpoint, call, data, semRepetir: true })
}

const totalPaginas = (r: Resp, campo: string) => Math.max(0, Number(r[campo]) || 0)
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

async function gravarTitulos(lojaId: number, linhas: LinhaTitulo[]): Promise<number> {
  const db = createServiceClient({ semAutor: true })
  const unicas = ultimaPorChave(linhas, chaveTitulo)
  let n = 0
  for (let i = 0; i < unicas.length; i += 500) {
    const { data, error } = await db.rpc('omie_fin_gravar_titulos', { p_loja: lojaId, p_linhas: unicas.slice(i, i + 500) })
    if (error) throw new Error(`omie_fin_gravar_titulos: ${error.message}`)
    n += Number((data as { gravados?: number } | null)?.gravados ?? 0)
  }
  return n
}

async function gravarBaixas(lojaId: number, linhas: LinhaBaixa[]): Promise<number> {
  const db = createServiceClient({ semAutor: true })
  const unicas = ultimaPorChave(linhas, chaveBaixa)
  let n = 0
  for (let i = 0; i < unicas.length; i += 500) {
    const { data, error } = await db.rpc('omie_fin_gravar_baixas', { p_loja: lojaId, p_linhas: unicas.slice(i, i + 500) })
    if (error) throw new Error(`omie_fin_gravar_baixas: ${error.message}`)
    n += Number((data as { gravados?: number } | null)?.gravados ?? 0)
  }
  return n
}

async function upsertCadastro(tabela: string, linhas: Record<string, unknown>[], onConflict: string) {
  if (!linhas.length) return
  const { error } = await createServiceClient({ semAutor: true }).from(tabela).upsert(linhas, { onConflict })
  if (error) throw new Error(`${tabela}: ${error.message}`)
}

/** Executa uma ação. Devolve o que o planejador precisa (total de páginas etc.) e quantas linhas gravou. */
async function executar(loja: LojaOmie, a: Acao, hoje: string): Promise<{ r: Parameters<typeof aposAcao>[3]; linhas: number }> {
  const agoraISO = new Date().toISOString()
  switch (a.tipo) {
    case 'categorias': {
      const r = await lerOmie(loja, 'v1/geral/categorias', 'ListarCategorias', { pagina: a.pagina, registros_por_pagina: POR_PAGINA })
      const linhas = lista(r.categoria_cadastro).map((c) => categoriaDoOmie(c, agoraISO)).filter((x) => !!x).map((x) => ({ ...x, loja_id: loja.id }))
      await upsertCadastro('omie_fin_categorias', linhas, 'loja_id,codigo')
      return { r: { total: totalPaginas(r, 'total_de_paginas') }, linhas: linhas.length }
    }
    case 'dre': {
      const r = await lerOmie(loja, 'v1/geral/dre', 'ListarCadastroDRE', { apenasContasAtivas: 'N' })
      const linhas = lista(r.dreLista).map((d) => dreDoOmie(d, agoraISO)).filter((x) => !!x).map((x) => ({ ...x, loja_id: loja.id }))
      await upsertCadastro('omie_fin_dre', linhas, 'loja_id,codigo_dre')
      return { r: {}, linhas: linhas.length }
    }
    case 'contas': {
      const r = await lerOmie(loja, 'v1/geral/contacorrente', 'ListarContasCorrentes', { pagina: a.pagina, registros_por_pagina: POR_PAGINA })
      const linhas = lista(r.ListarContasCorrentes).map((c) => contaDoOmie(c, agoraISO)).filter((x): x is Record<string, unknown> => !!x).map((x): Record<string, unknown> => ({ ...x, loja_id: loja.id }))
      await upsertCadastro('omie_fin_contas_correntes', linhas, 'loja_id,id_conta_corrente')
      const contasAtivas = linhas.filter((l) => l.inativo !== true).map((l) => Number(l.id_conta_corrente))
      return { r: { total: totalPaginas(r, 'total_de_paginas'), contasAtivas }, linhas: linhas.length }
    }
    case 'saldo': {
      const r = await lerOmie(loja, 'v1/financas/extrato', 'ListarExtrato', {
        nCodCC: a.conta, dPeriodoInicial: isoParaBr(hoje), dPeriodoFinal: isoParaBr(hoje), cExibirApenasSaldo: 'S',
      })
      const s = saldoDoExtrato(r, agoraISO)
      if (s) {
        const { id_conta_corrente, ...valores } = s
        const { error } = await createServiceClient({ semAutor: true }).from('omie_fin_contas_correntes')
          .update(valores).eq('loja_id', loja.id).eq('id_conta_corrente', id_conta_corrente)
        if (error) throw new Error(`omie_fin_contas_correntes (saldo): ${error.message}`)
      }
      return { r: {}, linhas: s ? 1 : 0 }
    }
    case 'titulos':
    case 'baixas': {
      const r = await lerOmie(loja, 'v1/financas/mf', 'ListarMovimentos', {
        nPagina: a.cursor.pagina, nRegPorPagina: POR_PAGINA, cTpLancamento: a.tipo === 'titulos' ? 'CPCR' : 'BX',
        dDtAltDe: isoParaBr(a.cursor.ini), dDtAltAte: isoParaBr(a.cursor.fim), cOrdenarPor: 'CODIGO', lDadosCad: true,
      })
      const movs = lista(r.movimentos)
      const n = a.tipo === 'titulos'
        ? await gravarTitulos(loja.id, movs.map((m) => tituloDoMovimento(m, agoraISO)).filter((x): x is LinhaTitulo => !!x))
        : await gravarBaixas(loja.id, movs.map((m) => baixaDoMovimento(m, agoraISO)).filter((x): x is LinhaBaixa => !!x))
      return { r: { total: totalPaginas(r, 'nTotPaginas') }, linhas: n }
    }
    case 'abertos': {
      const r = await lerOmie(loja, 'v1/financas/mf', 'ListarMovimentos', {
        nPagina: a.pagina, nRegPorPagina: POR_PAGINA, cTpLancamento: 'CPCR', cStatus: 'EMABERTO', cOrdenarPor: 'CODIGO', lDadosCad: true,
      })
      const linhas = lista(r.movimentos).map((m) => tituloDoMovimento(m, agoraISO, { vistoAberto: true })).filter((x): x is LinhaTitulo => !!x)
      const n = await gravarTitulos(loja.id, linhas)
      return { r: { total: totalPaginas(r, 'nTotPaginas') }, linhas: n }
    }
    case 'buscar-sumidos': {
      const { data, error } = await createServiceClient({ semAutor: true })
        .rpc('omie_fin_abertos_nao_vistos', { p_loja: loja.id, p_desde: a.desde, p_limite: 300 })
      if (error) throw new Error(`omie_fin_abertos_nao_vistos: ${error.message}`)
      const sumidos: Pendente[] = ((data ?? []) as { codigo_lancamento_omie: number; natureza: 'P' | 'R' }[])
        .map((x) => ({ c: Number(x.codigo_lancamento_omie), n: x.natureza }))
      return { r: { sumidos }, linhas: 0 }
    }
    case 'conferir': {
      const r = await lerOmie(loja, 'v1/financas/mf', 'ListarMovimentos', {
        nPagina: 1, nRegPorPagina: 10, cTpLancamento: 'CPCR', nCodTitulo: a.pendente.c, lDadosCad: true,
      })
      const achado = lista(r.movimentos).map((m) => tituloDoMovimento(m, agoraISO, { origem: 'api-conferencia' }))
        .find((t) => t?.codigo_lancamento_omie === a.pendente.c)
      // Sumiu do Omie ("não existem registros"): excluído. Achado aberto: estava fora da varredura por deslocamento de página.
      const linha: LinhaTitulo = achado
        ? { ...achado, visto_aberto_em: achado.situacao === 'aberto' || achado.situacao === 'parcial' ? agoraISO : null }
        : { codigo_lancamento_omie: a.pendente.c, natureza: a.pendente.n, excluido: true, origem_dado: 'api-conferencia', fonte_em: agoraISO }
      return { r: {}, linhas: await gravarTitulos(loja.id, [linha]) }
    }
  }
}

export type ResumoFin = {
  loja: number; chamadas: number; linhas: number; acoes: string[]; parouPor: string | null
  cobertura: ReturnType<typeof coberturaFin> | null
}

export async function sincronizarFinanceiroLoja(
  loja: LojaOmie, opcoes: { maxChamadas?: number; prazoMs?: number } = {}, agora = new Date(),
): Promise<ResumoFin> {
  const maxChamadas = opcoes.maxChamadas ?? CHAMADAS_FIN_POR_CICLO
  const resumo: ResumoFin = { loja: loja.id, chamadas: 0, linhas: 0, acoes: [], parouPor: null, cobertura: null }
  if (!(await pegarTravaSync(loja.id, 'financeiro', 600))) return { ...resumo, parouPor: 'trava (outro ciclo em andamento)' }
  const prazo = Math.min(Date.now() + TETO_MS, opcoes.prazoMs ?? Infinity)
  try {
    let estado: EstadoFin = lerEstadoFin(await lerEstadoSync(loja.id, FRENTE_FIN))
    const { hoje } = relogioBahia(agora)
    const ciclo = { conferidos: 0 }
    let passos = 0
    while (resumo.chamadas < maxChamadas && Date.now() < prazo && passos++ < maxChamadas * 3) {
      const a = proximaAcao(estado, hoje, Date.now(), ciclo)
      if (!a) break
      if (chamaOmie(a)) {
        if (resumo.chamadas > 0) await sleep(PAUSA_MS)
        const disj = paradaPorDisjuntor(loja)
        if (disj) { resumo.parouPor = disj; break }
        resumo.chamadas++
      }
      const rotulo = a.tipo === 'titulos' || a.tipo === 'baixas' ? `${a.tipo}:${a.frente}:${a.cursor.ini}..${a.cursor.fim}:p${a.cursor.pagina}`
        : a.tipo === 'categorias' || a.tipo === 'contas' || a.tipo === 'abertos' ? `${a.tipo}:p${a.pagina}` : a.tipo
      resumo.acoes.push(rotulo)
      try {
        const { r, linhas } = await executar(loja, a, hoje)
        resumo.linhas += linhas
        if (a.tipo === 'conferir') ciclo.conferidos++
        estado = aposAcao(estado, a, new Date().toISOString(), r)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (!(e instanceof OmieError)) throw e // banco/código: a guarda do ciclo conta como erro interno
        const limite = ehErroDeLimiteOmie(msg, e.faultCode)
        resumo.parouPor = `${limite ? 'limite do Omie' : 'erro do Omie'}: ${msg}`.slice(0, 500)
        await gravarEstadoSync(loja.id, FRENTE_FIN, limite ? estado : aposErro(estado, a, resumo.parouPor, new Date().toISOString(), classificarErroOmie(msg) === 'transitorio'), resumo.parouPor)
        return { ...resumo, cobertura: coberturaFin(estado) }
      }
      await gravarEstadoSync(loja.id, FRENTE_FIN, estado, null)
    }
    resumo.cobertura = coberturaFin(estado)
    return resumo
  } finally {
    await soltarTravaSync(loja.id, 'financeiro')
  }
}
