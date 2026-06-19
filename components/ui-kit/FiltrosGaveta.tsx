'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { SlidersHorizontal } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from '@/components/ui/sheet'
import { btnClass } from './Button'
import type { CampoFiltro } from './Filtros'
import { useFiltrosPersistentes } from '@/hooks/use-filtros-persistentes'

export type { CampoFiltro }

const field =
  'w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text outline-none u-motion focus:border-brand focus:shadow-[0_0_0_3px_var(--brand-soft)]'
const lab = 'mb-1 block text-[11px] font-medium text-text-muted'

// Presets de período (boa prática: atalho em vez de digitar data toda vez).
const fmtD = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const PRESETS: { label: string; calc: () => [string, string] }[] = [
  { label: 'Hoje', calc: () => { const h = new Date(); return [fmtD(h), fmtD(h)] } },
  { label: '7 dias', calc: () => { const h = new Date(); const i = new Date(); i.setDate(h.getDate() - 6); return [fmtD(i), fmtD(h)] } },
  { label: 'Este mês', calc: () => { const h = new Date(); return [fmtD(new Date(h.getFullYear(), h.getMonth(), 1)), fmtD(h)] } },
  { label: 'Mês passado', calc: () => { const h = new Date(); return [fmtD(new Date(h.getFullYear(), h.getMonth() - 1, 1)), fmtD(new Date(h.getFullYear(), h.getMonth(), 0))] } },
  { label: 'Este ano', calc: () => { const h = new Date(); return [fmtD(new Date(h.getFullYear(), 0, 1)), fmtD(h)] } },
]

export function FiltrosGaveta({
  basePath,
  campos,
  defaults,
  naoContar = [],
  persistirEm,
}: {
  basePath: string
  campos: CampoFiltro[]
  defaults: Record<string, string>
  /** Campos cujo valor nao conta no badge (ex.: datas padrao). */
  naoContar?: string[]
  /** Quando informado, persiste os filtros no localStorage com escopo por rota. */
  persistirEm?: string
}) {
  const router = useRouter()
  const sp = useSearchParams()
  const [open, setOpen] = useState(false)
  // Valores controlados; cada filtro aplica na hora (sem precisar de "Aplicar").
  const [valores, setValores] = useState<Record<string, string>>(defaults)

  // Hook de persistencia (ativo quando `persistirEm` e fornecido).
  const { limpar: limparPersistente } = useFiltrosPersistentes(persistirEm ?? '')

  // Ressincroniza quando a URL muda (navegacao externa, limpar, etc.)
  useEffect(() => {
    setValores(defaults)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(defaults)])

  // Conta filtros ativos: campos com valor não-vazio, ignorando os excluídos.
  const ativos = campos.reduce((n, c) => {
    if (naoContar.includes(c.nome)) return n
    const v = (valores[c.nome] ?? '').trim()
    return v ? n + 1 : n
  }, 0)

  // Aplica um filtro imediatamente, preservando os demais params.
  function aplicar(nome: string, valor: string) {
    setValores((prev) => ({ ...prev, [nome]: valor }))
    const params = new URLSearchParams(sp.toString())
    params.delete('page') // reset paginação ao filtrar
    if (valor.trim()) params.set(nome, valor.trim())
    else params.delete(nome)
    router.push(`${basePath}?${params.toString()}`)
  }

  // Aplica os dois campos de data de uma vez (1 navegação só).
  function aplicarPeriodo(ini: string, fim: string) {
    setValores((prev) => ({ ...prev, data_inicio: ini, data_final: fim }))
    const params = new URLSearchParams(sp.toString())
    params.delete('page')
    params.set('data_inicio', ini)
    params.set('data_final', fim)
    router.push(`${basePath}?${params.toString()}`)
  }
  const temPeriodo =
    campos.some((c) => c.nome === 'data_inicio') && campos.some((c) => c.nome === 'data_final')

  function limpar() {
    setValores({})
    setOpen(false)
    if (persistirEm) {
      // Usa o hook para limpar storage + URL.
      limparPersistente()
    } else {
      router.push(basePath)
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <button type="button" className={`${btnClass('outline')} shrink-0`}>
            <SlidersHorizontal className="size-4" /> Filtros
            {ativos > 0 && (
              <span className="ml-0.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold leading-none text-white">
                {ativos}
              </span>
            )}
          </button>
        }
      />
      <SheetContent
        side="right"
        className="w-[88vw] overflow-y-auto bg-surface p-0 sm:max-w-none sm:w-[360px]"
        showCloseButton
      >
        <div className="border-b border-border px-4 py-3 text-base font-semibold text-text">
          Filtros
        </div>

        <div className="flex h-[calc(100%-49px)] flex-col">
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {temPeriodo && (
              <div>
                <span className={lab}>Período rápido</span>
                <div className="flex flex-wrap gap-1.5">
                  {PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => {
                        const [i, f] = p.calc()
                        aplicarPeriodo(i, f)
                      }}
                      className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-text-muted u-motion u-press-sm hover:border-brand hover:bg-surface-2 hover:text-text"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {campos.map((c) => (
              <div key={c.nome}>
                <label htmlFor={`fg-${c.nome}`} className={lab}>
                  {c.label}
                </label>
                {c.tipo === 'select' ? (
                  <select
                    id={`fg-${c.nome}`}
                    name={c.nome}
                    value={valores[c.nome] ?? ''}
                    onChange={(e) => aplicar(c.nome, e.target.value)}
                    className={field}
                  >
                    <option value="">Todos</option>
                    {c.opcoes.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`fg-${c.nome}`}
                    name={c.nome}
                    type={c.tipo === 'data' ? 'date' : 'text'}
                    value={valores[c.nome] ?? ''}
                    onChange={(e) =>
                      // data aplica na hora; texto so no Enter/blur (evita navegar a cada tecla)
                      c.tipo === 'data'
                        ? aplicar(c.nome, e.target.value)
                        : setValores((prev) => ({ ...prev, [c.nome]: e.target.value }))
                    }
                    onBlur={(e) => c.tipo !== 'data' && aplicar(c.nome, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        aplicar(c.nome, (e.target as HTMLInputElement).value)
                      }
                    }}
                    className={field}
                  />
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
            <button type="button" onClick={limpar} className={btnClass('ghost')}>
              Limpar
            </button>
            <button type="button" onClick={() => setOpen(false)} className={btnClass('primary')}>
              Fechar
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
