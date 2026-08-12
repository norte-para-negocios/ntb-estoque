import { omieRequest, logIntegrationAttempt, type LojaOmie } from './client'
import { createServiceClient } from '@/lib/supabase/server'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface OmieOPIdentificacao {
  nCodOP: number
  cCodIntOP: string
  cNumOP: string
  nCodProduto: number
  dDtPrevisao: string
  nQtde: number
  codigo_local_estoque: number
}

interface OmieOPOutrasInf {
  cConcluida?: string
  dConclusao?: string
  dInclusao?: string
  dAlteracao?: string
  uAlt?: string
}

interface OmieOP {
  identificacao: OmieOPIdentificacao
  outrasInf?: OmieOPOutrasInf
  [k: string]: unknown
}

// Conclusao REAL da OP: outrasInf.cConcluida/dConclusao (nao a data planejada de
// infAdicionais, que pode estar preenchida numa OP nao concluida). Ver migration 012.
//
// Item #8 da reuniao 2026-07-27: "quem alterou a OP direto no Omie" -- o campo
// ja vem em outrasInf.uAlt (usuario da Omie, texto livre, nao referencia um
// profile do NTB) mas era descartado. So passa a existir daqui pra frente: o
// full_object gravado hoje ja e reduzido a itensDetalhes (ver toSlim abaixo),
// entao OPs alteradas antes desta mudanca nao tem como recuperar esse dado.
function mapOutrasInf(op: OmieOP) {
  const o = op.outrasInf ?? {}
  const concluida = o.cConcluida === 'S'
  return {
    concluida,
    dt_conclusao_real: parseDate(o.dConclusao),
    dt_inclusao: parseDate(o.dInclusao),
    dt_ultima_alteracao_omie: parseDate(o.dAlteracao),
    alterado_por_omie: o.uAlt || null,
    // Achado real (2026-08-05): quando o Omie ja confirma concluida=true por aqui
    // (sync/fetch), qualquer conclusao_status/erro de uma tentativa anterior
    // (ex.: "ja foi concluida", corrida entre executarConclusaoOP e um reenvio)
    // fica obsoleto -- mas o upsert desta funcao nunca tocava essas colunas, entao
    // ficavam presas mostrando erro numa OP que na verdade concluiu certo.
    // executarConclusaoOP ja limpa isso no caminho direto (marcarConcluidaLocal);
    // aqui e o mesmo para quando quem descobre a conclusao e o sync, nao o app.
    ...(concluida ? { conclusao_status: null, conclusao_erro_msg: null, conclusao_tentativas: 0 } : {}),
  }
}

interface OmieOPResponse {
  pagina: number
  total_de_paginas: number
  cadastros?: OmieOP[]
}

interface OrdemProducaoBulkRow {
  num_ordem: string
  identificacao_n_cod_op: number
  identificacao_c_cod_int_op: string
  identificacao_c_num_op: string
  identificacao_n_cod_produto: number
  identificacao_d_dt_previsao: string | null
  identificacao_n_qtde: number
  identificacao_codigo_local_estoque: number
  concluida: boolean
  dt_conclusao_real: string | null
  dt_inclusao: string | null
  dt_ultima_alteracao_omie: string | null
  alterado_por_omie: string | null
  full_object: unknown
}

const LOTE_ORDENS = 100

