import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { escapeIlike, escapeIlikeOr } from '@/lib/utils-busca'
import { gerarPlanilha, planilhaResponse } from '@/lib/excel'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { valoresMulti } from '@/components/ui-kit/filtros-utils'
import { complementarOrdensProducao, limiteJanelaQuente } from '@/lib/historico-contabo'

function fmtData(d: string | null): string {
  if (!d) return '-'
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Ordens de Producao'))) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }

  const supabase = await createClient()
  const { searchParams } = new URL(request.url)
  const sp = {
    data_inicio: searchParams.get('data_inicio') || undefined,
    data_final: searchParams.get('data_final') || undefined,
    ordem_producao: searchParams.get('ordem_producao') || undefined,
    op_produto: searchParams.get('op_produto') || undefined,
    tipo_produto: searchParams.get('tipo_produto') || undefined,
    familia: searchParams.get('familia') || undefined,
    op_concluido: searchParams.get('op_concluido') || undefined,
  }

  const filtraConclusao = sp.op_concluido === 'S' || sp.op_concluido === 'N'

  // Mesma lógica da page: cruza via produtos para obter os codigo_produto.
  // tipo_produto/familia vem da URL como lista separada por vírgula (multi-select).
  const tiposProdutoArr = valoresMulti(sp.tipo_produto)
  const familiasArr = valoresMulti(sp.familia)
  let codigosFiltro: number[] | null = null
  if (sp.op_produto || tiposProdutoArr.length || familiasArr.length) {
    let prodQuery = supabase
      .from('produtos')
      .select('codigo_produto')
      .eq('loja_id', lojaId)
    if (sp.op_produto) {
      const termo = escapeIlikeOr(sp.op_produto)
      prodQuery = prodQuery.or(`codigo.ilike.%${termo}%,descricao.ilike.%${termo}%`)
    }
    if (tiposProdutoArr.length) prodQuery = prodQuery.in('tipo_item', tiposProdutoArr)
    if (familiasArr.length) prodQuery = prodQuery.in('descricao_familia', familiasArr)
    const { data: prods } = await prodQuery
    codigosFiltro = [
      ...new Set((prods ?? []).map((p) => p.codigo_produto).filter((v): v is number => v != null)),
    ]
  }

  // Paginação interna para não truncar a exportação (PostgREST limita 1000 linhas).
  const PAGE_SIZE = 1000
  type Ordem = {
    id: number
    num_ordem: string | null
    identificacao_c_num_op: string | null
    identificacao_n_cod_produto: number | null
    identificacao_n_qtde: number | null
    validade: string | null
    concluida: boolean | null
  }
  const ordensRaw: Ordem[] = []

  function buildQuery(from: number, to: number) {
    let q = supabase
      .from('ordens_producao')
      .select(
        'id, num_ordem, identificacao_c_num_op, identificacao_n_cod_produto, identificacao_n_qtde, validade, concluida',
      )
      .eq('loja_id', lojaId)
      .order('updated_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)

    if (filtraConclusao) q = q.eq('concluida', sp.op_concluido === 'S')
    if (sp.data_inicio) q = q.gte('identificacao_d_dt_previsao', sp.data_inicio)
    if (sp.data_final) q = q.lte('identificacao_d_dt_previsao', sp.data_final)
    if (sp.ordem_producao) {
      q = q.ilike('identificacao_c_num_op', `%${escapeIlike(sp.ordem_producao)}%`)
    }
    if (codigosFiltro !== null) {
      q = q.in('identificacao_n_cod_produto', codigosFiltro.length ? codigosFiltro : [-1])
    }
    return q
  }

  for (let pagina = 0; ; pagina++) {
    const from = pagina * PAGE_SIZE
    const { data: bloco } = await buildQuery(from, from + PAGE_SIZE - 1)
    if (!bloco?.length) break
    ordensRaw.push(...(bloco as Ordem[]))
    if (bloco.length < PAGE_SIZE) break
  }

  const ordens = (!sp.data_inicio || sp.data_inicio < limiteJanelaQuente())
    ? await complementarOrdensProducao(ordensRaw, { lojaId, dataInicio: sp.data_inicio, dataFinal: sp.data_final })
    : ordensRaw

  // Mesmo join da page: resolve descrição do produto.
  const codigos = [...new Set(ordens.map((o) => o.identificacao_n_cod_produto).filter(Boolean))]
  const { data: produtos } = codigos.length
    ? await supabase
        .from('produtos')
        .select('codigo_produto, descricao')
        .eq('loja_id', lojaId)
        .in('codigo_produto', codigos)
    : { data: [] }

  const prodMap = new Map((produtos ?? []).map((p) => [p.codigo_produto, p]))

  const rows = ordens.map((op) => {
    const prod = prodMap.get(op.identificacao_n_cod_produto as number)
    return {
      op: op.identificacao_c_num_op || op.num_ordem || '-',
      produto: formatarNomeProduto(prod?.descricao) || `Produto ${op.identificacao_n_cod_produto}`,
      qtd: op.identificacao_n_qtde ?? 0,
      validade: op.validade ? fmtData(op.validade) : '-',
      status: op.concluida ? 'Concluída' : 'Pendente',
    }
  })

  const buffer = await gerarPlanilha(
    rows,
    [
      { key: 'op', label: 'OP', tipo: 'texto', largura: 16 },
      { key: 'produto', label: 'Produto', tipo: 'texto' },
      { key: 'qtd', label: 'Qtd', tipo: 'numero', largura: 12 },
      { key: 'validade', label: 'Validade', tipo: 'texto', largura: 14 },
      { key: 'status', label: 'Status', tipo: 'texto', largura: 14 },
    ],
    { titulo: 'Ordens de Produção' },
  )

  return planilhaResponse('ordens-producao.xlsx', buffer)
}
