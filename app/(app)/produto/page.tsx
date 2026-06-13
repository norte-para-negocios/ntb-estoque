import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { SyncButton } from '@/components/SyncButton'
import { Package, ArrowLeft, Search } from 'lucide-react'

function fmtMoeda(v: number | null): string {
  return (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default async function ProdutoPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produtos'))) notFound()

  const params = await searchParams
  const supabase = await createClient()
  const podeSync = await requirePermissao(lojaId, 'Produtos - Sincronizar')

  let query = supabase
    .from('produtos')
    .select('id, codigo, descricao, descricao_familia, tipo_item, unidade, valor_unitario')
    .eq('loja_id', lojaId)
    .order('descricao')
    .limit(100)

  if (params.q) query = query.or(`descricao.ilike.%${params.q}%,codigo.ilike.%${params.q}%`)

  const { data: produtos } = await query

  return (
    <div className="space-y-4">
      {/* Título estilo original: voltar + ícone + nome */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href="/home" className="text-[#8a8a8a] hover:text-[#5d5d5d]" title="Voltar">
            <ArrowLeft className="size-5" strokeWidth={2} />
          </Link>
          <Package className="size-5 text-[#2eb5c3]" strokeWidth={2} />
          <h1 className="text-lg font-semibold text-[#5d5d5d]">Produtos</h1>
        </div>
        {podeSync && <SyncButton endpoint="/api/sync/produtos" label="Sincronizar" />}
      </div>

      {/* Busca (fiel ao formulário do original) */}
      <div className="ntb-card">
        <div className="ntb-card-body">
          <form method="GET" action="/produto" className="flex items-end gap-2">
            <input
              type="search"
              name="q"
              defaultValue={params.q ?? ''}
              placeholder="Pesquisar por nome ou código"
              className="ntb-input"
            />
            <button type="submit" className="ntb-btn-success shrink-0">
              <Search className="size-4" /> Pesquisar
            </button>
          </form>
        </div>
      </div>

      {/* Lista de cards empilhados (fiel ao original) */}
      <div className="space-y-4">
        {produtos?.length ? (
          produtos.map((p) => (
            <div key={p.id} className="ntb-card">
              <div className="ntb-card-header flex items-center justify-between">
                <span>{p.codigo || '-'}</span>
                <span className="text-sm font-normal text-white/90">{fmtMoeda(p.valor_unitario)}</span>
              </div>
              <div className="ntb-card-body">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <small className="text-[#8a8a8a]">Descrição</small>
                    <p className="font-semibold text-[#5d5d5d]">{p.descricao}</p>
                  </div>
                  <div className="flex shrink-0 gap-8">
                    <div>
                      <small className="text-[#8a8a8a]">Família</small>
                      <p className="text-[#5d5d5d]">{p.descricao_familia || '-'}</p>
                    </div>
                    <div>
                      <small className="text-[#8a8a8a]">Unidade</small>
                      <p className="text-[#5d5d5d]">{p.unidade || '-'}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="ntb-card">
            <div className="ntb-card-body text-center text-[#8a8a8a]">
              Nenhum produto. Sincronize com o Omie ou ajuste a busca.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
