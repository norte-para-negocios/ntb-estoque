import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { gerarPlanilha, planilhaResponse } from '@/lib/excel'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { formatarNomeProduto } from '@/lib/formatar-nome'

const TIPO_LABEL = new Map(PRODUTO_TIPO_ITEM.map((t) => [t.value, t.label]))

function fmtData(d: string | null): string {
  if (!d) return ''
  const [a, m, dia] = String(d).slice(0, 10).split('-')
  return `${dia}/${m}/${a}`
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
  const familia = searchParams.get('familia') || null
  const tipo = searchParams.get('tipo') || null
  const fornecedor = searchParams.get('fornecedor') || null

  const supabase = await createClient()
  const { data } = await supabase.rpc('relatorio_compras_detalhe', {
    p_loja_id: lojaId,
    p_ini: ini,
    p_fim: fim,
    p_familia: familia,
    p_tipo: tipo,
    p_fornecedor: fornecedor,
  })

  const rows = ((data ?? []) as LinhaDetalhe[]).map((l) => ({
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

  const buffer = await gerarPlanilha(
    rows,
    [
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
    ],
    {
      titulo: 'Compras (detalhado)',
      subtitulo: `${ini} a ${fim}${familia ? ` · Família: ${familia}` : ''}${tipo ? ` · Tipo: ${TIPO_LABEL.get(tipo) ?? tipo}` : ''}${fornecedor ? ` · Fornecedor: ${fornecedor}` : ''}`,
      autoFiltro: true,
    },
  )

  return planilhaResponse(`compras-detalhado-${ini}-a-${fim}.xlsx`, buffer)
}
