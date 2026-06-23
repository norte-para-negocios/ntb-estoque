import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { gerarPlanilha, planilhaResponse, type ColunaExcel } from '@/lib/excel'

export const dynamic = 'force-dynamic'

type Row = { codigo: string; descricao: string | null; familia: string | null; mes: string; pdv: number | null; cmc: number | null; margem: number | null }
const margemValida = (m: number | null): m is number => m != null && m > -100

export async function GET() {
  const lojaId = await getCurrentLojaId()
  if (!(await getAtorGestao()).podeGerir) return new Response('Sem permissão', { status: 403 })

  const supabase = createServiceClient()
  const { data } = await supabase.from('margem_importada').select('codigo, descricao, familia, mes, pdv, cmc, margem').eq('loja_id', lojaId)
  const rows = (data ?? []) as Row[]
  if (!rows.length) return new Response('Sem margem importada', { status: 404 })

  // Margem mais recente por produto.
  const porCod = new Map<string, Row>()
  for (const r of rows) {
    const cur = porCod.get(r.codigo)
    if (!cur || r.mes > cur.mes) porCod.set(r.codigo, r)
  }
  const produtos = [...porCod.values()].sort((a, b) => {
    const ma = margemValida(a.margem) ? Number(a.margem) : 99999
    const mb = margemValida(b.margem) ? Number(b.margem) : 99999
    return ma - mb
  })

  const colunas: ColunaExcel[] = [
    { key: 'familia', label: 'Família', tipo: 'texto', largura: 22 },
    { key: 'codigo', label: 'Código', tipo: 'texto' },
    { key: 'produto', label: 'Produto', tipo: 'texto', largura: 36 },
    { key: 'pdv', label: 'PDV (venda)', tipo: 'moeda' },
    { key: 'cmc', label: 'CMC (custo)', tipo: 'moeda' },
    { key: 'margem', label: 'Margem', tipo: 'texto' },
    { key: 'situacao', label: 'Situação', tipo: 'texto' },
  ]
  const planRows = produtos.map((p) => ({
    familia: p.familia ?? '',
    codigo: p.codigo,
    produto: p.descricao ?? p.codigo,
    pdv: p.pdv ?? 0,
    cmc: p.cmc ?? 0,
    margem: margemValida(p.margem) ? `${Number(p.margem).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '-',
    situacao: margemValida(p.margem) ? 'OK' : 'CMC inválido (revisar no Omie)',
  }))

  const buffer = await gerarPlanilha(planRows, colunas, {
    titulo: 'Margem por produto',
    subtitulo: 'Produto acabado / venda PDV — margem do Omie',
    autoFiltro: true,
  })
  return planilhaResponse('margem-por-produto', buffer)
}
