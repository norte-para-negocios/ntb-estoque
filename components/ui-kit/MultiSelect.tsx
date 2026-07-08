'use client'

import { useState, useRef, useEffect } from 'react'
import { ChevronDown, X, Check } from 'lucide-react'

interface MultiSelectOption {
  value: string
  label: string
}

interface MultiSelectProps {
  options: MultiSelectOption[]
  value: string[]
  onChange: (value: string[]) => void
  placeholder?: string
  className?: string
  id?: string
}

// Mesmo padrão visual do Combobox, mas permite marcar várias opções ao mesmo
// tempo (checkbox por linha) em vez de fechar ao escolher uma.
export function MultiSelect({ options, value, onChange, placeholder = 'Todos', className = '', id }: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const filtered = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options

  const selecionados = new Set(value)

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

  function alternar(v: string) {
    if (selecionados.has(v)) onChange(value.filter((x) => x !== v))
    else onChange([...value, v])
  }

  const resumo =
    value.length === 0
      ? placeholder
      : value.length === 1
      ? options.find((o) => o.value === value[0])?.label ?? value[0]
      : `${value.length} selecionados`

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        id={id}
        onClick={abrir}
        className="w-full flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text outline-none u-motion focus:border-brand focus:shadow-[0_0_0_3px_var(--brand-soft)] hover:bg-surface-2"
      >
        <span className={value.length ? 'truncate text-left' : 'truncate text-left text-text-muted'}>{resumo}</span>
        <div className="flex shrink-0 items-center gap-1">
          {value.length > 0 && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onChange([]) }}
              onKeyDown={(e) => e.key === 'Enter' && onChange([])}
              className="rounded p-0.5 hover:bg-surface-3 text-text-muted"
            >
              <X className="size-3" />
            </span>
          )}
          <ChevronDown className="size-3.5 text-text-muted" />
        </div>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[220px] rounded-lg border border-border bg-popover shadow-md overflow-hidden">
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
              filtered.map((opt) => {
                const sel = selecionados.has(opt.value)
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => alternar(opt.value)}
                    className={`flex w-full items-center gap-2 text-left px-3 py-1.5 text-sm u-motion hover:bg-surface-2 ${
                      sel ? 'text-brand font-medium' : 'text-text'
                    }`}
                  >
                    <span className={`flex size-4 shrink-0 items-center justify-center rounded border ${sel ? 'border-brand bg-brand text-white' : 'border-border'}`}>
                      {sel && <Check className="size-3" />}
                    </span>
                    <span className="truncate">{opt.label}</span>
                  </button>
                )
              })
            )}
          </div>
          {value.length > 0 && (
            <div className="border-t border-border p-1.5">
              <button
                type="button"
                onClick={() => onChange([])}
                className="w-full rounded px-2 py-1 text-center text-xs text-text-muted u-motion hover:bg-surface-2 hover:text-text"
              >
                Limpar seleção
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
