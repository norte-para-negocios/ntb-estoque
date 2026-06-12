'use client'

import { useState, useRef } from 'react'
import { Input } from '@/components/ui/input'
import { buscarProdutos, type ProdutoBusca } from '@/lib/actions/produtos-search'

export function ProdutoSearch({
  onSelect,
  placeholder = 'Buscar produto por nome ou codigo...',
}: {
  onSelect: (produto: ProdutoBusca) => void
  placeholder?: string
}) {
  const [termo, setTermo] = useState('')
  const [resultados, setResultados] = useState<ProdutoBusca[]>([])
  const [aberto, setAberto] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

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
        <div className="absolute z-10 w-full mt-1 bg-white border rounded-md shadow-lg max-h-72 overflow-y-auto">
          {resultados.map((p) => (
            <button
              key={p.codigo_produto}
              onClick={() => selecionar(p)}
              className="w-full text-left px-3 py-2 hover:bg-gray-100 text-sm border-b last:border-b-0"
            >
              <div className="font-medium">{p.descricao}</div>
              <div className="text-xs text-gray-500">
                {p.codigo} {p.descricao_familia ? `· ${p.descricao_familia}` : ''}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
