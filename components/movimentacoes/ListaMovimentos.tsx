'use client'

import { Lista } from '@/components/ui-kit/Lista'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { ArrowLeftRight } from 'lucide-react'
import { LinhaMovimentoTipo } from '@/components/movimentacoes/LinhaMovimentoTipo'
import { SeletorColunas, useColunasVisiveis } from '@/components/movimentacoes/SeletorColunas'
import type { LinhaDetalhe } from '@/components/movimentacoes/MovimentosTab'

const COLUNAS = ['Data', 'Tipo', 'Quantidade', 'Local / Destino', 'Status']

function fmtDataDetalhe(d: string): string {
  if (d.includes('T')) {
    return new Date(d).toLocaleString('pt-BR', {
      timeZone: 'America/Bahia', day: '2-digit', month: '2-digit',
      year: '2-digit', hour: '2-digit', minute: '2-digit',
    })
  }
  const [y, mo, dia] = d.slice(0, 10).split('-')
  return `${dia}/${mo}/${y}`
}

function fmtQtd(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 })
}

export function ListaMovimentos({
  linhas,
  TIPOS,
  locaisMap,
  vazioProps,
}: {
  linhas: LinhaDetalhe[]
  TIPOS: Record<string, { label: string; cor: string }>
  locaisMap: Map<number, string>
  vazioProps: { title: string; hint: string }
}) {
  const { visiveis, toggle } = useColunasVisiveis('/movimentacoes', COLUNAS)

  const todasColunas = [
    {
      label: 'Data',
      larguraDesktop: 'w-36',
      render: (m: LinhaDetalhe) => <span className="num text-[12px] text-text-muted">{fmtDataDetalhe(m.data)}</span>,
    },
    {
      label: 'Tipo',
      primaria: true,
      larguraDesktop: 'w-44',
      render: (m: LinhaDetalhe) => {
        const t = TIPOS[m.tipo] ?? { label: m.tipo, cor: 'text-text-muted' }
        return <LinhaMovimentoTipo label={t.label} cor={t.cor} obs={m.obs} origem={m.origem} />
      },
    },
    {
      label: 'Quantidade',
      alinhar: 'right' as const,
      larguraDesktop: 'w-28',
      render: (m: LinhaDetalhe) => {
        const negativo = m.tipo === 'SAI' || m.tipo === 'TPQ'
        const cor = negativo ? 'text-err' : m.tipo === 'ENT' || m.tipo === 'OP' ? 'text-ok' : 'text-text'
        const sinal = negativo ? '-' : m.tipo === 'ENT' || m.tipo === 'OP' ? '+' : ''
        return <span className={`num font-medium ${cor}`}>{sinal}{fmtQtd(m.quan)}</span>
      },
    },
    {
      label: 'Local / Destino',
      larguraDesktop: 'w-48',
      render: (m: LinhaDetalhe) => {
        if (m.local == null) return <span className="text-text-muted">-</span>
        const nomeOrig = locaisMap.get(m.local) ?? String(m.local)
        const nomeDest = m.destino != null ? (locaisMap.get(m.destino) ?? String(m.destino)) : null
        return (
          <span className="text-[12px] text-text-muted">
            {nomeOrig}
            {nomeDest && <span> → {nomeDest}</span>}
          </span>
        )
      },
    },
    {
      label: 'Status',
      larguraDesktop: 'w-28',
      render: (m: LinhaDetalhe) => {
        const cor = m.status === 'Erro' ? 'text-err' : m.status === 'Concluido' ? 'text-ok' : 'text-text-muted'
        return <span className={`text-[11px] ${cor}`}>{m.status ?? '-'}</span>
      },
    },
  ]

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <SeletorColunas colunas={COLUNAS} visiveis={visiveis} toggle={toggle} />
      </div>
      <Lista
        linhas={linhas}
        chaveLinha={(m) => m.chave}
        colunas={todasColunas.filter((c) => visiveis.has(c.label))}
        vazio={<EmptyState icon={ArrowLeftRight} title={vazioProps.title} hint={vazioProps.hint} />}
      />
    </div>
  )
}
