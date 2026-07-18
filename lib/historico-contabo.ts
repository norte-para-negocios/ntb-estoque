const JANELA_QUENTE_DIAS = 90

// Data mais antiga que ainda fica no Supabase apos a poda. Qualquer consulta
// que peca algo mais velho que isso precisa completar com o Contabo.
function limiteJanelaQuente(): string {
  return new Date(Date.now() - JANELA_QUENTE_DIAS * 86400000).toISOString().slice(0, 10)
}

function foraDaJanelaQuente(dataInicio?: string | null): boolean {
  if (!dataInicio) return true // sem filtro de data = a leitura espera "tudo"
  return dataInicio < limiteJanelaQuente()
}

export async function buscarFrio<T>(
  caminho: string,
  params: Record<string, string | number | undefined>
): Promise<T[]> {
  const url = process.env.NTB_FRIO_API_URL
  const key = process.env.NTB_FRIO_API_KEY
  if (!url) return []
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
  }
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)
    const resp = await fetch(`${url}${caminho}?${qs.toString()}`, {
      headers: { 'X-Api-Key': key ?? '' },
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    if (!resp.ok) throw new Error(`Contabo respondeu ${resp.status}`)
    const json = (await resp.json()) as { rows?: T[] }
    return json.rows ?? []
  } catch (e) {
    console.error(`historico-contabo: falha ao consultar ${caminho}`, e)
    return []
  }
}

// Contagem real (sem LIMIT) para cards/badges -- usa o parametro count=true do
// endpoint, que faz um select count(*) no Contabo em vez de trazer as linhas
// (evita truncar em falso o numero quando ha mais registros que o teto do modo normal).
export async function contarOrdensProducaoAntigas(opts: {
  lojaId: number
  dataFinal: string
}): Promise<number> {
  const url = process.env.NTB_FRIO_API_URL
  const key = process.env.NTB_FRIO_API_KEY
  if (!url) return 0
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)
    const resp = await fetch(
      `${url}/ordens_producao?loja_id=${opts.lojaId}&data_final=${opts.dataFinal}&count=true`,
      { headers: { 'X-Api-Key': key ?? '' }, signal: controller.signal }
    )
    clearTimeout(timeoutId)
    if (!resp.ok) throw new Error(`Contabo respondeu ${resp.status}`)
    const json = (await resp.json()) as { count?: number }
    return json.count ?? 0
  } catch (e) {
    console.error('historico-contabo: falha ao contar ordens_producao antigas', e)
    return 0
  }
}

function mesclarPorId<T extends { id: number }>(quentes: T[], frias: T[]): T[] {
  const vistos = new Set(quentes.map((r) => r.id))
  return [...quentes, ...frias.filter((r) => !vistos.has(r.id))]
}

export async function complementarNotasFiscais<T extends { id: number }>(
  quentes: T[],
  opts: { lojaId: number; dataInicio?: string; dataFinal?: string; busca?: string; id?: number }
): Promise<T[]> {
  if (!foraDaJanelaQuente(opts.dataInicio) && !opts.id) return quentes
  const frias = await buscarFrio<T>('/notas_fiscais', {
    loja_id: opts.lojaId,
    data_inicio: opts.dataInicio,
    data_final: opts.dataFinal,
    busca: opts.busca,
    id: opts.id,
  })
  return mesclarPorId(quentes, frias)
}

export async function complementarNotaFiscalItems<T extends { id: number }>(
  quentes: T[],
  opts: { lojaId: number; notaFiscalId?: number | number[]; dataInicio?: string; dataFinal?: string }
): Promise<T[]> {
  if (!opts.notaFiscalId && !foraDaJanelaQuente(opts.dataInicio)) return quentes
  const frias = await buscarFrio<T>('/nota_fiscal_items', {
    loja_id: opts.lojaId,
    nota_fiscal_id: Array.isArray(opts.notaFiscalId) ? opts.notaFiscalId.join(',') : opts.notaFiscalId,
    data_inicio: opts.dataInicio,
    data_final: opts.dataFinal,
  })
  return mesclarPorId(quentes, frias)
}

export async function complementarOrdensProducao<T extends { id: number }>(
  quentes: T[],
  opts: {
    lojaId: number
    dataInicio?: string
    dataFinal?: string
    validadeInicio?: string
    validadeFinal?: string
    busca?: string
    id?: number
  }
): Promise<T[]> {
  const precisa =
    opts.id || foraDaJanelaQuente(opts.dataInicio) || foraDaJanelaQuente(opts.validadeInicio)
  if (!precisa) return quentes
  const frias = await buscarFrio<T>('/ordens_producao', {
    loja_id: opts.lojaId,
    data_inicio: opts.dataInicio,
    data_final: opts.dataFinal,
    validade_inicio: opts.validadeInicio,
    validade_final: opts.validadeFinal,
    busca: opts.busca,
    id: opts.id,
  })
  return mesclarPorId(quentes, frias)
}

