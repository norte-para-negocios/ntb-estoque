import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ClipboardList, Pencil } from 'lucide-react'
import { NovoInventario } from '@/components/inventario/NovoInventario'
import { AcoesInventario } from '@/components/inventario/AcoesInventario'

export default async function InventarioPage() {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Inventarios - Ver'))) notFound()

  const supabase = await createClient()
  const podeCriar = await requirePermissao(lojaId, 'Inventarios - Criar')
  const podeExcluir = await requirePermissao(lojaId, 'Inventarios - Excluir')

  const { data: inventarios } = await supabase
    .from('inventarios')
    .select(
      'id, data, codigo_local_estoque, status, finalizado, items:inventario_items(count), itensStatus:inventario_items(status)'
    )
    .eq('loja_id', lojaId)
    .order('data', { ascending: false })
    .limit(50)

  const { data: locais } = await supabase
    .from('local_estoques')
    .select('codigo_local_estoque, descricao')
    .eq('loja_id', lojaId)
    .neq('inativo', 'S')
    .order('descricao')

  const localMap = new Map((locais ?? []).map((l) => [l.codigo_local_estoque, l.descricao]))

  function fmtData(d: string | null): string {
    if (!d) return ''
    return new Date(d).toLocaleDateString('pt-BR')
  }

  return (
    <div className="space-y-4">
      {/* Título estilo original: voltar + ícone + nome */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href="/home" className="text-[#8a8a8a] hover:text-[#5d5d5d]" title="Voltar">
            <ArrowLeft className="size-5" strokeWidth={2} />
          </Link>
          <ClipboardList className="size-5 text-[#2eb5c3]" strokeWidth={2} />
          <h1 className="text-lg font-semibold text-[#5d5d5d]">Inventários</h1>
        </div>
        {podeCriar && <NovoInventario locais={locais ?? []} />}
      </div>

      {/* Lista de cards empilhados (fiel ao original) */}
      <div className="space-y-4">
        {inventarios?.length ? (
          inventarios.map((inv) => {
            const count = Array.isArray(inv.items) ? inv.items[0]?.count ?? 0 : 0
            const itensStatus = Array.isArray(inv.itensStatus) ? inv.itensStatus : []
            const temErro = itensStatus.some(
              (i: { status: string | null }) => i.status === 'Erro' || i.status === 'Sem CMC'
            )
            const finalizado = inv.status === 'Finalizado'
            const local = localMap.get(inv.codigo_local_estoque) || inv.codigo_local_estoque
            return (
              <div key={inv.id}>
                <span className="text-sm text-[#8a8a8a]">Data: {fmtData(inv.data)}</span>
                <div className="ntb-card mt-1">
                  <div
                    className="flex items-center justify-between px-4 py-2 text-xs font-medium text-white"
                    style={{ backgroundColor: finalizado ? '#2eb5c3' : '#f24646' }}
                  >
                    <span>{inv.status}</span>
                    {inv.finalizado && <span>| {fmtData(inv.finalizado)}</span>}
                  </div>
                  <div className="ntb-card-body flex flex-wrap items-center gap-y-3">
                    <div className="w-1/4 min-w-[90px]">
                      <small className="text-[#8a8a8a]">Estoque</small>
                      <p className="font-semibold text-[#5d5d5d]">#{inv.id}</p>
                    </div>
                    <div className="w-1/4 min-w-[90px]">
                      <small className="text-[#8a8a8a]">Produtos</small>
                      <p className="font-semibold text-[#5d5d5d]">{count}</p>
                    </div>
                    <div className="w-1/2 min-w-[160px]">
                      <small className="text-[#8a8a8a]">Local</small>
                      <p className="truncate font-semibold text-[#5d5d5d]">{local}</p>
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      <Link href={`/inventario/${inv.id}/contagem`} className="ntb-btn-outline">
                        <Pencil className="size-4" /> {finalizado ? 'Ver' : 'Contar'}
                      </Link>
                      <AcoesInventario
                        inventarioId={inv.id}
                        temErro={temErro}
                        podeExcluir={podeExcluir}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )
          })
        ) : (
          <div className="ntb-card">
            <div className="ntb-card-body text-center text-[#8a8a8a]">
              Nenhum inventário. Crie um novo para começar a contagem.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
