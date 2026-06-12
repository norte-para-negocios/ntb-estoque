import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
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
    <div className="space-y-6">
      <div>
        <Link href="/inventario" className="text-sm text-blue-600 hover:underline">
          ← Voltar
        </Link>
        <h1 className="text-2xl font-bold mt-1">
          Inventario · {local?.descricao || inventario.codigo_local_estoque}
        </h1>
        <p className="text-sm text-gray-500">
          {new Date(inventario.data).toLocaleDateString('pt-BR')} · {inventario.status}
        </p>
      </div>

      <ContagemInventario
        inventarioId={inventario.id}
        itensIniciais={(itens ?? []) as ItemContagem[]}
        finalizado={finalizado}
      />
    </div>
  )
}
