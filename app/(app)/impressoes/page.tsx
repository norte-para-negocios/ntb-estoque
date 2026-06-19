import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { Lista } from '@/components/ui-kit/Lista'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { FiltrosGaveta } from '@/components/ui-kit/FiltrosGaveta'
import { SELO_CLASSE } from '@/lib/status-cor'
import { Printer } from 'lucide-react'

type Impressao = {
  id: number
  origem: string
  referencia_id: number
  qtd_etiquetas: number
  user_id: string | null
  created_at: string
}

function fmtDataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Bahia',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function ImpressoesPage({
  searchParams,
}: {
  searchParams: Promise<{ data_inicio?: string; data_final?: string; origem?: string }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Impressoes'))) notFound()

  const sp = await searchParams
  const supabase = await createClient()

  let query = supabase
    .from('impressao_etiquetas')
    .select('id, origem, referencia_id, qtd_etiquetas, user_id, created_at')
    .eq('loja_id', lojaId)
    .order('created_at', { ascending: false })
    .limit(100)

  if (sp.data_inicio) query = query.gte('created_at', sp.data_inicio)
  if (sp.data_final) query = query.lte('created_at', `${sp.data_final}T23:59:59`)
  if (sp.origem === 'NF' || sp.origem === 'OP') query = query.eq('origem', sp.origem)

  const { data: impressoes } = await query.returns<Impressao[]>()

  // Resolve o nome de quem imprimiu.
  const userIds = [...new Set((impressoes ?? []).map((i) => i.user_id).filter(Boolean) as string[])]
  const { data: perfis } = userIds.length
    ? await supabase.from('profiles').select('id, name').in('id', userIds)
    : { data: [] }
  const nomeMap = new Map((perfis ?? []).map((p) => [p.id, p.name]))

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Histórico de impressão de etiquetas"
          icon={Printer}
          description="Etiquetas impressas a partir de notas fiscais e ordens de produção"
          actions={
            <FiltrosGaveta
              basePath="/impressoes"
              campos={[
                { tipo: 'data', nome: 'data_inicio', label: 'Data inicial' },
                { tipo: 'data', nome: 'data_final', label: 'Data final' },
                {
                  tipo: 'select',
                  nome: 'origem',
                  label: 'Origem',
                  opcoes: [
                    { value: 'NF', label: 'Nota Fiscal' },
                    { value: 'OP', label: 'Ordem de Produção' },
                  ],
                },
              ]}
              defaults={{
                data_inicio: sp.data_inicio ?? '',
                data_final: sp.data_final ?? '',
                origem: sp.origem ?? '',
              }}
              persistirEm="/impressoes"
            />
          }
        />
      </ListaHeader>

      <Lista
        linhas={impressoes ?? []}
        chaveLinha={(imp) => imp.id}
        colunas={[
          {
            label: 'Referência',
            primaria: true,
            render: (imp) => {
              const isNF = imp.origem === 'NF'
              const refHref = isNF ? `/nota-fiscal/${imp.referencia_id}` : `/ordem-producao`
              return (
                <Link href={refHref} className="font-medium text-brand hover:underline">
                  #{imp.referencia_id}
                </Link>
              )
            },
          },
          {
            label: 'Data/hora',
            larguraDesktop: 'w-44',
            render: (imp) => <span className="text-text-muted">{fmtDataHora(imp.created_at)}</span>,
          },
          {
            label: 'Origem',
            larguraDesktop: 'w-44',
            render: (imp) => {
              const isNF = imp.origem === 'NF'
              return (
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${SELO_CLASSE[isNF ? 'info' : 'ok']}`}
                >
                  {isNF ? 'Nota Fiscal' : 'Ordem de Produção'}
                </span>
              )
            },
          },
          {
            label: 'Usuário',
            larguraDesktop: 'w-40',
            render: (imp) => (
              <span className="text-text-muted">{imp.user_id ? nomeMap.get(imp.user_id) ?? '-' : '-'}</span>
            ),
          },
          {
            label: 'Qtd',
            larguraDesktop: 'w-28',
            render: (imp) => imp.qtd_etiquetas,
          },
        ]}
        acao={(imp) => {
          const isNF = imp.origem === 'NF'
          const imprimirHref = isNF
            ? `/nota-fiscal/${imp.referencia_id}/imprimir`
            : `/ordem-producao/${imp.referencia_id}/imprimir`
          return (
            <a
              href={imprimirHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-[13px] font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
            >
              <Printer className="size-3.5" strokeWidth={2} />
              Reimprimir
            </a>
          )
        }}
        vazio={
          <EmptyState
            icon={Printer}
            title="Nenhuma impressão ainda"
            hint="As impressões de etiquetas aparecerão aqui."
          />
        }
      />
    </div>
  )
}
