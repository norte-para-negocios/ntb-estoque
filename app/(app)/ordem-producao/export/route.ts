import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { escapeIlike, escapeIlikeOr } from '@/lib/utils-busca'
import { toCsv, csvResponse } from '@/lib/csv'
import { formatarNomeProduto } from '@/lib/formatar-nome'

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
    op_concluido: searchParams.get('op_concluido') || undefined,
  }

  const filtraConclusao = sp.op_concluido === 'S' || sp.op_concluido === 'N'

  // Mesma lógica da page: cruza via produtos para obter os codigo_produto.
  let codigosFiltro: number[] | null = null
  if (sp.op_produto || sp.tipo_produto) {
    let prodQuery = supabase
      .from('produtos')
      .select('codigo_produto')
      .eq('loja_id', lojaId)
    if (sp.op_produto) {
      const termo = escapeIlikeOr(sp.op_produto)
      prodQuery = prodQuery.or(`codigo.ilike.%${termo}%,descricao.ilike.%${termo}%`)
    }
    if (sp.tipo_produto) prodQuery = prodQuery.eq('tipo_item', sp.tipo_produto)
    const { data: prods } = await prodQuery
    codigosFiltro = [
      ...new Set((prods ?? []).map((p) => p.codigo_produto).filter((v): v is number => v != null)),
    ]
  }

  // Paginação interna para não truncar a exportação (PostgREST limita 1000 linhas).
  const PAGE_SIZE = 1000
  type Ordem = {
    num_ordem: string | null
    identificacao_c_num_op: string | null
    identificacao_n_cod_produto: number | null
    identificacao_n_qtde: number | null
    validade: string | null
    adicionais_d_dt_conclusao: string | null
    full_object: unknown
  }
  const ordensRaw: Ordem[] = []

  function buildQuery(from: number, to: number) {
    let q = supabase
      .from('ordens_producao')
      .select(
        'num_ordem, identificacao_c_num_op, identificacao_n_cod_produto, identificacao_n_qtde, validade, adicionais_d_dt_conclusao, full_object',
      )
      .eq('loja_id', lojaId)
      .order('updated_at', { ascending: false })
      .range(from, to)

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

  function isConcluida(o: Ordem): boolean {
    if (o.adicionais_d_dt_conclusao) return true
    const fo = (o.full_object ?? {}) as { outrasInf?: { cConcluida?: string } }
    return fo.outrasInf?.cConcluida === 'S'
  }

  let ordens = ordensRaw
  if (filtraConclusao) {
    const querConcluida = sp.op_concluido === 'S'
    ordens = ordensRaw.filter((o) => isConcluida(o) === querConcluida)
  }

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
      qtd: op.identificacao_n_qtde ?? '',
      validade: op.validade ?? '-',
    }
  })

  const csv = toCsv(rows, [
    { key: 'op', label: 'OP' },
    { key: 'produto', label: 'Produto' },
    { key: 'qtd', label: 'Qtd' },
    { key: 'validade', label: 'Validade' },
  ])

  return csvResponse('ordens-producao.csv', csv)
}
