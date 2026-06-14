import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Printer } from 'lucide-react'
import { StatusPill } from '@/components/ui-kit/StatusPill'
import { ContagemInventario, type ItemContagem } from '@/components/inventario/ContagemInventario'

export default async function ContagemPage({ params }: { params: Promise<{ id: string }> }) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Inventarios - Ver'))) notFound()

  const { id } = await params
  const supabase = await createClient()

  const { data: inventario } = await supabase
    .from('inventarios')
    .select('id, data, codigo_local_estoque, status')
    .eq('id', id)
    .eq('loja_id', lojaId)
    .single()

  if (!inventario) notFound()

  const { data: itens } = await supabase
    .from('inventario_items')
    .select('id, produto_codigo, produto_descricao, produto_familia, quan, status')
    .eq('inventario_id', id)
    .order('id')

  const { data: local } = await supabase
    .from('local_estoques')
    .select('descricao')
    .eq('loja_id', lojaId)
    .eq('codigo_local_estoque', inventario.codigo_local_estoque)
    .maybeSingle()

  const finalizado = inventario.status === 'Finalizado'

  return (
    <div className="pb-4">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href="/inventario"
            className="mb-2 inline-flex items-center gap-1 text-[13px] text-text-muted transition-colors hover:text-text"
          >
            <ArrowLeft className="size-3.5" /> Voltar
          </Link>
          <h1 className="truncate text-lg font-semibold tracking-tight text-text">
            Inventário · {local?.descricao || inventario.codigo_local_estoque}
          </h1>
          <div className="mt-1 flex items-center gap-2">
            <span className="num text-[13px] text-text-muted">
              {new Date(inventario.data).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' })}
            </span>
            <StatusPill status={inventario.status} />
          </div>
        </div>
        <a
          href={`/inventario/${inventario.id}/imprimir`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text transition-colors hover:bg-surface-2"
        >
          <Printer className="size-4" /> Imprimir PDF
        </a>
      </div>

      <ContagemInventario
        inventarioId={inventario.id}
        itensIniciais={(itens ?? []) as ItemContagem[]}
        finalizado={finalizado}
      />
    </div>
  )
}
