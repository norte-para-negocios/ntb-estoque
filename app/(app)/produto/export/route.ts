import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { escapeIlikeOr } from '@/lib/utils-busca'
import { labelTipoItem } from '@/lib/constants-omie'
import { toCsv, csvResponse } from '@/lib/csv'

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
    descricao: p.descricao ?? '-',
    familia: p.descricao_familia || '-',
    tipo: labelTipoItem(p.tipo_item),
    unidade: p.unidade || '-',
    valor: p.valor_unitario ?? 0,
  }))

  const csv = toCsv(rows, [
    { key: 'codigo', label: 'Código' },
    { key: 'descricao', label: 'Descrição' },
    { key: 'familia', label: 'Família' },
    { key: 'tipo', label: 'Tipo' },
    { key: 'unidade', label: 'Unidade' },
    { key: 'valor', label: 'Valor' },
  ])

  return csvResponse('produtos.csv', csv)
}
