import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { gerarPlanilha, planilhaResponse, type ColunaExcel } from '@/lib/excel'
import { descreverCFOP } from '@/lib/cfop'

export const dynamic = 'force-dynamic'

type LinhaCFOP = { cfop_doc: string; cfop_entrada: string; itens: number; valor: number; credita_icms: number; move_estoque: number }

export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await getAtorGestao()).podeGerir) return new Response('Sem permissão', { status: 403 })

  const { searchParams } = new URL(request.url)
  const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const ini = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('data_inicio') ?? '') ? searchParams.get('data_inicio')! : `${hojeISO.slice(0, 4)}-01-01`
  const fim = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('data_final') ?? '') ? searchParams.get('data_final')! : hojeISO

  const supabase = createServiceClient()
  const { data } = await supabase.rpc('relatorio_auditoria_fiscal_cfop', { p_loja_id: lojaId, p_ini: ini, p_fim: fim })
  const linhas = (data ?? []) as LinhaCFOP[]
  if (!linhas.length) return new Response('Sem notas no período', { status: 404 })

  const totValor = linhas.reduce((s, l) => s + Number(l.valor), 0)
  const colunas: ColunaExcel[] = [
    { key: 'cfop', label: 'CFOP doc → entrada', tipo: 'texto', largura: 18 },
    { key: 'descricao', label: 'O que é (entrada)', tipo: 'texto', largura: 38 },
    { key: 'categoria', label: 'Categoria', tipo: 'texto', largura: 24 },
    { key: 'itens', label: 'Itens', tipo: 'numero', somar: true },
    { key: 'valor', label: 'Valor', tipo: 'moeda', somar: true },
    { key: 'pct', label: '%', tipo: 'texto' },
    { key: 'credita', label: 'Credita ICMS', tipo: 'numero', somar: true },
    { key: 'nao_estoca', label: 'Não estoca', tipo: 'numero', somar: true },
  ]
  const rows = linhas.map((l) => {
    const d = descreverCFOP(l.cfop_entrada)
    return {
      cfop: `${l.cfop_doc} → ${l.cfop_entrada}`,
      descricao: d.desc,
      categoria: d.cat,
      itens: Number(l.itens),
      valor: Number(l.valor),
      pct: totValor > 0 ? `${((Number(l.valor) / totValor) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '-',
      credita: Number(l.credita_icms),
      nao_estoca: Number(l.itens) - Number(l.move_estoque),
    }
  })

  const buffer = await gerarPlanilha(rows, colunas, {
    titulo: 'Auditoria fiscal — compras por CFOP',
    subtitulo: `Período ${ini} a ${fim}`,
    autoFiltro: true,
  })
  return planilhaResponse('auditoria-fiscal', buffer)
}
