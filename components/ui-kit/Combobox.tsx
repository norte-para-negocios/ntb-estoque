'use client'

import { useState, useRef, useEffect } from 'react'
import { ChevronDown, X } from 'lucide-react'

interface ComboboxOption {
  value: string
  label: string
}

interface ComboboxProps {
  options: ComboboxOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  id?: string
}

export function Combobox({ options, value, onChange, placeholder = 'Selecionar...', className = '', id }: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const filtered = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options

  const selected = options.find((o) => o.value === value)

  // Fechar ao clicar fora
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  function abrir() {
    setOpen(true)
    setTimeout(() => inputRef.current?.focus(), 30)
  }

  function selecionar(v: string) {
    onChange(v)
    setQuery('')
    setOpen(false)
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        id={id}
        onClick={abrir}
        className="w-full flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text outline-none u-motion focus:border-brand focus:shadow-[0_0_0_3px_var(--brand-soft)] hover:bg-surface-2"
      >
        <span className={selected ? 'truncate text-left' : 'truncate text-left text-text-muted'}>
          {selected?.label ?? placeholder}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {value && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); selecionar('') }}
              onKeyDown={(e) => e.key === 'Enter' && selecionar('')}
              className="rounded p-0.5 hover:bg-surface-3 text-text-muted"
            >
              <X className="size-3" />
            </span>
          )}
          <ChevronDown className="size-3.5 text-text-muted" />
        </div>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[200px] rounded-lg border border-border bg-popover shadow-md overflow-hidden">
          <div className="border-b border-border p-1.5">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar..."
              className="w-full rounded border-0 bg-transparent px-2 py-1 text-sm text-text outline-none placeholder:text-text-muted"
            />
          </div>
          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs text-text-muted">Nenhum resultado</p>
            ) : (
              filtered.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => selecionar(opt.value)}
                  className={`w-full text-left px-3 py-1.5 text-sm u-motion hover:bg-surface-2 ${
                    opt.value === value ? 'bg-surface-2 font-medium text-brand' : 'text-text'
                  }`}
                >
                  {opt.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
