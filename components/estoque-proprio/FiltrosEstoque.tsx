'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'
import { Toolbar } from '@/components/ui-kit/Toolbar'
import { btnClass } from '@/components/ui-kit/Button'

const campo =
  'w-full rounded-[var(--r-md)] border-0 bg-surface-2 px-2.5 py-1.5 text-sm text-text outline-none u-motion focus:ring-2 focus:ring-brand/40'
const rotulo = 'mb-1 block text-[11px] font-medium text-text-muted'

type Opcao = { value: string; label: string }

export function FiltrosEstoque({
  basePath = '/estoque', familias, tipos, locais,
}: { basePath?: string; familias: Opcao[]; tipos: Opcao[]; locais: Opcao[] }) {
  const router = useRouter()
  const sp = useSearchParams()

  function aplicar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const p = new URLSearchParams(sp.toString())
    for (const nome of ['q', 'familia', 'tipo', 'local']) {
      const v = String(f.get(nome) ?? '').trim()
      if (v) p.set(nome, v)
      else p.delete(nome)
    }
    router.push(`${basePath}?${p.toString()}`)
  }

  const sel = (nome: string, rot: string, opcoes: Opcao[]) => (
    <div>
      <label className={rotulo} htmlFor={`f-${nome}`}>{rot}</label>
      <select id={`f-${nome}`} name={nome} defaultValue={sp.get(nome) ?? ''} className={campo}>
        <option value="">Todos</option>
        {opcoes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )

  return (
    <Toolbar>
      <form onSubmit={aplicar} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto]">
        <div>
          <label className={rotulo} htmlFor="f-q">Buscar produto</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
            <input id="f-q" name="q" defaultValue={sp.get('q') ?? ''} placeholder="Nome ou código" className={`${campo} pl-9`} />
          </div>
        </div>
        {sel('familia', 'Família', familias)}
        {sel('tipo', 'Tipo do item', tipos)}
        {sel('local', 'Local', locais)}
        <div className="flex gap-2">
          <button type="submit" className={btnClass('primary')}>Filtrar</button>
          <button type="button" className={btnClass('outline')} onClick={() => router.push(basePath)}>Limpar</button>
        </div>
      </form>
    </Toolbar>
  )
}
