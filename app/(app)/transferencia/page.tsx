import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeftRight, Pencil, FileText } from 'lucide-react'
import { NovaTransferencia } from '@/components/transferencia/NovaTransferencia'
import { AcoesTransferencia } from '@/components/transferencia/AcoesTransferencia'
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
import { btnClass } from '@/components/ui-kit/Button'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'

const POR_PAGINA = 50

export default async function TransferenciaPage({
  searchParams,
}: {
  searchParams: Promise<{
    data_inicio?: string
    data_final?: string
    familia?: string
    tipo?: string
    status?: string
    motivo?: string
    page?: string
  }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Transferencias - Ver'))) notFound()

  const supabase = await createClient()
  const podeCriar = await requirePermissao(lojaId, 'Transferencias - Criar')
  const podeExcluir = await requirePermissao(lojaId, 'Transferencias - Excluir')
  const podeEditar = await requirePermissao(lojaId, 'Transferencias - Editar')

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

  // Filtro de familia/tipo via produtos -> movimentos -> transferencia_id
  let idsFiltrados: number[] | null = null
  if (sp.familia || sp.tipo) {
    let prodQuery = supabase.from('produtos').select('codigo_produto').eq('loja_id', lojaId)
    if (sp.familia) prodQuery = prodQuery.eq('descricao_familia', sp.familia)
    if (sp.tipo) prodQuery = prodQuery.eq('tipo_item', sp.tipo)
    const { data: prods } = await prodQuery
    const codigos = [...new Set((prods ?? []).map((p) => p.codigo_produto).filter(Boolean))]

    if (codigos.length) {
      const { data: movs } = await supabase
        .from('movimentos')
        .select('transferencia_id')
        .eq('loja_id', lojaId)
        .in('id_prod', codigos)
        .not('transferencia_id', 'is', null)
      idsFiltrados = [
        ...new Set((movs ?? []).map((m) => m.transferencia_id).filter((v): v is number => v != null)),
      ]
    } else {
      idsFiltrados = []
    }
  }

  let query = supabase
    .from('transferencias')
    .select(
      'id, data, codigo_local_origem, codigo_local_destino, status, motivo, movimentos(count), movStatus:movimentos(status)'
    )
    .eq('loja_id', lojaId)
    .order('data', { ascending: false })

  if (sp.data_inicio) query = query.gte('data', sp.data_inicio)
  if (sp.data_final) query = query.lte('data', `${sp.data_final}T23:59:59`)
  // Status: C = concluída (Concluido no Omie); A = em aberto (qualquer outro).
  if (sp.status === 'C') query = query.eq('status', 'Concluido')
  else if (sp.status === 'A') query = query.neq('status', 'Concluido')
  // Motivo guarda o tipo do ajuste: TRF (transferência) ou TPQ (perda/quebra).
  if (sp.motivo === 'TRF' || sp.motivo === 'TPQ') query = query.eq('motivo', sp.motivo)
  if (idsFiltrados !== null) query = query.in('id', idsFiltrados.length ? idsFiltrados : [-1])
  query = query.range((page - 1) * POR_PAGINA, page * POR_PAGINA) // busca N+1 para detectar próxima

  const { data: transferenciasRaw } = await query
  const temProxima = (transferenciasRaw?.length ?? 0) > POR_PAGINA
  const transferencias = temProxima ? transferenciasRaw!.slice(0, POR_PAGINA) : transferenciasRaw

  // Locais ATIVOS para o seletor de criacao.
  const { data: locais } = await supabase
    .from('local_estoques')
    .select('codigo_local_estoque, descricao')
    .eq('loja_id', lojaId)
    .neq('inativo', 'S')
    .order('descricao')

  // TODOS os locais (incl. inativos) so para exibir o NOME no historico: uma
  // transferencia antiga de um local hoje inativo ainda deve mostrar o nome, nao
  // o codigo numerico.
  const { data: todosLocais } = await supabase
    .from('local_estoques')
    .select('codigo_local_estoque, descricao')
    .eq('loja_id', lojaId)

  const localMap = new Map((todosLocais ?? []).map((l) => [l.codigo_local_estoque, l.descricao]))

  function fmtData(d: string | null): string {
    if (!d) return ''
    return new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' })
  }

  const relatorioParams = new URLSearchParams()
  if (sp.data_inicio) relatorioParams.set('data_inicio', sp.data_inicio)
  if (sp.data_final) relatorioParams.set('data_final', sp.data_final)
  if (sp.familia) relatorioParams.set('familia', sp.familia)
  if (sp.tipo) relatorioParams.set('tipo', sp.tipo)
  const relatorioHref = `/transferencia/relatorio?${relatorioParams.toString()}`

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
        { value: 'C', label: 'Concluída' },
        { value: 'A', label: 'Em aberto' },
      ],
    },
    {
      tipo: 'select',
      nome: 'motivo',
      label: 'Motivo',
      opcoes: [
        { value: 'TRF', label: 'Transferência' },
        { value: 'TPQ', label: 'Perda / quebra' },
      ],
    },
  ]

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Transferências"
          icon={ArrowLeftRight}
          description="Movimentações entre locais de estoque"
          actions={
            <>
              <FiltrosGaveta
                basePath="/transferencia"
                campos={campos}
                defaults={{
                  data_inicio: sp.data_inicio ?? '',
                  data_final: sp.data_final ?? '',
                  familia: sp.familia ?? '',
                  tipo: sp.tipo ?? '',
                  status: sp.status ?? '',
                  motivo: sp.motivo ?? '',
                }}
                persistirEm="/transferencia"
              />
              <a
                href={relatorioHref}
                target="_blank"
                rel="noopener noreferrer"
                className={btnClass('outline')}
              >
                <FileText className="size-4" /> Relatório PDF
              </a>
              {podeCriar ? <NovaTransferencia locais={locais ?? []} /> : null}
            </>
          }
        />
        <ChipsStatus
          basePath="/transferencia"
          param="status"
          opcoes={[
            { value: '', label: 'Todas' },
            { value: 'A', label: 'Em aberto' },
            { value: 'C', label: 'Concluídas' },
          ]}
        />
        <ChipsFiltrosAtivos basePath="/transferencia" campos={campos} naoMostrar={['status']} persistirEm="/transferencia" />
      </ListaHeader>

      <Lista
        linhas={transferencias ?? []}
        chaveLinha={(t) => t.id}
        colunas={[
          {
            label: 'Estoque',
            primaria: true,
            render: (t) => {
              const origem = localMap.get(t.codigo_local_origem) || t.codigo_local_origem
              const destino = localMap.get(t.codigo_local_destino) || t.codigo_local_destino
              return (
                <span>
                  <span className="num text-text-muted">#{t.id}</span> {origem} {' → '} {destino}
                </span>
              )
            },
          },
          { label: 'Data', larguraDesktop: 'w-28', render: (t) => <span className="num text-text-muted">{fmtData(t.data)}</span> },
          {
            label: 'Integrados',
            alinhar: 'right',
            larguraDesktop: 'w-32',
            render: (t) => {
              const total = Array.isArray(t.movimentos) ? t.movimentos[0]?.count ?? 0 : 0
              const movStatus = Array.isArray(t.movStatus) ? t.movStatus : []
              const concluidos = movStatus.filter((m: { status: string | null }) => m.status === 'Concluido').length
              const temErro = movStatus.some((m: { status: string | null }) => m.status === 'Erro')
              if (t.status !== 'Concluido') return <span className="num text-text-muted">{total}</span>
              return (
                <span className={`num font-medium ${temErro ? 'text-err' : 'text-ok'}`}>
                  {concluidos}/{total}
                </span>
              )
            },
          },
          { label: 'Status', larguraDesktop: 'w-32', render: (t) => <StatusPill status={t.status} /> },
        ]}
        acao={(t) => {
          const movStatus = Array.isArray(t.movStatus) ? t.movStatus : []
          const temErro = movStatus.some((m: { status: string | null }) => m.status === 'Erro')
          const concluido = t.status === 'Concluido'
          const labelAcao = concluido || !podeEditar ? 'Ver' : 'Contar'
          return (
            <div className="flex items-center justify-end gap-2">
              <Link href={`/transferencia/${t.id}/contagem`} className={btnClass('outline')}>
                <Pencil className="size-4" /> {labelAcao}
              </Link>
              <AcoesTransferencia
                transferenciaId={t.id}
                temErro={temErro}
                podeExcluir={podeExcluir}
              />
            </div>
          )
        }}
        vazio={
          <EmptyState
            icon={ArrowLeftRight}
            title="Nenhuma transferência"
            hint="Crie uma nova para começar."
          />
        }
      />

      {(page > 1 || temProxima) && (
        <Paginacao basePath="/transferencia" page={page} temProxima={temProxima} />
      )}
    </div>
  )
}