export async function complementarMovimentos<T extends { id: number }>(
  quentes: T[],
  opts: { lojaId: number; dataInicio?: string; dataFinal?: string; idProd?: number; transferenciaId?: number }
): Promise<T[]> {
  if (!foraDaJanelaQuente(opts.dataInicio)) return quentes
  const frias = await buscarFrio<T>('/movimentos', {
    loja_id: opts.lojaId,
    data_inicio: opts.dataInicio,
    data_final: opts.dataFinal,
    id_prod: opts.idProd,
    transferencia_id: opts.transferenciaId,
  })
  return mesclarPorId(quentes, frias)
}

export async function complementarMovimentosHistorico<T extends { cod_prod: number; data: string }>(
  quentes: T[],
  opts: { lojaId: number; codProd?: number; dataInicio?: string; dataFinal?: string }
): Promise<T[]> {
  if (!foraDaJanelaQuente(opts.dataInicio)) return quentes
  const frias = await buscarFrio<T>('/movimentos_historico', {
    loja_id: opts.lojaId,
    cod_prod: opts.codProd,
    data_inicio: opts.dataInicio,
    data_final: opts.dataFinal,
  })
  const vistos = new Set(quentes.map((r) => `${r.cod_prod}|${r.data}`))
  return [...quentes, ...frias.filter((r) => !vistos.has(`${r.cod_prod}|${r.data}`))]
}

// Busca crua de nota_fiscal_items por periodo (sem mesclar) -- usada quando o
// caller precisa dos campos nf_d_emissao_nfe/nf_c_numero_nfe/nf_c_natureza_operacao
// do join que o endpoint /nota_fiscal_items ja faz internamente (ex: MovimentosTab).
export async function buscarFrioNotaFiscalItems<T>(opts: {
  lojaId: number
  dataInicio: string
  dataFinal: string
}): Promise<T[]> {
  return buscarFrio<T>('/nota_fiscal_items', {
    loja_id: opts.lojaId,
    data_inicio: opts.dataInicio,
    data_final: opts.dataFinal,
  })
}

// Usado so pelo caso especial do relatorio-movimentacao: busca linhas cruas
// sem mesclar com nada, pra agregacao acontecer em JS.
export async function buscarMovimentosHistoricoBrutos<T>(opts: {
  lojaId: number
  dataInicio: string
  dataFinal: string
}): Promise<T[]> {
  return buscarFrio<T>('/movimentos_historico', {
    loja_id: opts.lojaId,
    data_inicio: opts.dataInicio,
    data_final: opts.dataFinal,
  })
}

export type LinhaMovHistoricoBruta = {
  loja_id: number
  cod_prod: number
  codigo: string | null
  descricao: string | null
  data: string
  entradas: number
  saidas: number
}

type MetaProduto = { codigo_produto: number; tipo_item: string | null; descricao_familia: string | null }

// Reimplementa em JS o mesmo agrupamento da funcao SQL relatorio_movimentacao_matriz
// (supabase/migrations/066_relatorio_movimentacao_filtros.sql) -- usada so para a fracao
// da consulta que caiu fora da janela quente, ja que produtos (join da funcao SQL)
// nao pode ser duplicado no Contabo. Se a funcao SQL mudar de novo, replicar aqui tambem.
export function agregarMovimentacaoJS(
  linhas: LinhaMovHistoricoBruta[],
  metaPorCodigo: Map<number, MetaProduto>,
  precoPorProduto: Map<number, number>,
  dim: 'tipo' | 'familia' | 'produto',
  sentido: 'entradas' | 'saidas'
): { rotulo: string; mes: string; qtde: number; valor: number }[] {
  const grupos = new Map<string, { rotulo: string; mes: string; qtde: number; valor: number }>()
  for (const l of linhas) {
    const meta = metaPorCodigo.get(l.cod_prod)
    const rotulo =
      (dim === 'tipo' ? meta?.tipo_item : dim === 'familia' ? meta?.descricao_familia : l.descricao) ||
      'Sem classificação'
    const mes = l.data.slice(0, 7)
    // Number() e essencial: entradas/saidas sao `numeric` no Postgres, e o
    // driver `pg` do lado do servidor Contabo so normaliza bigint/date (ver
    // AGENTS.md) -- numeric chega como STRING. Sem isso, "+=" concatena
    // string em vez de somar (achado real: coluna de mes virando um numero
    // com 50+ digitos na tela de Movimentacao).
    const qtde = Number(sentido === 'entradas' ? l.entradas : l.saidas) || 0
    if (!qtde) continue
    const preco = precoPorProduto.get(l.cod_prod) ?? 0
    // JSON.stringify em vez de "|": rotulo vem de descricao de produto sem
    // sanitizacao, um "|" no nome colidiria 2 chaves diferentes (mesmo
    // achado ja corrigido em lib/omie/faturamento.ts).
    const chave = JSON.stringify([rotulo, mes])
    const acc = grupos.get(chave) ?? { rotulo, mes, qtde: 0, valor: 0 }
    acc.qtde += qtde
    acc.valor += qtde * preco
    grupos.set(chave, acc)
  }
  return [...grupos.values()].sort((a, b) => a.rotulo.localeCompare(b.rotulo) || a.mes.localeCompare(b.mes))
}

export { limiteJanelaQuente, foraDaJanelaQuente }
