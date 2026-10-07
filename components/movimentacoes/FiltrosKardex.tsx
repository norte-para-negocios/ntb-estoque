'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { Download, Search, X } from 'lucide-react'
import { btnClass } from '@/components/ui-kit/Button'
import { ROTULO_ORIGEM, OPCOES_ORIGEM, atalhosPeriodo } from '@/lib/estoque/kardex-tipos'

const CAMPO = 'h-9 rounded-[var(--r-md)] border-0 bg-surface-2 px-2.5 text-[13px] max-sm:h-10 max-sm:text-base text-text outline-none transition-colors focus:ring-2 focus:ring-brand/40'

/** Busca livre, atalhos de período, origem, usuário, só negativos/estornos e exportação do que está filtrado. */
export function FiltrosKardex({ hoje }: { hoje: string }) {
  const router = useRouter()
  const sp = useSearchParams()
  const [texto, setTexto] = useState(sp.get('produto') ?? '')
  const [usuario, setUsuario] = useState(sp.get('us') ?? '')

  function ir(mudar: Record<string, string | null>) {
    const p = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(mudar)) {
      if (v) p.set(k, v)
      else p.delete(k)
    }
    p.delete('page')
    router.push(`/movimentacoes?${p.toString()}`)
  }

  const ini = sp.get('data_inicio') || hoje
  const fim = sp.get('data_final') || sp.get('data_inicio') || hoje
  const exportQs = (formato: string) => {
    const p = new URLSearchParams(sp.toString())
    p.delete('page')
    p.set('formato', formato)
    return `/movimentacoes/export?${p.toString()}`
  }

  return (
    <div className="space-y-2">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          ir({ produto: texto.trim() || null, us: usuario.trim() || null })
        }}
        className="flex flex-col gap-2 lg:flex-row lg:items-center"
      >
        <div className="relative min-w-0 flex-1 lg:max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar produto, código, referência, observação, usuário, nº de OP, nota ou pedido"
            aria-label="Busca livre"
            className={`${CAMPO} w-full pl-9 pr-8`}
          />
          {texto && (
            <button type="button" aria-label="Limpar busca" onClick={() => { setTexto(''); ir({ produto: null }) }} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text">
              <X className="size-4" />
            </button>
          )}
        </div>
        <input type="text" value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="Usuário" aria-label="Filtrar por usuário" className={`${CAMPO} w-full lg:w-40`} />
        <button type="submit" className={btnClass('primary')}>Buscar</button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex flex-wrap gap-1" role="group" aria-label="Atalhos de período">
          {atalhosPeriodo(hoje).map((a) => {
            const ativo = ini === a.ini && fim === a.fim
            return (
              <button
                key={a.chave}
                type="button"
                onClick={() => ir({ data_inicio: a.ini, data_final: a.fim })}
                className={`h-9 rounded-full px-3 text-[13px] transition-colors ${ativo ? 'bg-brand-fill font-semibold text-white' : 'bg-surface-2 text-text-muted hover:text-text'}`}
              >
                {a.label}
              </button>
            )
          })}
        </span>
        <select value={sp.get('og') ?? ''} onChange={(e) => ir({ og: e.target.value || null })} aria-label="Origem" className={`${CAMPO} max-w-[200px]`}>
          <option value="">Todas as origens</option>
          {OPCOES_ORIGEM.map((o) => (
            <option key={o} value={o}>{ROTULO_ORIGEM[o] ?? o}</option>
          ))}
        </select>
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-[13px] text-text-muted">
          <input type="checkbox" className="accent-brand" checked={sp.get('neg') === '1'} onChange={(e) => ir({ neg: e.target.checked ? '1' : null })} /> Só saldo negativo
        </label>
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-[13px] text-text-muted">
          <input type="checkbox" className="accent-brand" checked={sp.get('est') === '1'} onChange={(e) => ir({ est: e.target.checked ? '1' : null })} /> Só estornos
        </label>
        <span className="ml-auto inline-flex gap-2">
          <a href={exportQs('xlsx')} className={btnClass('outline')}><Download className="size-4" /> Excel</a>
          <a href={exportQs('csv')} className={btnClass('outline')}><Download className="size-4" /> CSV</a>
        </span>
      </div>
    </div>
  )
}
