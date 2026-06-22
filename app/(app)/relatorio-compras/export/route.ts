import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { gerarPlanilhaMulti, planilhaResponse, type ColunaExcel } from '@/lib/excel'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { formatarNomeProduto } from '@/lib/formatar-nome'

const TIPO_LABEL = new Map(PRODUTO_TIPO_ITEM.map((t) => [t.value, t.label]))

// Abertura (dimensão) da aba Resumo, espelhando as planilhas do Ramon.
const DIM_LABEL: Record<string, string> = {
  familia: 'Família',
  fornecedor: 'Fornecedor',
  produto: 'Produto',
  tipo: 'Tipo',
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
  const familia = searchParams.get('familia') || null
  const tipo = searchParams.get('tipo') || null
  const fornecedor = searchParams.get('fornecedor') || null
  const filtros = { p_familia: familia, p_tipo: tipo, p_fornecedor: fornecedor }

  const supabase = await createClient()
  const [{ data: detalheRaw }, { data: matrizRaw }] = await Promise.all([
    supabase.rpc('relatorio_compras_detalhe', { p_loja_id: lojaId, p_ini: ini, p_fim: fim, ...filtros }),
    supabase.rpc('relatorio_compras_matriz', { p_loja_id: lojaId, p_ini: ini, p_fim: fim, p_dim: dim, ...filtros }),
  ])

  // Rótulo amigável conforme a dimensão (tipo -> nome do SPED; produto -> título limpo).
  const rotuloDe = (raw: string): string => {
    if (dim === 'tipo') return TIPO_LABEL.get(raw) ?? raw
    if (dim === 'produto') return formatarNomeProduto(raw) || raw
    return raw
  }

  // --- Aba "Resumo": matriz (linha = dimensão, coluna = mês), como o Ramon manda ---
  const matriz = (matrizRaw ?? []) as LinhaMatriz[]
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
  const detalheRows = ((detalheRaw ?? []) as LinhaDetalhe[]).map((l) => ({
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

  const sub = `${ini} a ${fim}${familia ? ` · Família: ${familia}` : ''}${tipo ? ` · Tipo: ${TIPO_LABEL.get(tipo) ?? tipo}` : ''}${fornecedor ? ` · Fornecedor: ${fornecedor}` : ''}`

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
