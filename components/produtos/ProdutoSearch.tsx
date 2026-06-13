'use client'

import { useMemo, useState, useRef } from 'react'
import { Check } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { buscarProdutos, type ProdutoBusca } from '@/lib/actions/produtos-search'

export function ProdutoSearch({
  onSelect,
  codigosAdicionados = [],
  placeholder = 'Buscar produto por nome ou código...',
}: {
  onSelect: (produto: ProdutoBusca) => void
  codigosAdicionados?: string[]
  placeholder?: string
}) {
  const [termo, setTermo] = useState('')
  const [resultados, setResultados] = useState<ProdutoBusca[]>([])
  const [aberto, setAberto] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const adicionados = useMemo(() => new Set(codigosAdicionados), [codigosAdicionados])

  function onChange(valor: string) {
    setTermo(valor)
    if (timer.current) clearTimeout(timer.current)
    if (valor.trim().length < 2) {
      setResultados([])
      setAberto(false)
      return
    }
    timer.current = setTimeout(async () => {
      const r = await buscarProdutos(valor)
      setResultados(r)
      setAberto(true)
    }, 300)
  }

  function selecionar(p: ProdutoBusca) {
    if (adicionados.has(p.codigo)) return
    onSelect(p)
    setTermo('')
    setResultados([])
    setAberto(false)
  }

  return (
    <div className="relative">
      <Input
        value={termo}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        onFocus={() => resultados.length && setAberto(true)}
      />
      {aberto && resultados.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-surface shadow-lg">
          {resultados.map((p) => {
            const jaAdicionado = adicionados.has(p.codigo)
            return (
              <button
                key={p.codigo_produto}
                type="button"
                onClick={() => selecionar(p)}
                disabled={jaAdicionado}
                aria-disabled={jaAdicionado}
                className="flex w-full items-center gap-3 border-b border-border px-3 py-2 text-left text-sm transition-colors last:border-b-0 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-text">{p.descricao}</div>
                  <div className="num truncate text-xs text-text-muted">
                    {p.codigo} {p.descricao_familia ? `· ${p.descricao_familia}` : ''}
                  </div>
                </div>
                {jaAdicionado && (
                  <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-brand">
                    <Check className="size-4" />
                    Adicionado
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
