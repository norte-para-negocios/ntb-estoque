import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { fmtData, fmtDataParam } from '@/lib/pdf-utils'
import { RelatorioInventarioPDF, type RelatorioInventarioItem } from '@/components/relatorio/RelatorioInventarioPDF'
import { PdfErro } from '@/components/relatorio/PdfChrome'
import { valoresMulti } from '@/components/ui-kit/filtros-utils'
import { labelTipoItem } from '@/lib/constants-omie'
import { escapeIlikeOr } from '@/lib/utils-busca'

async function pdfErroResponse(titulo: string, mensagem: string) {
  const el = createElement(PdfErro, { titulo, mensagem }) as Parameters<typeof renderToBuffer>[0]
  const buf = await renderToBuffer(el)
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="erro.pdf"' },
  })
}

export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Inventarios - Ver'))) {
    return pdfErroResponse('Sem permissão', 'Você não tem permissão para acessar este relatório.')
  }

  const { searchParams } = new URL(request.url)
  const dataInicio = searchParams.get('data_inicio') || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
  const dataFinal = searchParams.get('data_final') || new Date().toISOString().split('T')[0]
  const familia = searchParams.get('familia') || ''
  const tipo = searchParams.get('tipo') || ''
  const produto = searchParams.get('produto') || ''
  const status = searchParams.get('status') || ''
  const locaisArr = valoresMulti(searchParams.get('local') || undefined).map(Number).filter((n) => !Number.isNaN(n))

  const supabase = await createClient()

  const { data: loja } = await supabase.from('lojas').select('nome, nome_fantasia').eq('id', lojaId).single()
  const nomeLoja = loja?.nome_fantasia || loja?.nome || 'Loja'

  const { data: locais } = await supabase.from('local_estoques').select('codigo_local_estoque, descricao').eq('loja_id', lojaId)
  const localMap = new Map((locais ?? []).map((l) => [l.codigo_local_estoque, l.descricao]))

  // Filtro familia/tipo/produto -> inventario_items -> inventario_id (direto, sem hop de
  // movimentos/Contabo -- inventario_items ja tem produto_familia/produto_codigo_produto
  // proprios, ver inventario/export/route.ts:38-88).
  let idsFiltrados: number[] | null = null
  if (familia || tipo || produto) {
    let codigosTipo: number[] | null = null
    if (tipo) {
      const prods: { codigo_produto: number | null }[] = []
      for (let from = 0; ; from += 1000) {
        const { data: bloco } = await supabase.from('produtos').select('codigo_produto').eq('loja_id', lojaId).eq('tipo_item', tipo).order('codigo_produto').range(from, from + 999)
        if (!bloco?.length) break
        prods.push(...bloco)
        if (bloco.length < 1000) break
      }
      codigosTipo = [...new Set(prods.map((p) => p.codigo_produto).filter((v): v is number => v != null))]
    }
    if (codigosTipo !== null && codigosTipo.length === 0) {
      idsFiltrados = []
    } else {
      const items: { inventario_id: number | null }[] = []
      for (let from = 0; ; from += 1000) {
        let q = supabase.from('inventario_items').select('inventario_id').eq('loja_id', lojaId)
        if (familia) q = q.eq('produto_familia', familia)
        if (codigosTipo !== null) q = q.in('produto_codigo_produto', codigosTipo)
        if (produto) {
          const termo = escapeIlikeOr(produto)
          q = q.or(`produto_descricao.ilike.%${termo}%,produto_codigo.ilike.%${termo}%`)
        }
        const { data: bloco } = await q.order('id').range(from, from + 999)
        if (!bloco?.length) break
        items.push(...bloco)
        if (bloco.length < 1000) break
      }
      idsFiltrados = [...new Set(items.map((i) => i.inventario_id).filter((v): v is number => v != null))]
    }
  }

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
      .gte('data', dataInicio)
      .lte('data', `${dataFinal}T23:59:59`)
      .order('data', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)
    if (idsFiltrados !== null) q = q.in('id', idsFiltrados.length ? idsFiltrados : [-1])
    if (status === 'F') q = q.eq('status', 'Finalizado')
    else if (status === 'A') q = q.neq('status', 'Finalizado')
    if (locaisArr.length) q = q.in('codigo_local_estoque', locaisArr)
    return q
  }
  for (let pagina = 0; ; pagina++) {
    const from = pagina * 1000
    const { data: bloco } = await buildQuery(from, from + 999)
    if (!bloco?.length) break
    invRaw.push(...(bloco as unknown as Linha[]))
    if (bloco.length < 1000) break
  }

  const userIds = [...new Set(invRaw.map((i) => i.user_id).filter(Boolean))]
  const { data: profs } = userIds.length
    ? await supabase.from('profiles').select('id, name').in('id', userIds as string[])
    : { data: [] as { id: string; name: string | null }[] }
  const nomeMap = new Map((profs ?? []).map((p) => [p.id, p.name]))

  const itens: RelatorioInventarioItem[] = invRaw.map((inv) => ({
    num: `#${inv.id}`,
    local: String(localMap.get(inv.codigo_local_estoque ?? -1) || inv.codigo_local_estoque || '-'),
    data: fmtData(inv.data),
    responsavel: nomeMap.get(inv.user_id ?? '') || '-',
    itens: Array.isArray(inv.items) ? inv.items[0]?.count ?? 0 : 0,
    status: inv.status || '-',
  }))

  const filtrosAtivos: string[] = []
  if (familia) filtrosAtivos.push(`Família: ${familia}`)
  if (tipo) filtrosAtivos.push(`Tipo: ${labelTipoItem(tipo)}`)
  if (produto) filtrosAtivos.push(`Produto: ${produto}`)
  if (locaisArr.length) filtrosAtivos.push(`Local: ${locaisArr.map((c) => localMap.get(c) || String(c)).join(', ')}`)
  if (status === 'F') filtrosAtivos.push('Status: Finalizado')
  else if (status === 'A') filtrosAtivos.push('Status: Em aberto')

  const periodo = `${fmtDataParam(dataInicio)} a ${fmtDataParam(dataFinal)}`
  const nomeArquivo = `relatorio-inventarios-${nomeLoja.replace(/\s+/g, '-').toLowerCase()}-${dataInicio}-${dataFinal}.pdf`

  const element = createElement(RelatorioInventarioPDF, {
    loja: nomeLoja,
    periodo,
    filtros: filtrosAtivos.length ? filtrosAtivos.join(', ') : undefined,
    inventarios: itens,
  }) as Parameters<typeof renderToBuffer>[0]
  const buffer = await renderToBuffer(element)

  return new NextResponse(new Uint8Array(buffer), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${nomeArquivo}"` },
  })
}
