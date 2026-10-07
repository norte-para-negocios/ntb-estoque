'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeftRight, Eye, Undo2 } from 'lucide-react'
import { Lista } from '@/components/ui-kit/Lista'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { btnLinhaClass } from '@/components/ui-kit/Button'
import { estornarMovimento } from '@/lib/actions/estoque-proprio'
import { SeletorColunas, useColunasVisiveis } from '@/components/movimentacoes/SeletorColunas'
import { TIPOS_LEDGER } from '@/components/movimentacoes/FiltroTipoLedger'
import { DetalheKardex } from '@/components/movimentacoes/DetalheKardex'
import { ROTULO_ORIGEM, type LinhaKardex } from '@/lib/estoque/kardex-tipos'
import { formatCustoUnit } from '@/lib/num-br'

const COLUNAS = ['Data', 'Tipo', 'Produto', 'Quantidade', 'Local', 'Origem', 'Usuário', 'Saldo após', 'Custo']

const fmtQtd = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 })
const fmtQuando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Bahia', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })

export function ListaMovimentosProprio({ linhas, podeEstornar }: { linhas: LinhaKardex[]; podeEstornar: boolean }) {
  const { visiveis, toggle } = useColunasVisiveis('/movimentacoes', COLUNAS)
  const [pending, startTransition] = useTransition()
  const [alvo, setAlvo] = useState<number | null>(null)
  const [aberto, setAberto] = useState<number | null>(null)
  const router = useRouter()
  const sp = useSearchParams()
  const ord = sp.get('ord') || 'data'
  const dir: 'asc' | 'desc' = sp.get('dir') === 'asc' ? 'asc' : 'desc'

  function sortHref(key: string, novaDir: 'asc' | 'desc'): string {
    const p = new URLSearchParams(sp.toString())
    p.set('ord', key)
    p.set('dir', novaDir)
    p.delete('page')
    return `/movimentacoes?${p.toString()}`
  }

  function estornar(m: LinhaKardex) {
    if (!window.confirm(`Estornar este movimento?\n\n${m.descricao}: ${m.quantidade > 0 ? '+' : ''}${fmtQtd(m.quantidade)}\n\nO estorno cria um movimento inverso; nada é apagado.`)) return
    setAlvo(m.id)
    startTransition(async () => {
      const r = await estornarMovimento(m.id)
      setAlvo(null)
      if ('error' in r) toast.error('Não foi possível estornar', { description: r.error })
      else {
        toast.success('Movimento estornado')
        router.refresh()
      }
    })
  }

  const todas = [
    { label: 'Data', sort: 'data', larguraDesktop: 'w-36', render: (m: LinhaKardex) => <span className="num text-[13px] text-text-muted">{fmtQuando(m.quando)}</span> },
    {
      label: 'Tipo',
      primaria: true,
      sort: 'tipo',
      larguraDesktop: 'w-32',
      render: (m: LinhaKardex) => {
        const t = TIPOS_LEDGER[m.tipo] ?? { label: m.tipo, cor: 'text-text-muted' }
        return (
          <span>
            <span className={`text-[14px] font-medium ${t.cor}`}>{t.label}</span>
            {m.estornado_por != null && <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 py-0.5 text-[11px] text-text-muted">estornado</span>}
            {m.reverses_id != null && <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 py-0.5 text-[11px] text-text-muted">de #{m.reverses_id}</span>}
          </span>
        )
      },
    },
    {
      label: 'Produto',
      sort: 'produto',
      flexivel: true,
      render: (m: LinhaKardex) => (
        <button type="button" onClick={() => setAberto(m.id)} className="min-w-0 text-left" title="Ver detalhe">
          <span className="block truncate text-[14px] text-text hover:text-brand">{m.descricao ?? m.codigo_produto}</span>
          <span className="num block truncate text-[12px] text-text-muted">{m.codigo}{m.obs ? ` · ${m.obs}` : ''}</span>
        </button>
      ),
    },
    {
      label: 'Quantidade',
      sort: 'quantidade',
      alinhar: 'right' as const,
      larguraDesktop: 'w-32',
      render: (m: LinhaKardex) => (
        <span className={`num font-medium ${m.quantidade < 0 ? 'text-err' : 'text-ok'}`}>
          {m.quantidade > 0 ? '+' : ''}{fmtQtd(m.quantidade)}{m.unidade ? ` ${m.unidade}` : ''}
        </span>
      ),
    },
    { label: 'Local', sort: 'local', larguraDesktop: 'w-36', render: (m: LinhaKardex) => <span className="text-[13px] text-text-muted">{m.local_nome ?? m.codigo_local}</span> },
    {
      label: 'Origem',
      sort: 'origem',
      larguraDesktop: 'w-40',
      render: (m: LinhaKardex) => (
        <span className="text-[13px] text-text-muted">
          {ROTULO_ORIGEM[m.origem] ?? m.origem}
          <span className="num block max-w-[10rem] truncate text-[11px]">{m.ref}</span>
        </span>
      ),
    },
    { label: 'Usuário', larguraDesktop: 'w-32', render: (m: LinhaKardex) => <span className="truncate text-[13px] text-text-muted">{m.user_nome ?? m.user_id ?? '-'}</span> },
    { label: 'Saldo após', sort: 'saldo', alinhar: 'right' as const, larguraDesktop: 'w-28', render: (m: LinhaKardex) => <span className={`num text-[13px] ${m.saldo_apos < 0 ? 'font-semibold text-err' : 'text-text'}`}>{fmtQtd(m.saldo_apos)}</span> },
    { label: 'Custo', sort: 'custo', alinhar: 'right' as const, larguraDesktop: 'w-28', render: (m: LinhaKardex) => <span className="num text-[13px] text-text-muted">{formatCustoUnit(m.custo)}</span> },
  ]

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <SeletorColunas colunas={COLUNAS} visiveis={visiveis} toggle={toggle} />
      </div>
      <Lista
        linhas={linhas}
        chaveLinha={(m) => String(m.id)}
        colunas={todas.filter((c) => visiveis.has(c.label))}
        sortAtual={ord}
        dirAtual={dir}
        sortHref={sortHref}
        rolarHorizontal
        acao={(m: LinhaKardex) => (
          <span className="inline-flex items-center gap-1">
            <button type="button" onClick={() => setAberto(m.id)} className={btnLinhaClass('outline')} aria-label="Ver detalhe do movimento" title="Detalhe e documento de origem">
              <Eye className="size-4" />
            </button>
            {podeEstornar && ['ENT', 'SAI', 'AJU', 'PRD'].includes(m.tipo) && m.estornado_por == null && (
              <button type="button" onClick={() => estornar(m)} disabled={pending && alvo === m.id} className={btnLinhaClass('outline')} aria-label="Estornar movimento" title="Estornar (cria um movimento inverso)">
                <Undo2 className="size-4" />
              </button>
            )}
          </span>
        )}
        vazio={<EmptyState icon={ArrowLeftRight} title="Sem movimentações" hint="Nenhum movimento neste período com os filtros escolhidos." />}
      />
      <DetalheKardex id={aberto} onFechar={() => setAberto(null)} onAbrir={setAberto} />
    </div>
  )
}
