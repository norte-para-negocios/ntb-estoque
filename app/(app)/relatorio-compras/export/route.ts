import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { gerarPlanilhaMulti, planilhaResponse, type ColunaExcel } from '@/lib/excel'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { valoresMulti } from '@/components/ui-kit/filtros-utils'
import { limiteJanelaQuente } from '@/lib/historico-contabo'
import {
  buscarItensNFFrio,
  filtrarItensCompras,
  agregarComprasMatriz,
  mapearComprasDetalhe,
  type ItemNFFrio,
  type MetaProdutoNF,
} from '@/lib/relatorio-frio-nf'

// Converte lista vazia em null (RPC trata null como "sem filtro"; array vazio
// com `= any()` não bateria com nada).
const arrOrNull = (a: string[]): string[] | null => (a.length ? a : null)

const TIPO_LABEL = new Map(PRODUTO_TIPO_ITEM.map((t) => [t.value, t.label]))

// Abertura (dimensão) da aba Resumo, espelhando as planilhas do Ramon.
const DIM_LABEL: Record<string, string> = {
  familia: 'Família',
  fornecedor: 'Fornecedor',
  produto: 'Produto',
  tipo: 'Tipo',
  cfop: 'CFOP',
}

const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

function fmtData(d: string | null): string {
  if (!d) return ''
  const [a, m, dia] = String(d).slice(0, 10).split('-')
  return `${dia}/${m}/${a}`
}

// 'YYYY-MM' -> 'jun/26' (rótulo de coluna mensal).
function mesLabel(ym: string): string {
  const [a, m] = ym.split('-')
  return `${MESES_ABREV[Number(m) - 1] ?? m}/${a.slice(2)}`
}

type LinhaDetalhe = {
  data: string | null
  mes: string | null
  nota: string | null
  fornecedor: string | null
  tipo: string | null
  familia: string | null
  produto: string | null
  codigo: string | null
  ncm: string | null
  cfop: string | null
  unidade: string | null
  qtde: number | null
  preco_unit: number | null
  total: number | null
}

type LinhaMatriz = { rotulo: string; mes: string; valor: number }

