'use client'

import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import { btnClass } from '@/components/ui-kit/Button'

export function BuscaSimples({
  basePath,
  placeholder,
  defaultValue,
}: {
  basePath: string
  placeholder: string
  defaultValue: string
}) {
  const router = useRouter()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const q = (form.get('q') as string) || ''
    router.push(q ? `${basePath}?q=${encodeURIComponent(q)}` : basePath)
  }

  return (
    <form onSubmit={onSubmit} className="flex gap-2">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
        <input
          name="q"
          defaultValue={defaultValue}
          placeholder={placeholder}
          className="w-full rounded-md border border-border bg-surface py-1.5 pl-9 pr-3 text-sm text-text outline-none transition-colors placeholder:text-text-muted focus:border-brand"
        />
      </div>
      <button type="submit" className={`${btnClass('primary')} shrink-0`}>
        <Search className="size-4" /> Buscar
      </button>
    </form>
  )
}
