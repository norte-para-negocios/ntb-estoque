import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ClipboardList, Pencil, Printer, Download } from 'lucide-react'
import { NovoInventario } from '@/components/inventario/NovoInventario'
import { AcoesInventario } from '@/components/inventario/AcoesInventario'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { FiltrosGaveta } from '@/components/ui-kit/FiltrosGaveta'
import { ChipsFiltrosAtivos } from '@/components/ui-kit/ChipsFiltrosAtivos'
import { ChipsStatus } from '@/components/ui-kit/ChipsStatus'
import type { CampoFiltro } from '@/components/ui-kit/Filtros'
import { Lista } from '@/components/ui-kit/Lista'
import { StatusPill } from '@/components/ui-kit/StatusPill'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Paginacao } from '@/components/ui-kit/Paginacao'
import { btnClass, btnLinhaClass, RotuloAcao } from '@/components/ui-kit/Button'
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
    status?: string
    page?: string
  }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Inventarios - Ver'))) notFound()

  const supabase = await createClient()
  const podeCriar = await requirePermissao(lojaId, 'Inventarios - Criar')
  const podeExcluir = await requirePermissao(lojaId, 'Inventarios - Excluir')
  const podeEditar = await requirePermissao(lojaId, 'Inventarios - Editar')

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
      'id, data, codigo_local_estoque, status, finalizado, user_id, items:inventario_items(count), itensStatus:inventario_items(status)'
    )
    .eq('loja_id', lojaId)
    .order('data', { ascending: false })

  if (sp.data_inicio) query = query.gte('data', sp.data_inicio)
  if (sp.data_final) query = query.lte('data', `${sp.data_final}T23:59:59`)
  // Status: F = finalizado; A = em aberto (em contagem, ainda nao finalizado).
  if (sp.status === 'F') query = query.eq('status', 'Finalizado')
  else if (sp.status === 'A') query = query.neq('status', 'Finalizado')
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

  // Responsavel de cada inventario: user_id -> nome (tabela profiles). Operacao
  // multi-usuario precisa saber quem fez a contagem.
  const userIds = [...new Set((inventarios ?? []).map((i) => i.user_id).filter(Boolean))]
  const { data: profs } = userIds.length
    ? await supabase.from('profiles').select('id, name').in('id', userIds as string[])
    : { data: [] as { id: string; name: string | null }[] }
  const nomeMap = new Map((profs ?? []).map((p) => [p.id, p.name]))

  function fmtData(d: string | null): string {
    if (!d) return ''
    return new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' })
  }

  const campos: CampoFiltro[] = [
    { tipo: 'data', nome: 'data_inicio', label: 'Data inicial' },
    { tipo: 'data', nome: 'data_final', label: 'Data final' },
    {
      tipo: 'select',
      nome: 'familia',
      label: 'Família',
      opcoes: familias.map((f) => ({ value: f, label: f })),
    },
    { tipo: 'select', nome: 'tipo', label: 'Tipo de produto', opcoes: PRODUTO_TIPO_ITEM },
    {
      tipo: 'select',
      nome: 'status',
      label: 'Status',
      opcoes: [
        { value: 'F', label: 'Finalizado' },
        { value: 'A', label: 'Em aberto' },
      ],
    },
  ]

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Inventários"
          icon={ClipboardList}
          description="Contagens de estoque por local"
          actions={
            <>
              <FiltrosGaveta
                basePath="/inventario"
                campos={campos}
                defaults={{
                  data_inicio: sp.data_inicio ?? '',
                  data_final: sp.data_final ?? '',
                  status: sp.status ?? '',
                  familia: sp.familia ?? '',
                  tipo: sp.tipo ?? '',
                }}
                persistirEm="/inventario"
              />
              <a
                href={`/inventario/export?${new URLSearchParams(
                  Object.entries({ data_inicio: sp.data_inicio, data_final: sp.data_final, status: sp.status }).filter(
                    (e): e is [string, string] => Boolean(e[1]),
                  ),
                ).toString()}`}
                target="_blank"
                rel="noopener noreferrer"
                className={btnClass('outline')}
              >
                <Download className="size-4" /> Excel
              </a>
              {podeCriar ? <NovoInventario locais={locais ?? []} /> : null}
            </>
          }
        />
        <ChipsStatus
          basePath="/inventario"
          param="status"
          opcoes={[
            { value: '', label: 'Todos' },
            { value: 'A', label: 'Em aberto' },
            { value: 'F', label: 'Finalizados' },
          ]}
        />
        <ChipsFiltrosAtivos basePath="/inventario" campos={campos} naoMostrar={['status']} persistirEm="/inventario" />
      </ListaHeader>

      <Lista
        linhas={inventarios ?? []}
        chaveLinha={(inv) => inv.id}
        colunas={[
          {
            label: 'Local',
            primaria: true,
            render: (inv) => {
              const local = localMap.get(inv.codigo_local_estoque) || inv.codigo_local_estoque
              return (
                <span>
                  <span className="num text-text-muted">#{inv.id}</span> {local}
                </span>
              )
            },
          },
          { label: 'Data', larguraDesktop: 'w-28', render: (inv) => <span className="num text-text-muted">{fmtData(inv.data)}</span> },
          {
            label: 'Responsável',
            larguraDesktop: 'w-40',
            render: (inv) => <span className="truncate text-text-muted">{nomeMap.get(inv.user_id) || '-'}</span>,
          },
          {
            label: 'Integrados',
            alinhar: 'right',
            larguraDesktop: 'w-32',
            render: (inv) => {
              const total = Array.isArray(inv.items) ? inv.items[0]?.count ?? 0 : 0
              const itensStatus = Array.isArray(inv.itensStatus) ? inv.itensStatus : []
              const concluidos = itensStatus.filter((i: { status: string | null }) => i.status === 'Concluido').length
              const temErro = itensStatus.some((i: { status: string | null }) => i.status === 'Erro' || i.status === 'Sem CMC')
              if (inv.status !== 'Finalizado') return <span className="num text-text-muted">{total}</span>
              return (
                <span className={`num font-medium ${temErro ? 'text-err' : 'text-ok'}`}>
                  {concluidos}/{total}
                </span>
              )
            },
          },
          { label: 'Status', larguraDesktop: 'w-32', render: (inv) => <StatusPill status={inv.status} /> },
        ]}
        acao={(inv) => {
          const itensStatus = Array.isArray(inv.itensStatus) ? inv.itensStatus : []
          const temErro = itensStatus.some(
            (i: { status: string | null }) => i.status === 'Erro' || i.status === 'Sem CMC'
          )
          const finalizado = inv.status === 'Finalizado'
          const labelAcao = finalizado || !podeEditar ? 'Ver' : 'Contar'
          return (
            <div className="flex items-center justify-end gap-1 sm:gap-2">
              <Link
                href={`/inventario/${inv.id}/contagem`}
                className={btnLinhaClass('outline')}
                aria-label={labelAcao}
                title={labelAcao}
              >
                <Pencil className="size-4" /> <RotuloAcao>{labelAcao}</RotuloAcao>
              </Link>
              <a
                href={`/inventario/${inv.id}/imprimir`}
                target="_blank"
                rel="noopener noreferrer"
                className={btnLinhaClass('outline')}
                aria-label="Imprimir"
                title="Imprimir"
              >
                <Printer className="size-4" /> <RotuloAcao>Imprimir</RotuloAcao>
              </a>
              <AcoesInventario
                inventarioId={inv.id}
                temErro={temErro}
                podeExcluir={podeExcluir}
              />
            </div>
          )
        }}
        vazio={
          <EmptyState
            icon={ClipboardList}
            title="Nenhum inventário"
            hint="Crie um novo para começar a contagem."
          />
        }
      />

      {(page > 1 || temProxima) && (
        <Paginacao basePath="/inventario" page={page} temProxima={temProxima} />
      )}
    </div>
  )
}
