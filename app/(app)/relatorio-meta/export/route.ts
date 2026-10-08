import { createServiceClient } from '@/lib/supabase/server'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { carregarFaturamentoDiario } from '@/lib/faturamento-diario'
import { gerarPlanilhaMulti, planilhaResponse } from '@/lib/excel'

export const dynamic = 'force-dynamic'
const ISO = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: Request) {
  if (!(await getAtorGestao()).podeGerir) return new Response('Sem permissão', { status: 403 })
  const lojaId = await getCurrentLojaId()
  const hoje = hojeBahiaISO()
  const { searchParams } = new URL(request.url)
  const di = searchParams.get('data_inicio') ?? ''
  const df = searchParams.get('data_final') ?? ''
  const ini = ISO.test(di) && di <= hoje ? di : `${hoje.slice(0, 8)}01`
  const fim = ISO.test(df) && df >= ini ? (df > hoje ? hoje : df) : hoje

  const supabase = createServiceClient()
  const { data: metaRow } = await supabase.from('metas_faturamento').select('valor_diario').eq('loja_id', lojaId).maybeSingle()
  if (metaRow?.valor_diario == null) return new Response('Meta diária não cadastrada', { status: 404 })
  const meta = Number(metaRow.valor_diario)

  const { dias, aviso } = await carregarFaturamentoDiario(lojaId, ini, fim)
  const rows = dias.map((d) => ({
    dia: d.dia.split('-').reverse().join('/'),
    valor: d.valor,
    meta,
    dif: Math.round((d.valor - meta) * 100) / 100,
    situacao: d.dia === hoje ? 'Em andamento' : d.valor >= meta ? 'Bateu' : 'Não bateu',
  }))
  const buffer = await gerarPlanilhaMulti([{
    rows,
    colunas: [
      { key: 'dia', label: 'Dia', tipo: 'texto', largura: 14 },
      { key: 'valor', label: 'Faturamento', tipo: 'moeda', largura: 18, somar: true },
      { key: 'meta', label: 'Meta', tipo: 'moeda', largura: 16 },
      { key: 'dif', label: 'Diferença', tipo: 'moeda', largura: 16 },
      { key: 'situacao', label: 'Situação', tipo: 'texto', largura: 16 },
    ],
    opts: { titulo: 'Meta de faturamento', subtitulo: `${ini} a ${fim} · meta diária ${meta}${aviso ? ` · ATENÇÃO: ${aviso}` : ''}` },
    nome: 'Dia a dia',
  }])
  return planilhaResponse('meta-faturamento', buffer)
}
