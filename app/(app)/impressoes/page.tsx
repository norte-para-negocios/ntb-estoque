import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { Lista } from '@/components/ui-kit/Lista'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Printer } from 'lucide-react'

type Impressao = {
  id: number
  origem: string
  referencia_id: number
  qtd_etiquetas: number
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

export default async function ImpressoesPage() {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Notas Fiscais'))) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Histórico de impressão de etiquetas"
          icon={Printer}
          description="Etiquetas impressas a partir de notas fiscais e ordens de produção"
        />
        <EmptyState icon={Printer} title="Sem permissão" hint="Você não tem acesso a esta tela." />
      </div>
    )
  }

  const supabase = await createClient()
  const { data: impressoes } = await supabase
    .from('impressao_etiquetas')
    .select('id, origem, referencia_id, qtd_etiquetas, created_at')
    .eq('loja_id', lojaId)
    .order('created_at', { ascending: false })
    .limit(100)
    .returns<Impressao[]>()

  return (
    <div className="space-y-4">
      <PageHeader
        title="Histórico de impressão de etiquetas"
        icon={Printer}
        description="Etiquetas impressas a partir de notas fiscais e ordens de produção"
      />

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
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={
                    isNF
                      ? { color: '#3b82f6', background: '#3b82f61a' }
                      : { color: '#10b981', background: '#10b9811a' }
                  }
                >
                  {isNF ? 'Nota Fiscal' : 'Ordem de Produção'}
                </span>
              )
            },
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