export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await getAtorGestao()).podeGerir) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const ini = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('data_inicio') ?? '')
    ? (searchParams.get('data_inicio') as string)
    : `${hojeISO.slice(0, 4)}-01-01`
  const fim = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('data_final') ?? '')
    ? (searchParams.get('data_final') as string)
    : hojeISO
  const dim = DIM_LABEL[searchParams.get('dim') ?? ''] ? (searchParams.get('dim') as string) : 'familia'
  const familias = valoresMulti(searchParams.get('familia') ?? undefined)
  const tipos = valoresMulti(searchParams.get('tipo') ?? undefined)
  const cfops = valoresMulti(searchParams.get('cfop') ?? undefined)
  const fornecedor = searchParams.get('fornecedor') || null
  const produto = searchParams.get('produto') || null
  const localCod = searchParams.get('local') && !Number.isNaN(Number(searchParams.get('local'))) ? Number(searchParams.get('local')) : null
  const status = searchParams.get('status') || 'CONCLUIDA'
  const filtros = {
    p_familias: arrOrNull(familias),
    p_tipos: arrOrNull(tipos),
    p_fornecedor: fornecedor,
    p_cfops: arrOrNull(cfops),
    p_produto: produto,
    p_local: localCod,
    p_status: status,
  }

  const supabase = await createClient()
  // RPC pode devolver muito mais de 1000 linhas (detalhe item a item, ou matriz
  // por produto). O PostgREST limita a 1000 por resposta, entao paginamos com
  // .range ate vir uma pagina incompleta. Sem isso o Excel truncava em 1000.
  async function rpcTodos<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
    const PAGE_SIZE = 1000
    const todos: T[] = []
    for (let pagina = 0; ; pagina++) {
      const from = pagina * PAGE_SIZE
      const { data, error } = await supabase.rpc(fn, args).range(from, from + PAGE_SIZE - 1)
      if (error || !data?.length) break
      todos.push(...(data as T[]))
      if (data.length < PAGE_SIZE) break
    }
    return todos
  }

  // A janela quente (Supabase) so cobre ~90 dias; a RPC nunca deve pedir algo
  // mais antigo (linhas ja podadas), entao clampa o inicio. A fatia antiga
  // (ini < corte) vem do Contabo, reagregada em JS (mesmo padrao da page.tsx).
  const corte = limiteJanelaQuente()
  const iniRpc = ini < corte ? corte : ini

  const [detalheRaw, matrizRaw] = await Promise.all([
    rpcTodos<LinhaDetalhe>('relatorio_compras_detalhe', { p_loja_id: lojaId, p_ini: iniRpc, p_fim: fim, ...filtros }),
    rpcTodos<LinhaMatriz>('relatorio_compras_matriz', { p_loja_id: lojaId, p_ini: iniRpc, p_fim: fim, p_dim: dim, ...filtros }),
  ])

  if (ini < corte) {
    // O Supabase corta em 1000 linhas por padrao (sem erro) -- pagina ate esgotar
    // (achado real: lojas com >1000 produtos perdiam o resto do catalogo aqui).
    const prodMetaRaw: { codigo_produto: number; tipo_item: string | null; descricao_familia: string | null }[] = []
    for (let pg = 0; ; pg++) {
      const from = pg * 1000
      const { data } = await supabase
        .from('produtos')
        .select('codigo_produto, tipo_item, descricao_familia')
        .eq('loja_id', lojaId)
        .range(from, from + 999)
      if (!data?.length) break
      prodMetaRaw.push(...data)
      if (data.length < 1000) break
    }
    const meta: MetaProdutoNF = new Map()
    for (const p of prodMetaRaw) {
      meta.set(Number(p.codigo_produto), { tipo: p.tipo_item, familia: p.descricao_familia })
    }
    const corteExcl = new Date(Date.parse(corte) - 86400000).toISOString().slice(0, 10)
    // Achado real: se o período pedido termina antes do corte (fim < corteExcl —
    // ex.: um recorte todo dentro do histórico frio), usar corteExcl fixo aqui
    // buscava dado a mais no Contabo (até o corte, não até `fim`), inflando o
    // total. Trava no menor dos dois.
    const dataFinalFria = fim < corteExcl ? fim : corteExcl
    const itensFrios: ItemNFFrio[] = await buscarItensNFFrio({ lojaId, dataInicio: ini, dataFinal: dataFinalFria })
    const filtrados = filtrarItensCompras(itensFrios, {
      status, familias, tipos, fornecedor, cfops, produto, local: localCod,
    }, meta)
    detalheRaw.push(...mapearComprasDetalhe(filtrados, meta))
    matrizRaw.push(...agregarComprasMatriz(filtrados, dim, meta))
  }

  // Rótulo amigável conforme a dimensão (tipo -> nome do SPED; produto -> título limpo).
  const rotuloDe = (raw: string): string => {
    if (dim === 'tipo') return TIPO_LABEL.get(raw) ?? raw
    if (dim === 'produto') return formatarNomeProduto(raw) || raw
    return raw
  }

  // --- Aba "Resumo": matriz (linha = dimensão, coluna = mês), como o Ramon manda ---
  const matriz = matrizRaw
  const meses = [...new Set(matriz.map((m) => m.mes))].sort()
  const porRotulo = new Map<string, { total: number; meses: Record<string, number> }>()
  for (const r of matriz) {
    const ent = porRotulo.get(r.rotulo) ?? { total: 0, meses: {} }
    const v = Number(r.valor) || 0
    ent.meses[r.mes] = (ent.meses[r.mes] ?? 0) + v
    ent.total += v
    porRotulo.set(r.rotulo, ent)
  }
  const resumoRows = [...porRotulo.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([rotulo, ent]) => ({
      rotulo: rotuloDe(rotulo),
      ...Object.fromEntries(meses.map((m) => [m, Number((ent.meses[m] ?? 0).toFixed(2))])),
      total: Number(ent.total.toFixed(2)),
    }))

  const resumoColunas: ColunaExcel[] = [
    { key: 'rotulo', label: DIM_LABEL[dim], tipo: 'texto', largura: 32 },
    ...meses.map((m): ColunaExcel => ({ key: m, label: mesLabel(m), tipo: 'moeda', largura: 13, somar: true })),
    { key: 'total', label: 'Total', tipo: 'moeda', largura: 15, somar: true },
  ]

  // --- Aba "Detalhado": uma linha por item de NF, com AutoFiltro ---
  const detalheRows = detalheRaw.map((l) => ({
    data: fmtData(l.data),
    mes: l.mes ?? '',
    nota: l.nota ?? '',
    fornecedor: l.fornecedor ?? '',
    tipo: l.tipo ? TIPO_LABEL.get(l.tipo) ?? l.tipo : 'Sem classificação',
    familia: l.familia ?? 'Sem classificação',
    produto: formatarNomeProduto(l.produto) || l.produto || '',
    codigo: l.codigo ?? '',
    ncm: l.ncm ?? '',
    cfop: l.cfop ?? '',
    unidade: l.unidade ?? '',
    qtde: Number(l.qtde) || 0,
    preco_unit: Number(l.preco_unit) || 0,
    total: Number(Number(l.total).toFixed(2)) || 0,
  }))

  const detalheColunas: ColunaExcel[] = [
    { key: 'data', label: 'Data', tipo: 'texto', largura: 12 },
    { key: 'mes', label: 'Mês', tipo: 'texto', largura: 9 },
    { key: 'nota', label: 'NF', tipo: 'texto', largura: 12 },
    { key: 'fornecedor', label: 'Fornecedor', tipo: 'texto', largura: 30 },
    { key: 'tipo', label: 'Tipo', tipo: 'texto', largura: 22 },
    { key: 'familia', label: 'Família', tipo: 'texto', largura: 22 },
    { key: 'produto', label: 'Produto', tipo: 'texto', largura: 32 },
    { key: 'codigo', label: 'Código', tipo: 'texto', largura: 12 },
    { key: 'ncm', label: 'NCM', tipo: 'texto', largura: 12 },
    { key: 'cfop', label: 'CFOP', tipo: 'texto', largura: 10 },
    { key: 'unidade', label: 'Un', tipo: 'texto', largura: 7 },
    { key: 'qtde', label: 'Qtde', tipo: 'numero', largura: 10 },
    { key: 'preco_unit', label: 'Preço unit', tipo: 'moeda', largura: 12 },
    { key: 'total', label: 'Total', tipo: 'moeda', largura: 14, somar: true },
  ]

  const STATUS_LABEL: Record<string, string> = { CONCLUIDA: 'Concluída', MANIFESTADA: 'Manifestada', PENDENTE: 'Pendente', CANCELADA: 'Cancelada', TODAS: 'Todas' }
  const sub = `${ini} a ${fim} · Status: ${STATUS_LABEL[status] ?? status}${familias.length ? ` · Família: ${familias.join(', ')}` : ''}${tipos.length ? ` · Tipo: ${tipos.map((t) => TIPO_LABEL.get(t) ?? t).join(', ')}` : ''}${fornecedor ? ` · Fornecedor: ${fornecedor}` : ''}${cfops.length ? ` · CFOP: ${cfops.join(', ')}` : ''}${produto ? ` · Produto: ${produto}` : ''}${localCod !== null ? ` · Local: ${localCod}` : ''}`

  const buffer = await gerarPlanilhaMulti([
    {
      nome: `Resumo por ${DIM_LABEL[dim]}`,
      rows: resumoRows,
      colunas: resumoColunas,
      opts: { titulo: `Compras por ${DIM_LABEL[dim]} (mês a mês)`, subtitulo: sub },
    },
    {
      nome: 'Detalhado',
      rows: detalheRows,
      colunas: detalheColunas,
      opts: { titulo: 'Compras (detalhado)', subtitulo: sub, autoFiltro: true },
    },
  ])

  return planilhaResponse(`compras-${dim}-${ini}-a-${fim}.xlsx`, buffer)
}
