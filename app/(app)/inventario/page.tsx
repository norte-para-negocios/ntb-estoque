import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ClipboardList, Pencil } from 'lucide-react'
import { NovoInventario } from '@/components/inventario/NovoInventario'
import { AcoesInventario } from '@/components/inventario/AcoesInventario'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { Filtros } from '@/components/ui-kit/Filtros'
import { DataTable } from '@/components/ui-kit/DataTable'
import { StatusPill } from '@/components/ui-kit/StatusPill'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Paginacao } from '@/components/ui-kit/Paginacao'
import { btnClass } from '@/components/ui-kit/Button'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'

const POR_PAGINA = 50

export default async function InventarioPage({
  searchParams,
}: {
  searchParams: Promise<{
    data_inicio?: string
    data_final?: string
    familia?: string
    tipo?: string
    page?: string
  }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Inventarios - Ver'))) notFound()

  const supabase = await createClient()
  const podeCriar = await requirePermissao(lojaId, 'Inventarios - Criar')
  const podeExcluir = await requirePermissao(lojaId, 'Inventarios - Excluir')

  const sp = await searchParams
  const page = Math.max(1, Number(sp.page) || 1)

  // Familias distintas para o select (melhor esforco)
  const { data: produtosFamilia } = await supabase
    .from('produtos')
    .select('descricao_familia')
    .eq('loja_id', lojaId)
    .not('descricao_familia', 'is', null)

  const familias = [
    ...new Set((produtosFamilia ?? []).map((p) => p.descricao_familia).filter(Boolean)),
  ].sort() as string[]

  // Filtro de familia/tipo via inventario_items -> inventario_id
  let idsFiltrados: number[] | null = null
  if (sp.familia || sp.tipo) {
    let codigosTipo: number[] | null = null
    if (sp.tipo) {
      const { data: prods } = await supabase
        .from('produtos')
        .select('codigo_produto')
        .eq('loja_id', lojaId)
        .eq('tipo_item', sp.tipo)
      codigosTipo = [...new Set((prods ?? []).map((p) => p.codigo_produto).filter(Boolean))]
    }

    if (codigosTipo !== null && codigosTipo.length === 0) {
      idsFiltrados = []
    } else {
      let itemQuery = supabase
        .from('inventario_items')
        .select('inventario_id')
        .eq('loja_id', lojaId)
      if (sp.familia) itemQuery = itemQuery.eq('produto_familia', sp.familia)
      if (codigosTipo !== null) itemQuery = itemQuery.in('produto_codigo_produto', codigosTipo)
      const { data: items } = await itemQuery
      idsFiltrados = [
        ...new Set((items ?? []).map((i) => i.inventario_id).filter((v): v is number => v != null)),
      ]
    }
  }

  let query = supabase
    .from('inventarios')
    .select(
      'id, data, codigo_local_estoque, status, finalizado, items:inventario_items(count), itensStatus:inventario_items(status)'
    )
    .eq('loja_id', lojaId)
    .order('data', { ascending: false })

  if (sp.data_inicio) query = query.gte('data', sp.data_inicio)
  if (sp.data_final) query = query.lte('data', `${sp.data_final}T23:59:59`)
  if (idsFiltrados !== null) query = query.in('id', idsFiltrados.length ? idsFiltrados : [-1])
  query = query.range((page - 1) * POR_PAGINA, page * POR_PAGINA) // busca N+1 para detectar próxima

  const { data: inventariosRaw } = await query
  const temProxima = (inventariosRaw?.length ?? 0) > POR_PAGINA
  const inventarios = temProxima ? inventariosRaw!.slice(0, POR_PAGINA) : inventariosRaw

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
    <div>
      <PageHeader
        title="Inventários"
        icon={ClipboardList}
        description="Contagens de estoque por local"
        actions={podeCriar ? <NovoInventario locais={locais ?? []} /> : undefined}
      />

      <Filtros
        basePath="/inventario"
        campos={[
          { tipo: 'data', nome: 'data_inicio', label: 'Data inicial' },
          { tipo: 'data', nome: 'data_final', label: 'Data final' },
          {
            tipo: 'select',
            nome: 'familia',
            label: 'Família',
            opcoes: familias.map((f) => ({ value: f, label: f })),
          },
          { tipo: 'select', nome: 'tipo', label: 'Tipo de produto', opcoes: PRODUTO_TIPO_ITEM },
        ]}
        defaults={{
          data_inicio: sp.data_inicio ?? '',
          data_final: sp.data_final ?? '',
          familia: sp.familia ?? '',
          tipo: sp.tipo ?? '',
        }}
      />

      {inventarios?.length ? (
        <DataTable>
          <thead>
            <tr>
              <th>Estoque</th>
              <th>Data</th>
              <th>Local</th>
              <th className="text-right">Produtos</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {inventarios.map((inv) => {
              const count = Array.isArray(inv.items) ? inv.items[0]?.count ?? 0 : 0
              const itensStatus = Array.isArray(inv.itensStatus) ? inv.itensStatus : []
              const temErro = itensStatus.some(
                (i: { status: string | null }) => i.status === 'Erro' || i.status === 'Sem CMC'
              )
              const finalizado = inv.status === 'Finalizado'
              const local = localMap.get(inv.codigo_local_estoque) || inv.codigo_local_estoque
              return (
                <tr key={inv.id}>
                  <td className="num font-medium text-text">#{inv.id}</td>
                  <td className="num text-text-muted">{fmtData(inv.data)}</td>
                  <td className="max-w-xs truncate text-text">{local}</td>
                  <td className="text-right">
                    <span className="num">{count}</span>
                  </td>
                  <td>
                    <StatusPill status={inv.status} />
                  </td>
                  <td>
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/inventario/${inv.id}/contagem`}
                        className={btnClass('outline')}
                      >
                        <Pencil className="size-4" /> {finalizado ? 'Ver' : 'Contar'}
                      </Link>
                      <AcoesInventario
                        inventarioId={inv.id}
                        temErro={temErro}
                        podeExcluir={podeExcluir}
                      />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </DataTable>
      ) : (
        <EmptyState
          icon={ClipboardList}
          title="Nenhum inventário"
          hint="Crie um novo para começar a contagem."
        />
      )}

      {(page > 1 || temProxima) && (
        <Paginacao basePath="/inventario" page={page} temProxima={temProxima} />
      )}
    </div>
  )
}
