'use client'

import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'

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
    <div className="ntb-card">
      <div className="ntb-card-body">
        <form onSubmit={onSubmit} className="flex gap-3">
          <input
            name="q"
            defaultValue={defaultValue}
            placeholder={placeholder}
            className="ntb-input"
          />
          <button type="submit" className="ntb-btn-success shrink-0">
            <Search className="size-4" /> Buscar
          </button>
        </form>
      </div>
    </div>
  )
}
