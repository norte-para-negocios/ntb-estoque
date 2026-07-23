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
import { btnClass, btnLinhaClass } from '@/components/ui-kit/Button'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { escapeIlikeOr } from '@/lib/utils-busca'
import { valoresMulti } from '@/components/ui-kit/filtros-utils'

const POR_PAGINA = 50

const COLUNAS_SORT = ['data', 'codigo_local_estoque', 'status'] as const
type ColSort = (typeof COLUNAS_SORT)[number]

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
    ord?: string
    dir?: string
    produto?: string
    local?: string
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
  const ordRaw = sp.ord ?? 'data'
  const ord: ColSort = (COLUNAS_SORT as readonly string[]).includes(ordRaw) ? (ordRaw as ColSort) : 'data'
  const dir = sp.dir === 'asc' ? 'asc' : 'desc'

  // Familias distintas para o select. Loja pode ter ~2000 produtos ativos, acima
  // do corte padrao de 1000 linhas do PostgREST - pagina com .range() ate esgotar
  // pra nao perder familias silenciosamente do filtro (mesmo achado das outras
  // buscas desta pagina).
  const produtosFamilia: { descricao_familia: string | null }[] = []
  {
    const PAGE_SIZE = 1000
    for (let pagina = 0; ; pagina++) {
      const from = pagina * PAGE_SIZE
      const { data: bloco } = await supabase
        .from('produtos')
        .select('descricao_familia')
        .eq('loja_id', lojaId)
        .not('descricao_familia', 'is', null)
        .order('codigo_produto')
        .range(from, from + PAGE_SIZE - 1)
      if (!bloco?.length) break
      produtosFamilia.push(...bloco)
      if (bloco.length < PAGE_SIZE) break
    }
  }

  const familias = [
    ...new Set(produtosFamilia.map((p) => p.descricao_familia).filter(Boolean)),
  ].sort() as string[]

  // Filtro de familia/tipo/produto via inventario_items -> inventario_id
  // PostgREST corta em 1000 linhas por padrao sem erro: uma loja chega a ~2000
  // produtos ativos, entao ambas as buscas abaixo paginam com .range() ate
  // esgotar - senao o filtro fica incompleto (perde inventarios silenciosamente).
  let idsFiltrados: number[] | null = null
  if (sp.familia || sp.tipo || sp.produto) {
    let codigosTipo: number[] | null = null
    if (sp.tipo) {
      const PAGE_SIZE = 1000
      const prods: { codigo_produto: number | null }[] = []
      for (let pagina = 0; ; pagina++) {
        const from = pagina * PAGE_SIZE
        const { data: bloco } = await supabase
          .from('produtos')
          .select('codigo_produto')
          .eq('loja_id', lojaId)
          .eq('tipo_item', sp.tipo)
          .order('codigo_produto')
          .range(from, from + PAGE_SIZE - 1)
        if (!bloco?.length) break
        prods.push(...bloco)
        if (bloco.length < PAGE_SIZE) break
      }
      codigosTipo = [
        ...new Set(prods.map((p) => p.codigo_produto).filter((v): v is number => v != null)),
      ]
    }

    if (codigosTipo !== null && codigosTipo.length === 0) {
      idsFiltrados = []
    } else {
      const PAGE_SIZE = 1000
      const items: { inventario_id: number | null }[] = []
      for (let pagina = 0; ; pagina++) {
        const from = pagina * PAGE_SIZE
        let itemQuery = supabase
          .from('inventario_items')
          .select('inventario_id')
          .eq('loja_id', lojaId)
        if (sp.familia) itemQuery = itemQuery.eq('produto_familia', sp.familia)
        if (codigosTipo !== null) itemQuery = itemQuery.in('produto_codigo_produto', codigosTipo)
        if (sp.produto) {
          const termo = escapeIlikeOr(sp.produto)
          itemQuery = itemQuery.or(`produto_descricao.ilike.%${termo}%,produto_codigo.ilike.%${termo}%`)
        }
        const { data: bloco } = await itemQuery.order('id').range(from, from + PAGE_SIZE - 1)
        if (!bloco?.length) break
        items.push(...bloco)
        if (bloco.length < PAGE_SIZE) break
      }
      idsFiltrados = [
        ...new Set(items.map((i) => i.inventario_id).filter((v): v is number => v != null)),
      ]
    }
  }

  // 'itensStatus' era um embed trazendo o status de CADA item (array), que o
  // PostgREST corta em 1000 linhas por inventario sem erro - inventarios com
  // mais itens que isso ficavam com "concluidos/temErro" incorretos, contando
  // so os 1000 primeiros. Trocado por embeds de count() (agregado no Postgres,
  // nao sofre o corte) filtrados por status via alias, igual 'items' já fazia.
  let query = supabase
    .from('inventarios')
    .select(
      'id, data, codigo_local_estoque, status, finalizado, user_id, items:inventario_items(count), concluidos:inventario_items(count), comErro:inventario_items(count)'
    )
    .eq('loja_id', lojaId)
    .filter('concluidos.status', 'eq', 'Concluido')
    .filter('comErro.status', 'in', '(Erro,Sem CMC)')
    .order(ord, { ascending: dir === 'asc' })

  if (sp.data_inicio) query = query.gte('data', sp.data_inicio)
  if (sp.data_final) query = query.lte('data', `${sp.data_final}T23:59:59`)
  // Status: F = finalizado; A = em aberto (em contagem, ainda nao finalizado).
  if (sp.status === 'F') query = query.eq('status', 'Finalizado')
  else if (sp.status === 'A') query = query.neq('status', 'Finalizado')
  if (idsFiltrados !== null) query = query.in('id', idsFiltrados.length ? idsFiltrados : [-1])
  // Local de estoque: coluna direta em inventarios (multi-select).
  const locaisArr = valoresMulti(sp.local)
    .map((v) => Number(v))
    .filter((n) => !Number.isNaN(n))
  if (locaisArr.length) query = query.in('codigo_local_estoque', locaisArr)
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

  // TODOS os locais (incl. inativos) pro filtro e pra exibir nome de inventário
  // antigo feito num local hoje inativo (mesmo padrão de transferencia).
  const { data: todosLocais } = await supabase
    .from('local_estoques')
    .select('codigo_local_estoque, descricao')
    .eq('loja_id', lojaId)

  const localMap = new Map((todosLocais ?? []).map((l) => [l.codigo_local_estoque, l.descricao]))

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

  // Mantem todos os searchParams existentes ao trocar a ordenacao (mesmo padrao de nota-fiscal/page.tsx).
  function buildSortHref(key: string, newDir: 'asc' | 'desc'): string {
    const params = new URLSearchParams()
    if (sp.data_inicio) params.set('data_inicio', sp.data_inicio)
    if (sp.data_final) params.set('data_final', sp.data_final)
    if (sp.familia) params.set('familia', sp.familia)
    if (sp.tipo) params.set('tipo', sp.tipo)
    if (sp.status) params.set('status', sp.status)
    params.set('ord', key)
    params.set('dir', newDir)
    return `/inventario?${params.toString()}`
  }

  const campos: CampoFiltro[] = [
    { tipo: 'data', nome: 'data_inicio', label: 'Data inicial' },
    { tipo: 'data', nome: 'data_final', label: 'Data final' },
    { tipo: 'texto', nome: 'produto', label: 'Produto (nome ou código)' },
    {
      tipo: 'multi-select',
      nome: 'local',
      label: 'Local de estoque',
      opcoes: (todosLocais ?? [])
        .slice()
        .sort((a, b) => (a.descricao ?? '').localeCompare(b.descricao ?? '', 'pt-BR'))
        .map((l) => ({ value: String(l.codigo_local_estoque), label: l.descricao ?? String(l.codigo_local_estoque) })),
    },
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
                  produto: sp.produto ?? '',
                  local: sp.local ?? '',
                }}
                persistirEm="/inventario"
              />
              <a
                href={`/inventario/export?${new URLSearchParams(
                  Object.entries({
                    data_inicio: sp.data_inicio,
                    data_final: sp.data_final,
                    status: sp.status,
                    familia: sp.familia,
                    tipo: sp.tipo,
                    produto: sp.produto,
                    local: sp.local,
                  }).filter((e): e is [string, string] => Boolean(e[1])),
                ).toString()}`}
                target="_blank"
                rel="noopener noreferrer"
                className={btnClass('outline')}
              >
                <Download className="size-4" /> Excel
              </a>
              {podeCriar ? <NovoInventario locais={locais ?? []} familias={familias} /> : null}
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
        sortAtual={ord}
        dirAtual={dir}
        sortHref={buildSortHref}
        colunas={[
          {
            label: 'Local',
            primaria: true,
            sort: 'codigo_local_estoque',
            render: (inv) => {
              const local = localMap.get(inv.codigo_local_estoque) || inv.codigo_local_estoque
              return (
                <span>
                  <span className="num text-text-muted">#{inv.id}</span> {local}
                </span>
              )
            },
          },
          { label: 'Data', larguraDesktop: 'w-28', sort: 'data', render: (inv) => <span className="num text-text-muted">{fmtData(inv.data)}</span> },
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
              const concluidos = Array.isArray(inv.concluidos) ? inv.concluidos[0]?.count ?? 0 : 0
              const comErro = Array.isArray(inv.comErro) ? inv.comErro[0]?.count ?? 0 : 0
              const temErro = comErro > 0
              if (inv.status !== 'Finalizado') return <span className="num text-text-muted">{total}</span>
              return (
                <span className={`num font-medium ${temErro ? 'text-err' : 'text-ok'}`}>
                  {concluidos}/{total}
                </span>
              )
            },
          },
          { label: 'Status', larguraDesktop: 'w-32', sort: 'status', render: (inv) => <StatusPill status={inv.status} /> },
        ]}
        acao={(inv) => {
          const comErro = Array.isArray(inv.comErro) ? inv.comErro[0]?.count ?? 0 : 0
          const temErro = comErro > 0
          const finalizado = inv.status === 'Finalizado'
          const labelAcao = finalizado || !podeEditar ? 'Ver' : 'Contar'
          return (
            <div className="flex items-center justify-end gap-1 2xl:gap-2">
              <Link
                href={`/inventario/${inv.id}/contagem`}
                className={btnLinhaClass('outline')}
                aria-label={labelAcao}
                title={labelAcao}
              >
                <Pencil className="size-4" />
              </Link>
              <a
                href={`/inventario/${inv.id}/imprimir`}
                target="_blank"
                rel="noopener noreferrer"
                className={btnLinhaClass('outline')}
                aria-label="Imprimir"
                title="Imprimir"
              >
                <Printer className="size-4" />
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
