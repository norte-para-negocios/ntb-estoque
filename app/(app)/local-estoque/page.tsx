import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { SyncButton } from '@/components/SyncButton'
import { BuscaSimples } from '@/components/BuscaSimples'
import { Warehouse, ArrowLeft } from 'lucide-react'

export default async function LocalEstoquePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Locais de Estoque'))) notFound()

  const params = await searchParams
  const supabase = await createClient()
  const podeSync = await requirePermissao(lojaId, 'Locais de Estoque - Sincronizar')

  let query = supabase
    .from('local_estoques')
    .select('id, codigo_local_estoque, codigo, descricao, inativo')
    .eq('loja_id', lojaId)
    .order('descricao')
    .limit(200)

  if (params.q) query = query.ilike('descricao', `%${params.q}%`)

  const { data: locais } = await query

  return (
    <div className="space-y-4">
      {/* Título estilo original: voltar + ícone + nome */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href="/home" className="text-[#8a8a8a] hover:text-[#5d5d5d]" title="Voltar">
            <ArrowLeft className="size-5" strokeWidth={2} />
          </Link>
          <Warehouse className="size-5 text-[#2eb5c3]" strokeWidth={2} />
          <h1 className="text-lg font-semibold text-[#5d5d5d]">Locais de Estoque</h1>
        </div>
        {podeSync && <SyncButton endpoint="/api/sync/locais" label="Sincronizar com Omie" />}
      </div>

      <BuscaSimples
        basePath="/local-estoque"
        placeholder="Buscar local..."
        defaultValue={params.q ?? ''}
      />

      {/* Lista de cards empilhados (fiel ao original) */}
      <div className="space-y-4">
        {locais?.length ? (
          locais.map((l) => (
            <div key={l.id} className="ntb-card">
              <div className="ntb-card-header flex items-center justify-between">
                <span>{l.descricao || '-'}</span>
                <span className="text-sm font-normal text-white/90">
                  {l.inativo === 'S' ? 'Inativo' : 'Ativo'}
                </span>
              </div>
              <div className="ntb-card-body flex flex-wrap items-center gap-x-8 gap-y-2">
                <div>
                  <small className="text-[#8a8a8a]">Codigo Local Estoque</small>
                  <p className="font-semibold text-[#5d5d5d]">{l.codigo_local_estoque || '-'}</p>
                </div>
                <div>
                  <small className="text-[#8a8a8a]">Codigo</small>
                  <p className="font-semibold text-[#5d5d5d]">{l.codigo || '-'}</p>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="ntb-card">
            <div className="ntb-card-body text-center text-[#8a8a8a]">
              Nenhum local de estoque. Sincronize com o Omie.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
