import { createServiceClient } from '@/lib/supabase/server'

export type Granularidade = 'dia' | 'semana' | 'mes'

export type BucketProducao = {
  chave: string
  rotulo: string
  total: number
  porFuncionario: { nome: string; qtd: number }[]
}

export type DashboardProducao = {
  buckets: BucketProducao[]
  funcionariosOrdenados: string[]
}

// Filtros novos (auditoria de filtros/relatorios, Task 5, 2026-08-04): Producao
// era a unica tela de relatorio sem filtro de tipo/familia/produto/local --
// ordens_producao nao guarda tipo/familia direto, so codigo_produto e local, entao
// tipo/familia sempre precisam cruzar com o mapa de produtos (buscarProdutosMeta).
export type FiltrosProducao = {
  tipos?: string[]
  familias?: string[]
  /** Texto livre: casa por codigo OU descricao do produto (case-insensitive, substring). */
  produto?: string
  local?: number | null
}

type OpRow = { dt_conclusao_real: string | null; concluida_por: string | null; identificacao_n_cod_produto: number | null }

type ProdutoMeta = { tipo: string | null; familia: string | null; descricao: string | null; codigo: string | null }

const NAO_IDENTIFICADO = 'Não identificado'
const MAX_SERIES = 7

function mesParaIntervalo(mesRef: string): { ini: string; fim: string; numDias: number } {
  const [ano, mes] = mesRef.split('-').map(Number)
  const numDias = new Date(ano, mes, 0).getDate()
  return { ini: `${mesRef}-01`, fim: `${mesRef}-${String(numDias).padStart(2, '0')}`, numDias }
}

