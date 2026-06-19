'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { X } from 'lucide-react'
import type { CampoFiltro } from './Filtros'
import { useFiltrosPersistentes } from '@/hooks/use-filtros-persistentes'

// Formata 'YYYY-MM-DD' (valor de input date) para 'DD/MM/AAAA'. Outros formatos
// passam direto.
function fmtData(v: string): string {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v
}

// Resolve o texto exibido de um valor conforme o tipo do campo.
function rotuloValor(campo: CampoFiltro, valor: string): string {
  if (campo.tipo === 'select') {
    const op = campo.opcoes.find((o) => o.value === valor)
    return op ? op.label : valor
  }
  if (campo.tipo === 'data') return fmtData(valor)
  return valor
}

/**
 * Mostra, acima da tabela, um chip por filtro ativo (lido da URL) com um "x" para
 * remover. Quando ha 2+ chips, oferece "Limpar tudo". Usa a MESMA lista `campos`
 * da gaveta para resolver rotulos. `naoMostrar` exclui campos que nao sao filtro de
 * conteudo (ex.: 'ord' de ordenacao). Preserva params fora de `campos` (dias/modo,
 * vista, etc.) ao remover.
 * `persistirEm` deve ser o mesmo valor passado ao FiltrosGaveta para que o
 * "Limpar tudo" tambem apague o localStorage.
 */
export function ChipsFiltrosAtivos({
  basePath,
  campos,
  naoMostrar = [],
  persistirEm,
}: {
  basePath: string
  campos: CampoFiltro[]
  naoMostrar?: string[]
  /** Quando informado, limparTudo tambem apaga o localStorage da rota. */
  persistirEm?: string
}) {
  const router = useRouter()
  const sp = useSearchParams()
  const { limpar: limparPersistente } = useFiltrosPersistentes(persistirEm ?? '')

  const chips = campos
    .filter((c) => !naoMostrar.includes(c.nome))
    .map((c) => {
      const valor = (sp.get(c.nome) ?? '').trim()
      if (!valor) return null
      return { nome: c.nome, campoLabel: c.label, valorLabel: rotuloValor(c, valor) }
    })
    .filter((c): c is { nome: string; campoLabel: string; valorLabel: string } => c !== null)

  if (chips.length === 0) return null

  function navegar(params: URLSearchParams) {
    params.delete('page') // remover/limpar filtro reseta a paginacao
    const qs = params.toString()
    router.push(qs ? `${basePath}?${qs}` : basePath)
  }

  function remover(nome: string) {
    const params = new URLSearchParams(sp.toString())
    params.delete(nome)
    navegar(params)
  }

  function limparTudo() {
    if (persistirEm) {
      // Delega ao hook que apaga storage + navega.
      limparPersistente()
      return
    }
    const params = new URLSearchParams(sp.toString())
    for (const c of campos) if (!naoMostrar.includes(c.nome)) params.delete(c.nome)
    navegar(params)
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((ch) => (
        <span
          key={ch.nome}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-surface py-1 pl-2.5 pr-1 text-[12px] text-text-muted"
        >
          <span>{ch.campoLabel}:</span>
          <span className="font-medium text-text">{ch.valorLabel}</span>
          <button
            type="button"
            onClick={() => remover(ch.nome)}
            aria-label={`Remover filtro ${ch.campoLabel}`}
            className="-my-1 -mr-1 ml-0.5 inline-flex items-center justify-center rounded-full p-2 text-text-muted u-motion u-press-sm hover:bg-surface-2 hover:text-text"
          >
            <X className="size-3.5" />
          </button>
        </span>
      ))}
      {chips.length >= 2 && (
        <button
          type="button"
          onClick={limparTudo}
          className="ml-0.5 text-[12px] font-medium text-brand u-motion hover:underline"
        >
          Limpar tudo
        </button>
      )}
    </div>
  )
}
