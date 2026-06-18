'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Loader2, SearchX } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { buscarProdutos, type ProdutoBusca } from '@/lib/actions/produtos-search'
import { buscarFamilias } from '@/lib/actions/produto'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'

const selectClass =
  'min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-text outline-none focus:border-brand'

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
  const [tipo, setTipo] = useState('')
  const [familia, setFamilia] = useState('') // codigo_familia (string)
  const [familias, setFamilias] = useState<{ codigo: number; descricao: string }[]>([])
  const [resultados, setResultados] = useState<ProdutoBusca[]>([])
  const [aberto, setAberto] = useState(false)
  const [buscando, setBuscando] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Cada busca recebe um id; so o resultado da ultima busca disparada vale (evita
  // que uma resposta lenta antiga sobrescreva uma busca mais recente).
  const reqId = useRef(0)

  const adicionados = useMemo(() => new Set(codigosAdicionados), [codigosAdicionados])

  // Carrega as familias existentes para o seletor (escolher por familia).
  useEffect(() => {
    buscarFamilias().then(setFamilias).catch(() => {})
  }, [])

  // Busca combinando termo + tipo + familia. Com filtro (tipo/familia), lista
  // mesmo sem digitar; sem filtro, precisa de 2+ caracteres no termo.
  function buscar(t: string, ti: string, fa: string) {
    if (timer.current) clearTimeout(timer.current)
    if (t.trim().length < 2 && !ti && !fa) {
      setResultados([])
      setAberto(false)
      setBuscando(false)
      return
    }
    // Abre ja mostrando o estado "buscando" para dar resposta imediata ao usuario.
    setBuscando(true)
    setAberto(true)
    const id = ++reqId.current
    // Debounce menor (180ms): a busca por palavras e leve e responde rapido.
    timer.current = setTimeout(async () => {
      const f = familias.find((x) => String(x.codigo) === fa)
      const r = await buscarProdutos(t, { tipo: ti || undefined, familia: f?.descricao })
      if (id !== reqId.current) return // chegou tarde: ignora (ja ha busca mais nova)
      setResultados(r)
      setBuscando(false)
    }, 180)
  }

  function selecionar(p: ProdutoBusca) {
    if (adicionados.has(p.codigo)) return
    onSelect(p)
    // Mantem filtros e lista abertos para continuar escolhendo da mesma familia/tipo.
  }

  return (
    <div className="relative">
      <Input
        value={termo}
        onChange={(e) => {
          setTermo(e.target.value)
          buscar(e.target.value, tipo, familia)
        }}
        placeholder={placeholder}
        onFocus={() => resultados.length && setAberto(true)}
      />

      {/* Filtros: escolher por tipo (revenda/produção...) e familia, sem digitar */}
      <div className="mt-2 flex items-center gap-2">
        <select
          value={tipo}
          onChange={(e) => {
            setTipo(e.target.value)
            buscar(termo, e.target.value, familia)
          }}
          className={selectClass}
          aria-label="Filtrar por tipo"
        >
          <option value="">Todos os tipos</option>
          {PRODUTO_TIPO_ITEM.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <select
          value={familia}
          onChange={(e) => {
            setFamilia(e.target.value)
            buscar(termo, tipo, e.target.value)
          }}
          className={selectClass}
          aria-label="Filtrar por família"
        >
          <option value="">Todas as famílias</option>
          {familias.map((f) => (
            <option key={f.codigo} value={f.codigo}>{f.descricao}</option>
          ))}
        </select>
      </div>

      {aberto && (buscando || resultados.length > 0 || termo.trim().length >= 2 || tipo || familia) && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-md border border-border bg-surface shadow-lg">
          {buscando ? (
            <div className="flex items-center gap-2 px-3 py-3 text-sm text-text-muted">
              <Loader2 className="size-4 animate-spin" />
              Buscando produtos...
            </div>
          ) : resultados.length === 0 ? (
            <div className="flex items-center gap-2 px-3 py-3 text-sm text-text-muted">
              <SearchX className="size-4" />
              Nenhum produto encontrado
            </div>
          ) : (
          resultados.map((p) => {
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
          })
          )}
        </div>
      )}
    </div>
  )
}
