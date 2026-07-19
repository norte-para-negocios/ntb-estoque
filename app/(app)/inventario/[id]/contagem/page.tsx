import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { Printer } from 'lucide-react'
import { StatusPill } from '@/components/ui-kit/StatusPill'
import { DetailHeader } from '@/components/ui-kit/DetailHeader'
import { ContagemInventario, type ItemContagem } from '@/components/inventario/ContagemInventario'
import { formatarNomeProduto } from '@/lib/formatar-nome'

export default async function ContagemPage({ params }: { params: Promise<{ id: string }> }) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Inventarios - Ver'))) notFound()
  const podeEditar = await requirePermissao(lojaId, 'Inventarios - Editar')

  const { id } = await params
  const supabase = await createClient()

  const { data: inventario } = await supabase
    .from('inventarios')
    .select('id, data, codigo_local_estoque, status, user_id')
    .eq('id', id)
    .eq('loja_id', lojaId)
    .single()

  if (!inventario) notFound()

  const { data: responsavel } = inventario.user_id
    ? await supabase.from('profiles').select('name').eq('id', inventario.user_id).maybeSingle()
    : { data: null }

  // PostgREST corta em 1000 linhas por padrao e sem erro: inventarios podem ter
  // mais itens que isso (uma loja chega a ~2000 produtos ativos), entao pagina
  // com .range() ate esgotar - senao a contagem perde itens silenciosamente.
  const itensRaw: {
    id: number
    produto_codigo: string
    produto_descricao: string
    produto_familia: string | null
    produto_codigo_produto: number
    quan: number | null
    status: string | null
  }[] = []
  const PAGE_SIZE = 1000
  for (let pagina = 0; ; pagina++) {
    const from = pagina * PAGE_SIZE
    const { data: bloco } = await supabase
      .from('inventario_items')
      .select('id, produto_codigo, produto_descricao, produto_familia, produto_codigo_produto, quan, status')
      .eq('inventario_id', id)
      .order('id')
      .range(from, from + PAGE_SIZE - 1)
    if (!bloco?.length) break
    itensRaw.push(...bloco)
    if (bloco.length < PAGE_SIZE) break
  }

  const codigos = [...new Set((itensRaw ?? []).map((i) => i.produto_codigo_produto).filter(Boolean))]
  const { data: prods } = codigos.length
    ? await supabase
        .from('produtos')
        .select('codigo_produto, unidade')
        .eq('loja_id', lojaId)
        .in('codigo_produto', codigos)
    : { data: [] }
  const unidadeMap = new Map((prods ?? []).map((p) => [p.codigo_produto, p.unidade]))

  const itens = (itensRaw ?? []).map((i) => ({
    ...i,
    produto_descricao: formatarNomeProduto(i.produto_descricao),
    unidade: unidadeMap.get(i.produto_codigo_produto) ?? null,
  }))

  const { data: local } = await supabase
    .from('local_estoques')
    .select('descricao')
    .eq('loja_id', lojaId)
    .eq('codigo_local_estoque', inventario.codigo_local_estoque)
    .maybeSingle()

  const finalizado = inventario.status === 'Finalizado'

  const tituloInv = `Inventário · ${local?.descricao || inventario.codigo_local_estoque}`

  return (
    <div className="pb-4">
      <DetailHeader
        href="/inventario"
        title={tituloInv}
        breadcrumb={[
          { label: 'Inventários', href: '/inventario' },
          { label: tituloInv },
        ]}
        meta={
          <>
            <span className="num text-[13px] text-text-muted">
              {new Date(inventario.data).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' })}
            </span>
            <StatusPill status={inventario.status} />
            {responsavel?.name && (
              <span className="text-[13px] text-text-muted">por {responsavel.name}</span>
            )}
          </>
        }
        actions={
          <a
            href={`/inventario/${inventario.id}/imprimir`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text transition-colors hover:bg-surface-2"
          >
            <Printer className="size-4" /> Imprimir PDF
          </a>
        }
      />

      <ContagemInventario
        inventarioId={inventario.id}
        itensIniciais={(itens ?? []) as ItemContagem[]}
        finalizado={finalizado}
        podeEditar={podeEditar}
      />
    </div>
  )
}
