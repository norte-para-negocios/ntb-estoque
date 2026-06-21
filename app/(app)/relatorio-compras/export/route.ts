import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { gerarPlanilha, planilhaResponse } from '@/lib/excel'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { formatarNomeProduto } from '@/lib/formatar-nome'

const DIM_LABEL: Record<string, string> = {
  familia: 'Família',
  fornecedor: 'Fornecedor',
  produto: 'Produto',
  tipo: 'Tipo',
}
const TIPO_LABEL = new Map(PRODUTO_TIPO_ITEM.map((t) => [t.value, t.label]))

export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await getAtorGestao()).podeGerir) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const dim = DIM_LABEL[searchParams.get('dim') ?? ''] ? (searchParams.get('dim') as string) : 'familia'
  const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const ini = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('data_inicio') ?? '')
    ? (searchParams.get('data_inicio') as string)
    : `${hojeISO.slice(0, 4)}-01-01`
  const fim = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('data_final') ?? '')
    ? (searchParams.get('data_final') as string)
    : hojeISO

  const supabase = await createClient()
  const { data } = await supabase.rpc('relatorio_compras_dim', {
    p_loja_id: lojaId,
    p_ini: ini,
    p_fim: fim,
    p_dim: dim,
  })
  const linhas = ((data ?? []) as { rotulo: string; valor: number; itens: number }[]).map((l) => ({
    ...l,
    valor: Number(l.valor),
  }))
  const total = linhas.reduce((s, l) => s + l.valor, 0)

  const rotuloDe = (rotulo: string): string => {
    if (dim === 'tipo') return TIPO_LABEL.get(rotulo) ?? rotulo
    if (dim === 'produto') return formatarNomeProduto(rotulo) || rotulo
    return rotulo
  }

  const rows = linhas.map((l) => ({
    rotulo: rotuloDe(l.rotulo),
    itens: l.itens,
    percentual: total > 0 ? Number(((l.valor / total) * 100).toFixed(1)) : 0,
    valor: Number(l.valor.toFixed(2)),
  }))

  const buffer = await gerarPlanilha(
    rows,
    [
      { key: 'rotulo', label: DIM_LABEL[dim], tipo: 'texto', largura: 36 },
      { key: 'itens', label: 'Itens', tipo: 'numero', largura: 10 },
      { key: 'percentual', label: '% do total', tipo: 'numero', largura: 12 },
      { key: 'valor', label: 'Comprado (R$)', tipo: 'numero', largura: 16 },
    ],
    { titulo: `Compras por ${DIM_LABEL[dim]} · ${ini} a ${fim}` },
  )

  return planilhaResponse(`compras-${dim}-${ini}-a-${fim}.xlsx`, buffer)
}