// Envia o lote de OPs pro Contabo, fire-and-forget, em pedacos de 100 (mesmo
// tamanho de pagina ja usado pelo sync). Mesma filosofia de
// gravarMovimentosNoFrio: nunca bloqueia nem quebra o upsert no Supabase.
async function gravarOrdensNoFrio(lojaId: number, linhas: OrdemProducaoBulkRow[]): Promise<void> {
  const url = process.env.NTB_FRIO_API_URL
  const key = process.env.NTB_FRIO_API_KEY
  if (!url || !linhas.length) return
  for (let i = 0; i < linhas.length; i += LOTE_ORDENS) {
    const lote = linhas.slice(i, i + LOTE_ORDENS)
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 15000)
      const resp = await fetch(`${url}/ordens_producao_bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': key ?? '' },
        body: JSON.stringify({ loja_id: lojaId, ordens: lote }),
        signal: controller.signal,
      })
      clearTimeout(timeoutId)
      if (!resp.ok) throw new Error(`Contabo respondeu ${resp.status}`)
    } catch (e) {
      console.error('ordem-producao: falha ao gravar ordens no Contabo', e)
    }
  }
}

export async function syncOrdensProducao(loja: LojaOmie, dataIni?: string, dataFim?: string) {
  const supabase = createServiceClient()
  await supabase.from('lojas').update({ ordem_producao_status: 'Processando' }).eq('id', loja.id)

  try {
    let pagina = 1
    let totalPaginas = 1

    do {
      const data: Record<string, unknown> = {
        pagina,
        registros_por_pagina: 100,
        ordem_decrescente: 'S',
        ordenar_por: 'dConclusao',
      }
      if (dataIni) data.dDtConclusaoDe = dataIni
      if (dataFim) data.dDtConclusaoAte = dataFim

      const res = await omieRequest<OmieOPResponse>({
        loja_id: loja.id,
        omie_app_key: loja.omie_app_key,
        omie_app_secret: loja.omie_app_secret,
        is_test: loja.is_test,
        endpoint: 'v1/produtos/op',
        call: 'ListarOrdemProducao',
        data,
      })

      totalPaginas = res.total_de_paginas || 1
      const ordens = res.cadastros ?? []

      if (ordens.length) {
        // Guarda apenas itensDetalhes — o resto do payload Omie ja tem colunas escalares
        // e inflar full_object enchia o banco (cada OP completa ~2-3KB de JSONB).
        const toSlim = (op: OmieOP) => {
          const itens = (op as Record<string, unknown>).itensDetalhes as unknown[] | undefined
          return (itens?.length ? { itensDetalhes: itens } : null) as unknown as OmieOP
        }

        const rows = ordens.map((op) => ({
          loja_id: loja.id,
          num_ordem: op.identificacao.cNumOP,
          identificacao_n_cod_op: op.identificacao.nCodOP,
          identificacao_c_cod_int_op: op.identificacao.cCodIntOP,
          identificacao_c_num_op: op.identificacao.cNumOP,
          identificacao_n_cod_produto: op.identificacao.nCodProduto,
          identificacao_d_dt_previsao: parseDate(op.identificacao.dDtPrevisao),
          identificacao_n_qtde: op.identificacao.nQtde,
          identificacao_codigo_local_estoque: op.identificacao.codigo_local_estoque,
          ...mapOutrasInf(op),
          full_object: toSlim(op),
          updated_at: new Date().toISOString(),
        }))

        // Preserva itensDetalhes existentes quando a API nao os retorna (ocorre para
        // OPs concluidas — a API ListarOrdemProducao omite itensDetalhes apos a conclusao).
        const semItens = rows.filter((r) => !r.full_object)
        if (semItens.length) {
          const cods = semItens.map((r) => r.identificacao_n_cod_op).filter(Boolean)
          const { data: existentes } = await supabase
            .from('ordens_producao')
            .select('identificacao_n_cod_op, full_object')
            .eq('loja_id', loja.id)
            .in('identificacao_n_cod_op', cods as number[])
          const itensMapExist = new Map<number, unknown>()
          for (const e of (existentes ?? []) as { identificacao_n_cod_op: number; full_object: Record<string, unknown> | null }[]) {
            const fo = e.full_object
            if (fo && Array.isArray(fo.itensDetalhes) && (fo.itensDetalhes as unknown[]).length) {
              itensMapExist.set(Number(e.identificacao_n_cod_op), fo.itensDetalhes)
            }
          }
          for (const r of rows) {
            if (!r.full_object && itensMapExist.has(Number(r.identificacao_n_cod_op))) {
              r.full_object = { itensDetalhes: itensMapExist.get(Number(r.identificacao_n_cod_op)) } as unknown as OmieOP
            }
          }
        }

        const { error: upsertError } = await supabase
          .from('ordens_producao')
          .upsert(rows, { onConflict: 'loja_id,identificacao_n_cod_op' })
        if (upsertError) {
          throw new Error(
            `syncOrdensProducao: falha ao upsertar ordens_producao (loja ${loja.id}): ${upsertError.message}`
          )
        }
        await gravarOrdensNoFrio(loja.id, rows.map((r) => ({
          num_ordem: r.num_ordem,
          identificacao_n_cod_op: r.identificacao_n_cod_op,
          identificacao_c_cod_int_op: r.identificacao_c_cod_int_op,
          identificacao_c_num_op: r.identificacao_c_num_op,
          identificacao_n_cod_produto: r.identificacao_n_cod_produto,
          identificacao_d_dt_previsao: r.identificacao_d_dt_previsao,
          identificacao_n_qtde: r.identificacao_n_qtde,
          identificacao_codigo_local_estoque: r.identificacao_codigo_local_estoque,
          concluida: r.concluida,
          dt_conclusao_real: r.dt_conclusao_real,
          dt_inclusao: r.dt_inclusao,
          dt_ultima_alteracao_omie: r.dt_ultima_alteracao_omie,
          alterado_por_omie: r.alterado_por_omie,
          full_object: r.full_object,
        })))
      }

      pagina++
    } while (pagina <= totalPaginas)

    await supabase
      .from('lojas')
      .update({
        ordem_producao_status: 'Concluido',
        ordem_producao_ultima_atualizacao: new Date().toISOString(),
      })
      .eq('id', loja.id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await supabase.from('lojas').update({ ordem_producao_status: 'Erro' }).eq('id', loja.id)
    await logIntegrationAttempt({
      loja_id: loja.id,
      model: 'OrdemProducao',
      request: 'syncOrdensProducao',
      error: true,
      error_message: msg,
    })
    throw e
  }
}

export async function fetchOrdemProducao(loja: LojaOmie, nCodOP: number) {
  const supabase = createServiceClient()
  const res = await omieRequest<OmieOP>({
    loja_id: loja.id,
    omie_app_key: loja.omie_app_key,
    omie_app_secret: loja.omie_app_secret,
    is_test: loja.is_test,
    endpoint: 'v1/produtos/op',
    call: 'ConsultarOrdemProducao',
    data: { nCodOP },
  })
  if (res?.identificacao) {
    const itens = (res as Record<string, unknown>).itensDetalhes as unknown[] | undefined
    const { error: upsertError } = await supabase.from('ordens_producao').upsert(
      {
        loja_id: loja.id,
        num_ordem: res.identificacao.cNumOP,
        identificacao_n_cod_op: res.identificacao.nCodOP,
        identificacao_c_cod_int_op: res.identificacao.cCodIntOP,
        identificacao_c_num_op: res.identificacao.cNumOP,
        identificacao_n_cod_produto: res.identificacao.nCodProduto,
        identificacao_d_dt_previsao: parseDate(res.identificacao.dDtPrevisao),
        identificacao_n_qtde: res.identificacao.nQtde,
        identificacao_codigo_local_estoque: res.identificacao.codigo_local_estoque,
        ...mapOutrasInf(res),
        full_object: itens?.length ? { itensDetalhes: itens } : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'loja_id,identificacao_n_cod_op' }
    )
    if (upsertError) {
      throw new Error(
        `fetchOrdemProducao: falha ao upsertar ordens_producao (loja ${loja.id}): ${upsertError.message}`
      )
    }
    await gravarOrdensNoFrio(loja.id, [{
      num_ordem: res.identificacao.cNumOP,
      identificacao_n_cod_op: res.identificacao.nCodOP,
      identificacao_c_cod_int_op: res.identificacao.cCodIntOP,
      identificacao_c_num_op: res.identificacao.cNumOP,
      identificacao_n_cod_produto: res.identificacao.nCodProduto,
      identificacao_d_dt_previsao: parseDate(res.identificacao.dDtPrevisao),
      identificacao_n_qtde: res.identificacao.nQtde,
      identificacao_codigo_local_estoque: res.identificacao.codigo_local_estoque,
      ...mapOutrasInf(res),
      full_object: itens?.length ? { itensDetalhes: itens } : null,
    }])
  }
}

// Detecta a resposta do Omie quando o nCodOP nao existe mais la (ordem excluida/
// nunca criada de verdade). So esse erro especifico autoriza apagar o registro local
// -- qualquer outro erro (rede instavel, rate limit, timeout) e tratado como
// inconclusivo e a OP fica intocada, pra nao apagar produção real por falso positivo.
export function pareceOPNaoExiste(msg: string): boolean {
  return /nao cadastrada|não cadastrada/i.test(msg)
}

/**
 * Reconcilia OPs ABERTAS (nunca concluidas) que podem ter sido excluidas direto
 * no Omie sem isso refletir aqui -- achado real em 2026-07-10: um lote de 44 OPs
 * (loja 6, mesmo created_at) ficou "fantasma" apos alguem recriar as mesmas OPs
 * manualmente no Omie; o sync normal (syncOrdensProducao/ListarOrdemProducao,
 * filtrado por data de CONCLUSAO) nunca pega esse caso porque uma OP aberta nao
 * tem dConclusao. Verifica cada uma via ConsultarOrdemProducao (a UNICA forma
 * confiavel de saber se ainda existe) e apaga localmente as que o Omie confirma
 * nao existirem mais.
 *
 * Duas fatias por chamada, `limite` cada (respeita rate limit do Omie, roda aos
 * poucos via cron em vez de vasculhar tudo de uma vez):
 * - "recentes" (created_at desc, sem filtro de atraso): achado real 2026-08-01 --
 *   o usuario testa excluindo OPs recem-criadas direto no Omie e elas ficavam
 *   fantasma indefinidamente, porque a fatia antiga (so `diasAtraso` dias no
 *   passado) nunca as alcancava.
 * - "atrasadas" (previsao no passado, mais antigas primeiro): comportamento
 *   original, mantido pra continuar varrendo o backlog historico.
 * Um id que caia nas duas fatias so e verificado uma vez.
 */
export async function reconciliarOPsFantasmas(
  loja: LojaOmie,
  diasAtraso = 3,
  limite = 40
): Promise<{ verificadas: number; excluidas: number; erros: number }> {
  const supabase = createServiceClient()
  const limiteData = new Date(Date.now() - diasAtraso * 86400000).toISOString().slice(0, 10)
  const metade = Math.ceil(limite / 2)

  const { data: recentes, error: recentesError } = await supabase
    .from('ordens_producao')
    .select('id, identificacao_n_cod_op, identificacao_d_dt_previsao')
    .eq('loja_id', loja.id)
    .eq('concluida', false)
    .not('identificacao_n_cod_op', 'is', null)
    .order('created_at', { ascending: false })
    .limit(metade)
  // Achado real (2026-07-30): rodando as 6 lojas concorrentes (Promise.allSettled
  // na rota), essa query as vezes da "statement timeout" no Supabase. Sem checar
  // o erro aqui, `candidatas` virava null e `candidatas ?? []` mascarava isso como
  // "0 candidatas, nada pra fazer" -- um falso negativo silencioso bem perigoso
  // pra um job cujo unico proposito e achar OPs que sumiram. Agora propaga o erro
  // pra aparecer como `erros` no resumo em vez de sumir.
  if (recentesError) {
    throw new Error(`reconciliarOPsFantasmas: falha ao buscar recentes (loja ${loja.id}): ${recentesError.message}`)
  }

  const { data: atrasadas, error: atrasadasError } = await supabase
    .from('ordens_producao')
    .select('id, identificacao_n_cod_op, identificacao_d_dt_previsao')
    .eq('loja_id', loja.id)
    .eq('concluida', false)
    .lt('identificacao_d_dt_previsao', limiteData)
    .not('identificacao_n_cod_op', 'is', null)
    .order('identificacao_d_dt_previsao', { ascending: true })
    .limit(metade)
  if (atrasadasError) {
    throw new Error(`reconciliarOPsFantasmas: falha ao buscar atrasadas (loja ${loja.id}): ${atrasadasError.message}`)
  }

  const vistas = new Set<number>()
  const candidatas = [...(recentes ?? []), ...(atrasadas ?? [])].filter((op) => {
    if (vistas.has(op.id)) return false
    vistas.add(op.id)
    return true
  }) as { id: number; identificacao_n_cod_op: number }[]

  let excluidas = 0
  let erros = 0
  for (const op of candidatas) {
    try {
      await fetchOrdemProducao(loja, op.identificacao_n_cod_op)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (pareceOPNaoExiste(msg)) {
        await supabase.from('ordens_producao').delete().eq('id', op.id).eq('loja_id', loja.id)
        excluidas++
      } else {
        erros++
      }
    }
    await sleep(400)
  }

  return { verificadas: candidatas.length, excluidas, erros }
}

/**
 * Cria uma Ordem de Producao no Omie (IncluirOrdemProducao). Usa a MESMA data para
 * inicio, conclusao e previsao (no Omie as tres datas devem ser iguais; a validade
 * fica so no nosso sistema). Nao envia `itens`: o Omie monta a malha a partir da
 * ficha tecnica/estrutura do produto. Retorna { nCodOP, cNumOP } da OP criada.
 */
export async function incluirOrdemProducao(
  loja: LojaOmie,
  params: {
    cCodIntOP: string
    nCodProduto: number
    dData: string // d/m/Y (usada para inicio, conclusao e previsao)
    nQtde: number
    codigoLocalEstoque?: number | null
    obs?: string
  }
) {
  const data: Record<string, unknown> = {
    identificacao: {
      cCodIntOP: params.cCodIntOP,
      nCodProduto: params.nCodProduto,
      dDtPrevisao: params.dData,
      nQtde: params.nQtde,
      ...(params.codigoLocalEstoque ? { codigo_local_estoque: params.codigoLocalEstoque } : {}),
    },
    infAdicionais: {
      dDtInicio: params.dData,
      dDtConclusao: params.dData,
    },
    ...(params.obs ? { observacoes: { cObs: params.obs } } : {}),
  }

  return omieRequest<{ nCodOP?: number; cCodIntOP?: string; cNumOP?: string }>({
    loja_id: loja.id,
    omie_app_key: loja.omie_app_key,
    omie_app_secret: loja.omie_app_secret,
    is_test: loja.is_test,
    endpoint: 'v1/produtos/op',
    call: 'IncluirOrdemProducao',
    data,
  })
}

/**
 * Altera a DATA e/ou a QUANTIDADE PLANEJADA de uma OP ABERTA no Omie
 * (AlterarOrdemProducao). Serve dois chamadores diferentes: `setDataOP` (muda a data,
 * reenvia a quantidade antiga) e `setQtdPlanejadaOP` (muda a quantidade, reenvia a data
 * antiga) — o Omie exige sempre o bloco `identificacao` completo, entao quem chama
 * reenvia o campo que NAO mudou como passthrough. Reescreve as tres datas
 * (previsao/inicio/conclusao) com o MESMO dia — igual ao incluir, onde o Omie exige as
 * tres iguais. NAO mexe em OP concluida (a action bloqueia antes).
 */
export async function alterarOrdemProducao(
  loja: LojaOmie,
  params: {
    nCodOP: number
    nCodProduto: number
    dData: string // d/m/Y (usada para inicio, conclusao e previsao)
    nQtde: number
    codigoLocalEstoque?: number | null
  }
) {
  const data: Record<string, unknown> = {
    identificacao: {
      nCodOP: params.nCodOP,
      nCodProduto: params.nCodProduto,
      dDtPrevisao: params.dData,
      nQtde: params.nQtde,
      ...(params.codigoLocalEstoque ? { codigo_local_estoque: params.codigoLocalEstoque } : {}),
    },
    infAdicionais: {
      dDtInicio: params.dData,
      dDtConclusao: params.dData,
    },
  }

  return omieRequest<{ nCodOP?: number; cCodIntOP?: string; cNumOP?: string }>({
    loja_id: loja.id,
    omie_app_key: loja.omie_app_key,
    omie_app_secret: loja.omie_app_secret,
    is_test: loja.is_test,
    endpoint: 'v1/produtos/op',
    call: 'AlterarOrdemProducao',
    data,
  })
}

/**
 * Exclui uma Ordem de Producao no Omie (ExcluirOrdemProducao). So vale para OP
 * ABERTA/pendente. Param: { nCodOP }. Validada em teste real anterior.
 */
export async function excluirOrdemProducao(loja: LojaOmie, nCodOP: number) {
  return omieRequest({
    loja_id: loja.id,
    omie_app_key: loja.omie_app_key,
    omie_app_secret: loja.omie_app_secret,
    is_test: loja.is_test,
    endpoint: 'v1/produtos/op',
    call: 'ExcluirOrdemProducao',
    data: { nCodOP },
  })
}

/**
 * Reverte a CONCLUSAO de uma OP concluida (ReverterOrdemProducao) — "Solicitacao
 * de reversao da conclusao da ordem de producao" (lista oficial do Omie). Param:
 * { nCodOP }. Volta a OP para o estado nao-concluido (estorna o estoque produzido).
 */
export async function reverterOrdemProducao(loja: LojaOmie, nCodOP: number) {
  return omieRequest({
    loja_id: loja.id,
    omie_app_key: loja.omie_app_key,
    omie_app_secret: loja.omie_app_secret,
    is_test: loja.is_test,
    endpoint: 'v1/produtos/op',
    call: 'ReverterOrdemProducao',
    data: { nCodOP },
  })
}

export async function concluirOrdemProducao(
  loja: LojaOmie,
  nCodOP: number,
  dataConclusao: string, // d/m/Y
  quantidade: number,
  observacao = ''
) {
  return omieRequest({
    loja_id: loja.id,
    omie_app_key: loja.omie_app_key,
    omie_app_secret: loja.omie_app_secret,
    is_test: loja.is_test,
    endpoint: 'v1/produtos/op',
    call: 'ConcluirOrdemProducao',
    data: {
      nCodOP,
      dDtConclusao: dataConclusao,
      nQtdeProduzida: quantidade,
      cObsConclusao: observacao,
    },
  })
}

function parseDate(d: string | null | undefined): string | null {
  if (!d) return null
  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}
