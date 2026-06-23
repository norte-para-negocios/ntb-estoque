import { NextResponse } from 'next/server'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { escapeIlikeOr } from '@/lib/utils-busca'
import { labelTipoItem } from '@/lib/constants-omie'
import { gerarPlanilha, planilhaResponse } from '@/lib/excel'

export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produtos'))) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }

  const supabase = await createClient()
  const { searchParams } = new URL(request.url)
  const params = {
    q: searchParams.get('q') || undefined,
    familia: searchParams.get('familia') || undefined,
    tipo: searchParams.get('tipo') || undefined,
    situacao: searchParams.get('situacao') || undefined,
    fornecedor: searchParams.get('fornecedor') || undefined,
  }

  // Filtro por fornecedor: códigos que a loja já comprou daquele fornecedor (NF).
  let codigosFornecedor: number[] | null = null
  if (params.fornecedor) {
    const { data } = await supabase.rpc('compras_produtos_do_fornecedor', {
      p_loja_id: lojaId,
      p_fornecedor: params.fornecedor,
    })
    codigosFornecedor = ((data ?? []) as { cod: number }[]).map((r) => Number(r.cod))
  }

  // Paginação interna para não truncar a exportação (PostgREST limita 1000 linhas).
  const PAGE_SIZE = 1000
  type Produto = {
    codigo: string | null
    descricao: string | null
    descricao_familia: string | null
    tipo_item: string | null
    unidade: string | null
    valor_unitario: number | null
  }
  const produtos: Produto[] = []

  function buildQuery(from: number, to: number) {
    let q = supabase
      .from('produtos')
      .select('codigo, descricao, descricao_familia, tipo_item, unidade, valor_unitario')
      .eq('loja_id', lojaId)
      .order('descricao')
      .range(from, to)

    if (params.q) {
      const term = escapeIlikeOr(params.q)
      q = q.or(`descricao.ilike.%${term}%,codigo.ilike.%${term}%`)
    }
    if (params.familia) q = q.eq('descricao_familia', params.familia)
    if (params.tipo) q = q.eq('tipo_item', params.tipo)
    if (codigosFornecedor !== null) q = q.in('codigo_produto', codigosFornecedor.length ? codigosFornecedor : [-1])
    // Usa a coluna `inativo` (igual à tela de Produtos). Antes filtrava por
    // full_object->>inativo, que podia divergir da coluna → tela e Excel mostravam
    // conjuntos diferentes para o mesmo filtro.
    if (!params.situacao || params.situacao === 'ativos') q = q.eq('inativo', false)
    else if (params.situacao === 'inativos') q = q.eq('inativo', true)

    return q
  }

  for (let pagina = 0; ; pagina++) {
    const from = pagina * PAGE_SIZE
    const { data: bloco } = await buildQuery(from, from + PAGE_SIZE - 1)
    if (!bloco?.length) break
    produtos.push(...(bloco as Produto[]))
    if (bloco.length < PAGE_SIZE) break
  }

  const rows = produtos.map((p) => ({
    codigo: p.codigo || '-',
    descricao: formatarNomeProduto(p.descricao) || '-',
    familia: p.descricao_familia || '-',
    tipo: labelTipoItem(p.tipo_item),
    unidade: p.unidade || '-',
    valor: p.valor_unitario ?? 0,
  }))

  const buffer = await gerarPlanilha(
    rows,
    [
      { key: 'codigo', label: 'Código', tipo: 'texto', largura: 12 },
      { key: 'descricao', label: 'Descrição', tipo: 'texto' },
      { key: 'familia', label: 'Família', tipo: 'texto' },
      { key: 'tipo', label: 'Tipo', tipo: 'texto', largura: 18 },
      { key: 'unidade', label: 'Unidade', tipo: 'texto', largura: 10 },
      { key: 'valor', label: 'Valor', tipo: 'moeda', largura: 16 },
    ],
    { titulo: 'Produtos' },
  )

  return planilhaResponse('produtos.xlsx', buffer)
}
