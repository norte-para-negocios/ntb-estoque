import { notFound } from 'next/navigation'
import { getAtorGestao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { ChipsStatus } from '@/components/ui-kit/ChipsStatus'
import { BuscaSimples } from '@/components/BuscaSimples'
import { EmptyState } from '@/components/ui-kit/EmptyState'
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

      <div className="overflow-clip rounded-lg border border-border bg-surface">
        {linhas.length === 0 ? (
          <EmptyState icon={Inbox} title="Nenhum registro de auditoria" hint="As ações de criar, editar e excluir aparecem aqui." />
        ) : (
          <table data-sticky-table className="w-full text-sm">
            <thead className="bg-surface-2">
              <tr>
                <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">Quando</th>
                <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">Responsável</th>
                <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">Ação</th>
                <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">Item</th>
                {multiLoja && <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">Loja</th>}
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.id} className="border-t border-border/60 even:bg-surface-2/30 hover:bg-surface-2/60">
                  <td className="num whitespace-nowrap px-4 py-2 text-text-muted">{fmtDataHora(l.created_at)}</td>
                  <td className="px-4 py-2 text-text">{l.user_nome || '-'}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ACAO_CLASSE[l.acao] ?? 'bg-surface-2 text-text-muted'}`}>
                      {l.acao}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-text">
                    <span className="text-text-muted">{l.entidade}</span>{' '}
                    {l.descricao || (l.entidade_id ? `#${l.entidade_id}` : '')}
                  </td>
                  {multiLoja && <td className="px-4 py-2 text-text-muted">{l.loja_id ? lojaMap.get(l.loja_id) ?? l.loja_id : '-'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {(page > 1 || temProxima) && <Paginacao basePath="/auditoria" page={page} temProxima={temProxima} />}
    </div>
  )
}
