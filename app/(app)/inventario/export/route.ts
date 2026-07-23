import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { gerarPlanilha, planilhaResponse } from '@/lib/excel'
import { valoresMulti } from '@/components/ui-kit/filtros-utils'
import { escapeIlikeOr } from '@/lib/utils-busca'

function fmtData(d: string | null): string {
  if (!d) return '-'
  return new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' })
}

export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Inventarios - Ver'))) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }

  const supabase = await createClient()
  const { searchParams } = new URL(request.url)
  const dataInicio = searchParams.get('data_inicio') || undefined
  const dataFinal = searchParams.get('data_final') || undefined
  const status = searchParams.get('status') || undefined
  const familia = searchParams.get('familia') || undefined
  const tipo = searchParams.get('tipo') || undefined
  const produto = searchParams.get('produto') || undefined
  const locaisArr = valoresMulti(searchParams.get('local') || undefined)
    .map((v) => Number(v))
    .filter((n) => !Number.isNaN(n))

  // BUG corrigido (auditoria 2026-07-22): este export ignorava TOTALMENTE
  // família/tipo/produto (nem os parâmetros eram lidos) - o href da tela
  // tambem so repassava data/status. O arquivo Excel baixado sempre saia com
  // todos os inventarios do periodo, mesmo com esses filtros ativos na tela
  // (confirmado ao vivo: export com e sem familia devolvia bytes identicos).
  // Mesma logica de produtos -> inventario_items -> inventario_id ja usada em
  // page.tsx.
  let idsFiltrados: number[] | null = null
  if (familia || tipo || produto) {
    let codigosTipo: number[] | null = null
    if (tipo) {
      const PAGE_SIZE_PROD = 1000
      const prods: { codigo_produto: number | null }[] = []
      for (let pagina = 0; ; pagina++) {
        const from = pagina * PAGE_SIZE_PROD
        const { data: bloco } = await supabase
          .from('produtos')
          .select('codigo_produto')
          .eq('loja_id', lojaId)
          .eq('tipo_item', tipo)
          .order('codigo_produto')
          .range(from, from + PAGE_SIZE_PROD - 1)
        if (!bloco?.length) break
        prods.push(...bloco)
        if (bloco.length < PAGE_SIZE_PROD) break
      }
      codigosTipo = [
        ...new Set(prods.map((p) => p.codigo_produto).filter((v): v is number => v != null)),
      ]
    }

    if (codigosTipo !== null && codigosTipo.length === 0) {
      idsFiltrados = []
    } else {
      const PAGE_SIZE_ITEMS = 1000
      const items: { inventario_id: number | null }[] = []
      for (let pagina = 0; ; pagina++) {
        const from = pagina * PAGE_SIZE_ITEMS
        let itemQuery = supabase
          .from('inventario_items')
          .select('inventario_id')
          .eq('loja_id', lojaId)
        if (familia) itemQuery = itemQuery.eq('produto_familia', familia)
        if (codigosTipo !== null) itemQuery = itemQuery.in('produto_codigo_produto', codigosTipo)
        if (produto) {
          const termo = escapeIlikeOr(produto)
          itemQuery = itemQuery.or(`produto_descricao.ilike.%${termo}%,produto_codigo.ilike.%${termo}%`)
        }
        const { data: bloco } = await itemQuery.order('id').range(from, from + PAGE_SIZE_ITEMS - 1)
        if (!bloco?.length) break
        items.push(...bloco)
        if (bloco.length < PAGE_SIZE_ITEMS) break
      }
      idsFiltrados = [
        ...new Set(items.map((i) => i.inventario_id).filter((v): v is number => v != null)),
      ]
    }
  }

  const PAGE_SIZE = 1000
  type Linha = {
    id: number
    data: string | null
    codigo_local_estoque: number | null
    status: string | null
    user_id: string | null
    items: { count: number }[] | null
  }
  const invRaw: Linha[] = []

  function buildQuery(from: number, to: number) {
    let q = supabase
      .from('inventarios')
      .select('id, data, codigo_local_estoque, status, user_id, items:inventario_items(count)')
      .eq('loja_id', lojaId)
      // desempate por PK: paginar por 'data' (não-única) pulava/duplicava linhas
      .order('data', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)
    if (dataInicio) q = q.gte('data', dataInicio)
    if (dataFinal) q = q.lte('data', `${dataFinal}T23:59:59`)
    if (status === 'F') q = q.eq('status', 'Finalizado')
    else if (status === 'A') q = q.neq('status', 'Finalizado')
    if (idsFiltrados !== null) q = q.in('id', idsFiltrados.length ? idsFiltrados : [-1])
    if (locaisArr.length) q = q.in('codigo_local_estoque', locaisArr)
    return q
  }

  for (let pagina = 0; ; pagina++) {
    const from = pagina * PAGE_SIZE
    const { data: bloco } = await buildQuery(from, from + PAGE_SIZE - 1)
    if (!bloco?.length) break
    invRaw.push(...(bloco as unknown as Linha[]))
    if (bloco.length < PAGE_SIZE) break
  }

  const { data: locais } = await supabase
    .from('local_estoques')
    .select('codigo_local_estoque, descricao')
    .eq('loja_id', lojaId)
  const localMap = new Map((locais ?? []).map((l) => [l.codigo_local_estoque, l.descricao]))

  const userIds = [...new Set(invRaw.map((i) => i.user_id).filter(Boolean))]
  const { data: profs } = userIds.length
    ? await supabase.from('profiles').select('id, name').in('id', userIds as string[])
    : { data: [] as { id: string; name: string | null }[] }
  const nomeMap = new Map((profs ?? []).map((p) => [p.id, p.name]))

  const rows = invRaw.map((inv) => ({
    num: `#${inv.id}`,
    local: String(localMap.get(inv.codigo_local_estoque ?? -1) || inv.codigo_local_estoque || '-'),
    data: fmtData(inv.data),
    responsavel: nomeMap.get(inv.user_id ?? '') || '-',
    itens: Array.isArray(inv.items) ? inv.items[0]?.count ?? 0 : 0,
    status: inv.status || '-',
  }))

  const buffer = await gerarPlanilha(
    rows,
    [
      { key: 'num', label: 'Inventário', tipo: 'texto', largura: 14 },
      { key: 'local', label: 'Local', tipo: 'texto', largura: 22 },
      { key: 'data', label: 'Data', tipo: 'texto', largura: 14 },
      { key: 'responsavel', label: 'Responsável', tipo: 'texto', largura: 22 },
      { key: 'itens', label: 'Itens', tipo: 'numero', largura: 10 },
      { key: 'status', label: 'Status', tipo: 'texto', largura: 14 },
    ],
    { titulo: 'Inventários' },
  )

  return planilhaResponse('inventarios.xlsx', buffer)
}