// Últimos n meses terminando em mesRef, pra granularidade 'mes'.
function ultimosMeses(mesRef: string, n: number): string[] {
  const [ano, mes] = mesRef.split('-').map(Number)
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(ano, mes - 1 - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

const MES_LABEL = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

async function buscarOpsPaginado(lojaId: number, dataIni: string, dataFim: string, local: number | null): Promise<OpRow[]> {
  const supabase = createServiceClient()
  const PAGE = 1000
  const todas: OpRow[] = []
  for (let p = 0; ; p++) {
    let q = supabase
      .from('ordens_producao')
      .select('dt_conclusao_real, concluida_por, identificacao_n_cod_produto')
      .eq('loja_id', lojaId)
      .eq('concluida', true)
      .gte('dt_conclusao_real', dataIni)
      .lte('dt_conclusao_real', dataFim)
      // Achado real (revisão final da auditoria de filtros/relatórios, item
      // M1): paginação por OFFSET sem ORDER BY determinístico -- mesmo risco
      // já corrigido em nota-fiscal/relatorio/route.ts (Postgres não garante
      // ordem estável entre chamadas sem um critério explícito, podendo
      // duplicar ou pular linha no limite entre páginas).
      .order('id', { ascending: true })
    if (local != null) q = q.eq('identificacao_codigo_local_estoque', local)
    const { data, error } = await q.range(p * PAGE, p * PAGE + PAGE - 1)
    if (error || !data?.length) break
    todas.push(...(data as OpRow[]))
    if (data.length < PAGE) break
  }
  return todas
}

// Mapa codigo_produto -> {tipo, familia, descricao, codigo}, usado pra filtrar por
// tipo/familia/produto (ordens_producao so guarda o codigo do produto, nao essas
// dimensoes). Lojas ativas tem 2300-2900+ produtos (so a loja 7 escapa com 693) --
// um .select() sem paginar corta em 1000 e perde produto silenciosamente (mesmo
// bug ja visto 2x neste projeto, ver relatorio-compras/page.tsx e
// relatorio-indicadores/page.tsx), entao pagina sempre com .range().
async function buscarProdutosMeta(lojaId: number): Promise<Map<number, ProdutoMeta>> {
  const supabase = createServiceClient()
  const PAGE = 1000
  const meta = new Map<number, ProdutoMeta>()
  for (let p = 0; ; p++) {
    const { data, error } = await supabase
      .from('produtos')
      .select('codigo_produto, tipo_item, descricao_familia, descricao, codigo')
      .eq('loja_id', lojaId)
      // Achado real (revisão final da auditoria de filtros/relatórios, item
      // M1): mesmo risco de ORDER BY ausente na paginação por OFFSET, ver
      // comentário em buscarOpsPaginado acima.
      .order('id', { ascending: true })
      .range(p * PAGE, p * PAGE + PAGE - 1)
    if (error || !data?.length) break
    for (const p2 of data) {
      meta.set(Number(p2.codigo_produto), {
        tipo: p2.tipo_item,
        familia: p2.descricao_familia,
        descricao: p2.descricao,
        codigo: p2.codigo,
      })
    }
    if (data.length < PAGE) break
  }
  return meta
}

export async function carregarDashboardProducao(
  lojaId: number,
  granularidade: Granularidade,
  mesRef: string,
  filtros: FiltrosProducao = {}
): Promise<DashboardProducao> {
  const supabase = createServiceClient()

  const dataIni = granularidade === 'mes' ? `${ultimosMeses(mesRef, 6)[0]}-01` : mesParaIntervalo(mesRef).ini
  const dataFim = mesParaIntervalo(mesRef).fim

  // Local vai direto no WHERE (coluna existe em ordens_producao); tipo/familia/produto
  // nao existem na tabela e sao aplicados depois, cruzando com o mapa de produtos.
  const ops = await buscarOpsPaginado(lojaId, dataIni, dataFim, filtros.local ?? null)

  const tiposSet = filtros.tipos?.length ? new Set(filtros.tipos) : null
  const familiasSet = filtros.familias?.length ? new Set(filtros.familias) : null
  const termoBusca = filtros.produto?.trim().toLowerCase() || null
  const precisaMeta = !!(tiposSet || familiasSet || termoBusca)
  const opsFiltradas = precisaMeta
    ? await (async () => {
        const meta = await buscarProdutosMeta(lojaId)
        return ops.filter((o) => {
          const cod = o.identificacao_n_cod_produto
          const m = cod != null ? meta.get(cod) : undefined
          if (tiposSet && !(m?.tipo && tiposSet.has(m.tipo))) return false
          if (familiasSet && !(m?.familia && familiasSet.has(m.familia))) return false
          if (termoBusca) {
            const alvo = `${m?.codigo ?? ''} ${m?.descricao ?? ''}`.toLowerCase()
            if (!alvo.includes(termoBusca)) return false
          }
          return true
        })
      })()
    : ops

  // Nomes: so busca os profiles realmente referenciados nas OPs do periodo (ja filtradas).
  const idsUnicos = Array.from(new Set(opsFiltradas.map((o) => o.concluida_por).filter((id): id is string => !!id)))
  const nomePorId = new Map<string, string>()
  if (idsUnicos.length) {
    const { data: profiles } = await supabase.from('profiles').select('id, name').in('id', idsUnicos)
    for (const p of profiles ?? []) nomePorId.set(p.id, p.name || NAO_IDENTIFICADO)
  }

  // Bucket key por granularidade.
  function chaveDoRegistro(dataISO: string): { chave: string } {
    if (granularidade === 'dia') {
      return { chave: dataISO }
    }
    if (granularidade === 'mes') {
      return { chave: dataISO.slice(0, 7) }
    }
    // semana: numero da semana dentro do proprio mes de referencia (1a semana = dias 1-7, etc.)
    const dia = Number(dataISO.slice(8, 10))
    const semana = Math.floor((dia - 1) / 7) + 1
    return { chave: `${dataISO.slice(0, 7)}-S${semana}` }
  }

  const buckets = new Map<string, { rotulo: string; porFuncionario: Map<string, number> }>()

  // Garante buckets vazios pra todo o eixo (dias/semanas do mes, ou os 6 meses),
  // pra o grafico nao "pular" periodos sem producao -- e exatamente o que a
  // gestao quer enxergar (dia sem producao vira um buraco visivel, nao um gap invisivel).
  if (granularidade === 'dia') {
    const { numDias } = mesParaIntervalo(mesRef)
    for (let d = 1; d <= numDias; d++) {
      const chave = `${mesRef}-${String(d).padStart(2, '0')}`
      buckets.set(chave, { rotulo: String(d), porFuncionario: new Map() })
    }
  } else if (granularidade === 'semana') {
    const { numDias } = mesParaIntervalo(mesRef)
    const totalSemanas = Math.floor((numDias - 1) / 7) + 1
    for (let s = 1; s <= totalSemanas; s++) {
      buckets.set(`${mesRef}-S${s}`, { rotulo: `Sem ${s}`, porFuncionario: new Map() })
    }
  } else {
    for (const m of ultimosMeses(mesRef, 6)) {
      const [ano, mes] = m.split('-')
      buckets.set(m, { rotulo: `${MES_LABEL[Number(mes) - 1]}/${ano.slice(2)}`, porFuncionario: new Map() })
    }
  }

  for (const op of opsFiltradas) {
    if (!op.dt_conclusao_real) continue
    const { chave } = chaveDoRegistro(op.dt_conclusao_real)
    const bucket = buckets.get(chave)
    if (!bucket) continue
    const nome = op.concluida_por ? (nomePorId.get(op.concluida_por) ?? NAO_IDENTIFICADO) : NAO_IDENTIFICADO
    bucket.porFuncionario.set(nome, (bucket.porFuncionario.get(nome) ?? 0) + 1)
  }

  // Ordem fixa de cor: funcionarios ordenados por volume TOTAL no periodo inteiro
  // (nao por bucket -- senao a cor de uma pessoa mudaria de dia pra dia).
  const totalPorFuncionario = new Map<string, number>()
  for (const b of buckets.values()) {
    for (const [nome, qtd] of b.porFuncionario) {
      totalPorFuncionario.set(nome, (totalPorFuncionario.get(nome) ?? 0) + qtd)
    }
  }
  const ordenadosPorVolume = Array.from(totalPorFuncionario.entries())
    .filter(([nome]) => nome !== NAO_IDENTIFICADO)
    .sort((a, b) => b[1] - a[1])
    .map(([nome]) => nome)
  const funcionariosOrdenados = ordenadosPorVolume.slice(0, MAX_SERIES)
  const temNaoIdentificado = totalPorFuncionario.has(NAO_IDENTIFICADO)
  const temOutros = ordenadosPorVolume.length > MAX_SERIES

  const resultado: BucketProducao[] = Array.from(buckets.entries()).map(([chave, b]) => {
    const porFuncionario: { nome: string; qtd: number }[] = []
    for (const nome of funcionariosOrdenados) {
      const qtd = b.porFuncionario.get(nome) ?? 0
      if (qtd > 0) porFuncionario.push({ nome, qtd })
    }
    if (temOutros) {
      const qtdOutros = Array.from(b.porFuncionario.entries())
        .filter(([nome]) => !funcionariosOrdenados.includes(nome) && nome !== NAO_IDENTIFICADO)
        .reduce((s, [, qtd]) => s + qtd, 0)
      if (qtdOutros > 0) porFuncionario.push({ nome: 'Outros', qtd: qtdOutros })
    }
    const qtdNaoIdent = b.porFuncionario.get(NAO_IDENTIFICADO) ?? 0
    if (qtdNaoIdent > 0) porFuncionario.push({ nome: NAO_IDENTIFICADO, qtd: qtdNaoIdent })
    const total = porFuncionario.reduce((s, f) => s + f.qtd, 0)
    return { chave, rotulo: b.rotulo, total, porFuncionario }
  })

  return {
    buckets: resultado,
    funcionariosOrdenados: [
      ...funcionariosOrdenados,
      ...(temOutros ? ['Outros'] : []),
      ...(temNaoIdentificado ? [NAO_IDENTIFICADO] : []),
    ],
  }
}
