import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { gerarPlanilhaMulti, planilhaResponse, abaMatrizMensal, type AbaPlanilha, type ColunaExcel } from '@/lib/excel'
import { formatarNomeProduto } from '@/lib/formatar-nome'

export const dynamic = 'force-dynamic'

type Qtd = { rotulo: string; mes: string; qtde: number }
type LinhaOper = { origem: string; sentido: 'E' | 'S'; local: string; tipo_sped: string; familia: string; mes: string; inventario: boolean; qtde: number; valor: number }

const valorConfiavel = (origem: string, sentido: 'E' | 'S') => !(/pdv/i.test(origem) && sentido === 'S')

export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await getAtorGestao()).podeGerir) return new Response('Sem permissão', { status: 403 })

  const { searchParams } = new URL(request.url)
  const supabase = createServiceClient()

  // ---------- Export do modo "Por operação" (BD do MOV_DRV) ----------
  if (searchParams.get('modo') === 'operacao') {
    const op = searchParams.get('op') || ''
    const loc = searchParams.get('loc') || ''
    const sent = searchParams.get('sent') === 'E' ? 'E' : searchParams.get('sent') === 'S' ? 'S' : ''
    const dim = searchParams.get('dim') === 'local' ? 'local' : searchParams.get('dim') === 'tipo_sped' ? 'tipo_sped' : 'familia'

    const rows: LinhaOper[] = []
    for (let p = 0; ; p++) {
      const { data, error } = await supabase
        .from('movimentacao_operacao')
        .select('origem, sentido, local, tipo_sped, familia, mes, inventario, qtde, valor')
        .eq('loja_id', lojaId)
        .order('valor', { ascending: false })
        .range(p * 1000, p * 1000 + 999)
      if (error || !data?.length) break
      rows.push(...(data as LinhaOper[]))
      if (data.length < 1000) break
    }
    if (!rows.length) return new Response('Sem movimentação por operação importada', { status: 404 })

    const abas: AbaPlanilha[] = []

    // Aba 1: Por operação (origem × sentido), respeitando filtro de local.
    const baseLocal = loc ? rows.filter((r) => r.local === loc) : rows
    const porOper = new Map<string, { origem: string; sentido: string; qtde: number; valor: number; conf: boolean }>()
    for (const r of baseLocal) {
      const k = `${r.origem}|${r.sentido}`
      const e = porOper.get(k) ?? { origem: r.origem, sentido: r.sentido === 'E' ? 'Entrada' : 'Saída', qtde: 0, valor: 0, conf: valorConfiavel(r.origem, r.sentido) }
      e.qtde += Number(r.qtde); e.valor += Number(r.valor)
      porOper.set(k, e)
    }
    const colsOper: ColunaExcel[] = [
      { key: 'origem', label: 'Operação', tipo: 'texto' },
      { key: 'sentido', label: 'Sentido', tipo: 'texto' },
      { key: 'qtde', label: 'Quantidade', tipo: 'numero', somar: true },
      { key: 'valor', label: 'Valor (R$)', tipo: 'moeda', somar: true },
    ]
    const rowsOper = [...porOper.values()]
      .sort((a, b) => (b.conf ? b.valor : 0) - (a.conf ? a.valor : 0))
      .map((o) => ({ origem: o.origem, sentido: o.sentido, qtde: o.qtde, valor: o.conf ? o.valor : 0 }))
    abas.push({ rows: rowsOper, colunas: colsOper, opts: { titulo: 'Movimentação por operação', subtitulo: loc ? `Local: ${loc}` : 'Todos os locais', autoFiltro: true }, nome: 'Por operação' })

    // Aba 2: Perdas reais (manual saída, fora inventário) por família e mês.
    const perdas = rows.filter((r) => r.origem === 'Movimento Manual de Estoque' && r.sentido === 'S' && !r.inventario)
      .map((r) => ({ rotulo: r.familia || 'N/D', mes: r.mes, valor: Number(r.valor) }))
    if (perdas.length) abas.push(abaMatrizMensal({ titulo: 'Perdas reais (baixa manual) por família', dimLabel: 'Família', linhas: perdas, nome: 'Perdas (R$)' }))

    // Aba 3: matriz da dimensão escolhida, com os filtros aplicados (PDV-saída = 0).
    const filtradas = rows.filter((r) => (!op || r.origem === op) && (!loc || r.local === loc) && (!sent || r.sentido === sent))
    const soPdvSaida = filtradas.length > 0 && filtradas.every((r) => !valorConfiavel(r.origem, r.sentido))
    const linhasDim = filtradas.map((r) => ({
      rotulo: (dim === 'local' ? r.local : dim === 'tipo_sped' ? r.tipo_sped : r.familia) || 'N/D',
      mes: r.mes,
      valor: soPdvSaida ? Number(r.qtde) : (valorConfiavel(r.origem, r.sentido) ? Number(r.valor) : 0),
    }))
    const dimLabel = dim === 'local' ? 'Local' : dim === 'tipo_sped' ? 'Tipo (SPED)' : 'Família'
    const recorte = [op || 'Todas as operações', loc || 'Todos os locais', sent === 'E' ? 'Entrada' : sent === 'S' ? 'Saída' : 'Entrada+Saída'].join(' · ')
    if (linhasDim.length) {
      abas.push(abaMatrizMensal({
        titulo: `Matriz por ${dimLabel.toLowerCase()} (${soPdvSaida ? 'quantidade' : 'R$'})`,
        dimLabel, linhas: linhasDim, subtitulo: recorte, nome: `Por ${dimLabel.toLowerCase()}`, moeda: !soPdvSaida,
      }))
    }

    if (!abas.length) return new Response('Sem dados no recorte', { status: 404 })
    const buffer = await gerarPlanilhaMulti(abas)
    return planilhaResponse('movimentacao-operacao', buffer)
  }

  // ---------- Export do modo "Em quantidade" (dado nativo) ----------
  const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const ini = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('data_inicio') ?? '') ? searchParams.get('data_inicio')! : `${hojeISO.slice(0, 4)}-01-01`
  const fim = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('data_final') ?? '') ? searchParams.get('data_final')! : hojeISO

  async function rpcTodos<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
    const PAGE = 1000
    const todos: T[] = []
    for (let p = 0; ; p++) {
      const { data, error } = await supabase.rpc(fn, args).range(p * PAGE, p * PAGE + PAGE - 1)
      if (error || !data?.length) break
      todos.push(...(data as T[]))
      if (data.length < PAGE) break
    }
    return todos
  }

  const abas: AbaPlanilha[] = []
  for (const [sentido, nome, label] of [
    ['saidas', 'Saídas por produto', 'Saídas (consumo/venda)'],
    ['entradas', 'Entradas por produto', 'Entradas'],
  ] as const) {
    const q = await rpcTodos<Qtd>('relatorio_movimentacao_matriz', { p_loja_id: lojaId, p_ini: ini, p_fim: fim, p_dim: 'produto', p_sentido: sentido })
    const linhas = q.map((r) => ({ rotulo: formatarNomeProduto(r.rotulo) || r.rotulo, mes: r.mes, valor: Number(r.qtde) || 0 }))
    if (linhas.length) abas.push(abaMatrizMensal({ titulo: `Movimentação — ${label} (quantidade)`, dimLabel: 'Produto', linhas, nome, moeda: false }))
  }

  if (!abas.length) return new Response('Sem movimentação no período', { status: 404 })
  const buffer = await gerarPlanilhaMulti(abas)
  return planilhaResponse('movimentacao', buffer)
}
