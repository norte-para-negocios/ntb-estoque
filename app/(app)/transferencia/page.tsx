import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeftRight, Pencil, FileText, Download } from 'lucide-react'
import { NovaTransferencia } from '@/components/transferencia/NovaTransferencia'
import { AcoesTransferencia } from '@/components/transferencia/AcoesTransferencia'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { FiltrosGaveta } from '@/components/ui-kit/FiltrosGaveta'
import { ChipsFiltrosAtivos } from '@/components/ui-kit/ChipsFiltrosAtivos'
import { ChipsStatus } from '@/components/ui-kit/ChipsStatus'
import type { CampoFiltro } from '@/components/ui-kit/filtros-utils'
import { valoresMulti } from '@/components/ui-kit/filtros-utils'
import { Lista } from '@/components/ui-kit/Lista'
import { StatusPill } from '@/components/ui-kit/StatusPill'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Paginacao } from '@/components/ui-kit/Paginacao'
import { btnClass, btnLinhaClass, RotuloAcao } from '@/components/ui-kit/Button'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { complementarMovimentos } from '@/lib/historico-contabo'
import { escapeIlikeOr } from '@/lib/utils-busca'

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
    local?: string
    page?: string
    produto?: string
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

  // Familias distintas para o select. PostgREST limita a 1000 linhas por
  // requisicao SEM avisar — lojas com mais de 1000 produtos com familia
  // preenchida (a maioria das 6 lojas ativas tem) perdiam a maior parte das
  // familias do dropdown silenciosamente (ex: loja com 52 familias reais
  // mostrava so 4). Pagina ate esgotar para pegar todas.
  const familiasSet = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data: bloco } = await supabase
      .from('produtos')
      .select('descricao_familia')
      .eq('loja_id', lojaId)
      .not('descricao_familia', 'is', null)
      .range(from, from + 999)
    for (const p of bloco ?? []) {
      if (p.descricao_familia) familiasSet.add(p.descricao_familia)
    }
    if (!bloco?.length || bloco.length < 1000) break
  }
  const familias = [...familiasSet].sort()

  // Filtro de familia/tipo via produtos -> movimentos -> transferencia_id
  // (multi-select: valor na URL e uma lista separada por virgula)
  const familiasArr = valoresMulti(sp.familia)
  const tiposArr = valoresMulti(sp.tipo)
  let idsFiltrados: number[] | null = null
  if (familiasArr.length || tiposArr.length || sp.produto) {
    function buildProdQuery(from: number, to: number) {
      let q = supabase.from('produtos').select('codigo_produto').eq('loja_id', lojaId).range(from, to)
      if (familiasArr.length) q = q.in('descricao_familia', familiasArr)
      if (tiposArr.length) q = q.in('tipo_item', tiposArr)
      if (sp.produto) {
        const termo = escapeIlikeOr(sp.produto)
        q = q.or(`descricao.ilike.%${termo}%,codigo.ilike.%${termo}%`)
      }
      return q
    }
    // Paginado: um tipo/familia isolado pode ter mais de 1000 produtos (ex: loja 6,
    // tipo "99", tem 1143) — sem paginar, o PostgREST corta em 1000 SEM avisar e o
    // filtro passa a ignorar produtos de verdade (falso negativo: transferencia some
    // da lista mesmo contendo produto do filtro escolhido).
    const codigos: number[] = []
    for (let from = 0; ; from += 1000) {
      const { data: bloco } = await buildProdQuery(from, from + 999)
      if (!bloco?.length) break
      codigos.push(...bloco.map((p) => p.codigo_produto).filter((v): v is number => v != null))
      if (bloco.length < 1000) break
    }
    const codigosUnicos = [...new Set(codigos)]

    if (codigosUnicos.length) {
      const movsData: { id: number; id_prod: number; transferencia_id: number | null }[] = []
      for (let from = 0; ; from += 1000) {
        const { data: bloco } = await supabase
          .from('movimentos')
          .select('id, id_prod, transferencia_id')
          .eq('loja_id', lojaId)
          .in('id_prod', codigosUnicos)
          .not('transferencia_id', 'is', null)
          .range(from, from + 999)
        if (!bloco?.length) break
        movsData.push(...bloco)
        if (bloco.length < 1000) break
      }
      // complementarMovimentos nao aceita uma lista de id_prod (a API do Contabo so
      // filtra por 1 produto por vez), entao ela busca TODOS os movimentos da loja
      // sem filtro de produto — precisa refiltrar aqui, senao movimentos do Contabo
      // de produtos fora da familia/tipo escolhido vazam pro resultado (idsFiltrados
      // incluiria transferencias que nao tem nenhum produto do filtro).
      const codigosSet = new Set(codigosUnicos)
      const movs = (await complementarMovimentos(movsData, { lojaId })).filter((m) =>
        codigosSet.has(m.id_prod)
      )
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
      'id, data, codigo_local_origem, codigo_local_destino, status, motivo, user_id, movimentos(count), movStatus:movimentos(status)'
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
  // Local de estoque (origem OU destino) — multi-select.
  const locaisArr = valoresMulti(sp.local)
    .map((v) => Number(v))
    .filter((n) => !Number.isNaN(n))
  if (locaisArr.length) {
    const lista = locaisArr.join(',')
    query = query.or(`codigo_local_origem.in.(${lista}),codigo_local_destino.in.(${lista})`)
  }
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

  // Responsavel de cada transferencia: user_id -> nome (tabela profiles).
  const userIds = [...new Set((transferencias ?? []).map((t) => t.user_id).filter(Boolean))]
  const { data: profs } = userIds.length
    ? await supabase.from('profiles').select('id, name').in('id', userIds as string[])
    : { data: [] as { id: string; name: string | null }[] }
  const nomeMap = new Map((profs ?? []).map((p) => [p.id, p.name]))

  function fmtData(d: string | null): string {
    if (!d) return ''
    return new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' })
  }

  // Ambos os exports (PDF e Excel) precisam levar TODOS os filtros ativos na
  // tela — achado real (auditoria 2026-07-18): os hrefs só repassavam um
  // subconjunto, então o arquivo baixado voltava sem o filtro que o usuário
  // via aplicado na lista (falso negativo de auditoria: dado "some" do export
  // mas está certo na tela, ou vice-versa).
  const relatorioParams = new URLSearchParams()
  if (sp.data_inicio) relatorioParams.set('data_inicio', sp.data_inicio)
  if (sp.data_final) relatorioParams.set('data_final', sp.data_final)
  if (sp.familia) relatorioParams.set('familia', sp.familia)
  if (sp.tipo) relatorioParams.set('tipo', sp.tipo)
  if (sp.produto) relatorioParams.set('produto', sp.produto)
  if (sp.local) relatorioParams.set('local', sp.local)
  if (sp.status) relatorioParams.set('status', sp.status)
  if (sp.motivo) relatorioParams.set('motivo', sp.motivo)
  const relatorioHref = `/transferencia/relatorio?${relatorioParams.toString()}`

  const exportParams = new URLSearchParams()
  if (sp.data_inicio) exportParams.set('data_inicio', sp.data_inicio)
  if (sp.data_final) exportParams.set('data_final', sp.data_final)
  if (sp.status) exportParams.set('status', sp.status)
  if (sp.motivo) exportParams.set('motivo', sp.motivo)
  if (sp.familia) exportParams.set('familia', sp.familia)
  if (sp.tipo) exportParams.set('tipo', sp.tipo)
  if (sp.produto) exportParams.set('produto', sp.produto)
  if (sp.local) exportParams.set('local', sp.local)
  const exportHref = `/transferencia/export?${exportParams.toString()}`

  const campos: CampoFiltro[] = [
    { tipo: 'data', nome: 'data_inicio', label: 'Data inicial' },
    { tipo: 'data', nome: 'data_final', label: 'Data final' },
    { tipo: 'texto', nome: 'produto', label: 'Produto (nome ou código)' },
    {
      tipo: 'multi-select',
      nome: 'familia',
      label: 'Família',
      opcoes: familias.map((f) => ({ value: f, label: f })),
    },
    { tipo: 'multi-select', nome: 'tipo', label: 'Tipo de produto', opcoes: PRODUTO_TIPO_ITEM },
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
      // Só existem 2 motivos possíveis (TRF/TPQ): marcar os dois equivale a não
      // filtrar, então single-select já cobre o caso de uso — mantido assim.
      tipo: 'select',
      nome: 'motivo',
      label: 'Motivo',
      opcoes: [
        { value: 'TRF', label: 'Transferência' },
        { value: 'TPQ', label: 'Perda / quebra' },
      ],
    },
    {
      tipo: 'multi-select',
      nome: 'local',
      label: 'Local de estoque',
      opcoes: (todosLocais ?? [])
        .slice()
        .sort((a, b) => (a.descricao ?? '').localeCompare(b.descricao ?? '', 'pt-BR'))
        .map((l) => ({ value: String(l.codigo_local_estoque), label: l.descricao ?? String(l.codigo_local_estoque) })),
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
                  produto: sp.produto ?? '',
                  familia: sp.familia ?? '',
                  tipo: sp.tipo ?? '',
                  status: sp.status ?? '',
                  motivo: sp.motivo ?? '',
                  local: sp.local ?? '',
                }}
                persistirEm="/transferencia"
              />
              <a
                href={exportHref}
                target="_blank"
                rel="noopener noreferrer"
                className={btnClass('outline')}
              >
                <Download className="size-4" /> Excel
              </a>
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
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <span className="num text-text-muted">#{t.id}</span>
                  <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[12px] text-text-muted">{origem}</span>
                  <span className="text-text-muted">→</span>
                  <span className="rounded bg-ok/15 px-1.5 py-0.5 text-[12px] font-medium text-ok">{destino}</span>
                </span>
              )
            },
          },
          { label: 'Data', larguraDesktop: 'w-28', render: (t) => <span className="num text-text-muted">{fmtData(t.data)}</span> },
          {
            label: 'Responsável',
            larguraDesktop: 'w-40',
            render: (t) => <span className="truncate text-text-muted">{nomeMap.get(t.user_id) || '-'}</span>,
          },
          {
            label: 'Integrados',
            alinhar: 'right',
            larguraDesktop: 'w-32',
            render: (t) => {
              const total = Array.isArray(t.movimentos) ? t.movimentos[0]?.count ?? 0 : 0
              const movStatus = Array.isArray(t.movStatus) ? t.movStatus : []
              const concluidos = movStatus.filter((m: { status: string | null }) => m.status === 'Concluido').length
              const temErro = movStatus.some((m: { status: string | null }) => m.status === 'Erro' || m.status === 'Sem CMC')
              if (t.status !== 'Concluido') return <span className="num text-text-muted">{total}</span>
              if (total === 0) return <span className="text-text-muted">-</span>
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
            <div className="flex items-center justify-end gap-1 2xl:gap-2">
              <Link
                href={`/transferencia/${t.id}/contagem`}
                className={btnLinhaClass('outline')}
                aria-label={labelAcao}
                title={labelAcao}
              >
                <Pencil className="size-4" /> <RotuloAcao>{labelAcao}</RotuloAcao>
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
