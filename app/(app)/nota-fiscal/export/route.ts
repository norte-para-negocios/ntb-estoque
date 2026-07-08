import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { escapeIlike, escapeIlikeOr } from '@/lib/utils-busca'
import { gerarPlanilha, planilhaResponse } from '@/lib/excel'
import { valoresMulti } from '@/components/ui-kit/filtros-utils'

function fmtData(d: string | null): string {
  if (!d) return '-'
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

function labelEtapa(etapa: string | null): string {
  return etapa === '60' ? 'Concluída' : 'Pendente'
}

export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Notas Fiscais'))) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const params = {
    data_inicio: searchParams.get('data_inicio') || undefined,
    data_final: searchParams.get('data_final') || undefined,
    num_nfe: searchParams.get('num_nfe') || undefined,
    fornecedor: searchParams.get('fornecedor') || undefined,
    status: searchParams.get('status') || undefined,
    tipo: searchParams.get('tipo') || undefined,
    produto: searchParams.get('produto') || undefined,
  }

  const supabase = await createClient()

  const { data: loja } = await supabase
    .from('lojas')
    .select('nome, nome_fantasia')
    .eq('id', lojaId)
    .single()

  const dataInicio =
    params.data_inicio || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
  const dataFinal = params.data_final || new Date().toISOString().split('T')[0]

  // Mesma lógica de filtro da page: resolve notaIds quando há filtro de tipo/produto.
  // tipo vem como lista separada por virgula (multi-select) na URL.
  const tiposArr = valoresMulti(params.tipo)
  let notaIdsFiltro: number[] | null = null
  if (tiposArr.length || params.produto) {
    if (tiposArr.length) {
      const { data: prodCodigos } = await supabase
        .from('produtos')
        .select('codigo_produto')
        .eq('loja_id', lojaId)
        .in('tipo_item', tiposArr)

      const codigos = (prodCodigos ?? []).map((p) => String(p.codigo_produto))

      if (codigos.length === 0) {
        notaIdsFiltro = [-1]
      } else {
        let itemQuery = supabase
          .from('nota_fiscal_items')
          .select('nota_fiscal_id')
          .eq('loja_id', lojaId)
          .in('produto_codigo', codigos)
        if (params.produto) {
          const p = escapeIlikeOr(params.produto)
          itemQuery = itemQuery.or(
            `c_descricao_produto.ilike.%${p}%,c_codigo_produto.ilike.%${p}%`,
          )
        }
        const { data: itemRows } = await itemQuery
        const notaIds = Array.from(
          new Set((itemRows ?? []).map((r) => r.nota_fiscal_id).filter((v) => v != null)),
        )
        notaIdsFiltro = notaIds.length ? notaIds : [-1]
      }
    } else if (params.produto) {
      const p = escapeIlikeOr(params.produto)
      const { data: itemRows } = await supabase
        .from('nota_fiscal_items')
        .select('nota_fiscal_id')
        .eq('loja_id', lojaId)
        .or(`c_descricao_produto.ilike.%${p}%,c_codigo_produto.ilike.%${p}%`)
      const notaIds = Array.from(
        new Set((itemRows ?? []).map((r) => r.nota_fiscal_id).filter((v) => v != null)),
      )
      notaIdsFiltro = notaIds.length ? notaIds : [-1]
    }
  }

  // Paginação interna (PostgREST limita a 1000 linhas) para não truncar a exportação.
  const PAGE_SIZE = 1000
  type Nota = {
    d_emissao_nfe: string | null
    c_numero_nfe: string | null
    c_razao_social: string | null
    c_nome: string | null
    n_valor_nfe: number | null
    c_etapa: string | null
  }
  const notas: Nota[] = []

  function buildQuery(from: number, to: number) {
    let q = supabase
      .from('notas_fiscais')
      .select('d_emissao_nfe, c_numero_nfe, c_razao_social, c_nome, n_valor_nfe, c_etapa')
      .eq('loja_id', lojaId)
      .gte('d_emissao_nfe', dataInicio)
      .lte('d_emissao_nfe', dataFinal)
      .is('deleted_at', null)
      .order('d_emissao_nfe', { ascending: false })
      .range(from, to)

    if (params.num_nfe) q = q.ilike('c_numero_nfe', `%${escapeIlike(params.num_nfe)}%`)
    if (params.fornecedor) q = q.ilike('c_nome', `%${escapeIlike(params.fornecedor)}%`)

    if (params.status === 'C') q = q.eq('c_etapa', '60')
    else if (params.status === 'P') q = q.neq('c_etapa', '60')

    if (notaIdsFiltro !== null) q = q.in('id', notaIdsFiltro)

    return q
  }

  for (let pagina = 0; ; pagina++) {
    const from = pagina * PAGE_SIZE
    const { data: bloco } = await buildQuery(from, from + PAGE_SIZE - 1)
    if (!bloco?.length) break
    notas.push(...(bloco as Nota[]))
    if (bloco.length < PAGE_SIZE) break
  }

  const rows = notas.map((n) => ({
    emissao: fmtData(n.d_emissao_nfe),
    nfe: n.c_numero_nfe ?? '-',
    fornecedor: n.c_razao_social || n.c_nome || '-',
    etapa: labelEtapa(n.c_etapa),
    valor: n.n_valor_nfe ?? 0,
  }))

  const periodo = `${fmtData(dataInicio)} a ${fmtData(dataFinal)}`
  const lojaNome = loja?.nome_fantasia || loja?.nome || ''
  const buffer = await gerarPlanilha(
    rows,
    [
      { key: 'emissao', label: 'Emissão', tipo: 'texto', largura: 12 },
      { key: 'nfe', label: 'NFe', tipo: 'texto', largura: 14 },
      { key: 'fornecedor', label: 'Fornecedor', tipo: 'texto' },
      { key: 'etapa', label: 'Etapa', tipo: 'texto', largura: 12 },
      { key: 'valor', label: 'Valor', tipo: 'moeda', largura: 16, somar: true },
    ],
    {
      titulo: 'Notas Fiscais',
      subtitulo: `${lojaNome} · Período: ${periodo}`,
    },
  )

  return planilhaResponse('notas-fiscais.xlsx', buffer)
}
