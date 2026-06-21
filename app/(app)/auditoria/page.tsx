import { notFound } from 'next/navigation'
import { getAtorGestao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { ChipsStatus } from '@/components/ui-kit/ChipsStatus'
import { BuscaSimples } from '@/components/BuscaSimples'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Lista, type Coluna } from '@/components/ui-kit/Lista'
import { Paginacao } from '@/components/ui-kit/Paginacao'
import { escapeIlikeOr } from '@/lib/utils-busca'
import { History, Inbox } from 'lucide-react'

export const dynamic = 'force-dynamic'

const POR_PAGINA = 100

// Cor do selo por acao (mesmos tokens do resto do sistema).
const ACAO_CLASSE: Record<string, string> = {
  criar: 'bg-ok/15 text-ok',
  editar: 'bg-warn/15 text-warn',
  excluir: 'bg-err/15 text-err',
}

function fmtDataHora(d: string): string {
  return new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })
}

type LinhaAudit = {
  id: number
  created_at: string
  user_nome: string | null
  acao: string
  entidade: string
  entidade_id: string | null
  descricao: string | null
  loja_id: number | null
}

export default async function AuditoriaPage({
  searchParams,
}: {
  searchParams: Promise<{ acao?: string; q?: string; page?: string }>
}) {
  // Trilha de auditoria e sensivel: so quem pode gerir (admin global ou de loja).
  const ator = await getAtorGestao()
  if (!ator.podeGerir) notFound()

  const sp = await searchParams
  const page = Math.max(1, Number(sp.page) || 1)
  const supabase = createServiceClient()
  const lojaIds = ator.lojaIds.length ? ator.lojaIds : [-1]

  let query = supabase
    .from('audit_log')
    .select('id, created_at, user_nome, acao, entidade, entidade_id, descricao, loja_id')
    .in('loja_id', lojaIds)
    .order('created_at', { ascending: false })

  if (sp.acao === 'criar' || sp.acao === 'editar' || sp.acao === 'excluir') {
    query = query.eq('acao', sp.acao)
  }
  if (sp.q) {
    const t = escapeIlikeOr(sp.q)
    query = query.or(`user_nome.ilike.%${t}%,descricao.ilike.%${t}%,entidade.ilike.%${t}%`)
  }
  // N+1 para detectar a proxima pagina.
  query = query.range((page - 1) * POR_PAGINA, page * POR_PAGINA)

  const { data: linhasRaw } = await query
  const temProxima = (linhasRaw?.length ?? 0) > POR_PAGINA
  const linhas = (temProxima ? linhasRaw!.slice(0, POR_PAGINA) : linhasRaw ?? []) as LinhaAudit[]

  // Nome da loja (so importa quando o admin ve mais de uma).
  const multiLoja = ator.lojaIds.length > 1
  const { data: lojasRaw } = multiLoja
    ? await supabase.from('lojas').select('id, nome_fantasia, nome').in('id', ator.lojaIds)
    : { data: [] as { id: number; nome_fantasia: string | null; nome: string | null }[] }
  const lojaMap = new Map((lojasRaw ?? []).map((l) => [l.id, l.nome_fantasia || l.nome || `Loja ${l.id}`]))

  // Colunas via Lista: desktop = tabela; mobile = linha extrato (item no título,
  // ação/responsável/quando no subtítulo). Antes era <table> cru e cortava no celular.
  const colunas: Coluna<LinhaAudit>[] = [
    {
      label: 'Item',
      primaria: true,
      flexivel: true,
      render: (l) => (
        <span>
          <span className="text-text-muted">{l.entidade}</span>{' '}
          {l.descricao || (l.entidade_id ? `#${l.entidade_id}` : '')}
        </span>
      ),
    },
    {
      label: 'Ação',
      render: (l) => (
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ACAO_CLASSE[l.acao] ?? 'bg-surface-2 text-text-muted'}`}
        >
          {l.acao}
        </span>
      ),
    },
    { label: 'Responsável', render: (l) => <span className="text-text">{l.user_nome || '-'}</span> },
    {
      label: 'Quando',
      render: (l) => <span className="num text-text-muted">{fmtDataHora(l.created_at)}</span>,
    },
    ...(multiLoja
      ? [
          {
            label: 'Loja',
            render: (l: LinhaAudit) => (
              <span className="text-text-muted">{l.loja_id ? lojaMap.get(l.loja_id) ?? l.loja_id : '-'}</span>
            ),
          },
        ]
      : []),
  ]

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Auditoria"
          icon={History}
          description="Quem criou, editou e excluiu o quê e quando"
        />
        <ChipsStatus
          basePath="/auditoria"
          param="acao"
          opcoes={[
            { value: '', label: 'Tudo' },
            { value: 'criar', label: 'Criações' },
            { value: 'editar', label: 'Edições' },
            { value: 'excluir', label: 'Exclusões' },
          ]}
        />
      </ListaHeader>

      <BuscaSimples basePath="/auditoria" placeholder="Buscar por usuário, item ou tipo..." defaultValue={sp.q ?? ''} />

      <Lista
        linhas={linhas}
        chaveLinha={(l) => l.id}
        colunas={colunas}
        vazio={
          <EmptyState
            icon={Inbox}
            title="Nenhum registro de auditoria"
            hint="As ações de criar, editar e excluir aparecem aqui."
          />
        }
      />

      {(page > 1 || temProxima) && <Paginacao basePath="/auditoria" page={page} temProxima={temProxima} />}
    </div>
  )
}
