'use client'

import { useRouter, useSearchParams } from 'next/navigation'

export type ChipOpcao = {
  /** Valor do searchParam. '' = Todos (remove o filtro). */
  value: string
  label: string
  /** Contador opcional ao lado do label (ex.: Pendentes 12). */
  count?: number
}

/**
 * Chips de filtro rapido de status ACIMA da tabela: 1 clique troca o valor de um
 * searchParam (sem abrir a gaveta de filtros), preservando os demais params.
 * Espelha o mesmo param que a gaveta usa (ex.: status, op_concluido), entao os
 * dois ficam em sincronia. Reseta a paginacao ao trocar.
 */
export function ChipsStatus({
  basePath,
  param,
  opcoes,
}: {
  basePath: string
  param: string
  opcoes: ChipOpcao[]
}) {
  const router = useRouter()
  const sp = useSearchParams()
  const atual = sp.get(param) ?? ''

  function selecionar(value: string) {
    const params = new URLSearchParams(sp.toString())
    params.delete('page')
    if (value) params.set(param, value)
    else params.delete(param)
    const qs = params.toString()
    router.push(qs ? `${basePath}?${qs}` : basePath)
  }

  return (
    // Mobile: uma linha só, rola na horizontal (não empilha em 2 fileiras e come
    // espaço vertical). Desktop (sm+): quebra normalmente. Scrollbar escondida.
    <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto [scrollbar-width:none] sm:flex-wrap [&::-webkit-scrollbar]:hidden">
      {opcoes.map((o) => {
        const ativo = atual === o.value
        return (
          <button
            key={o.value || '_todos'}
            type="button"
            aria-pressed={ativo}
            onClick={() => selecionar(o.value)}
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-[13px] font-medium u-motion u-press-sm ${
              ativo
                ? 'border-brand bg-brand/10 text-brand'
                : 'border-border bg-surface text-text-muted hover:border-brand/50 hover:bg-surface-2 hover:text-text'
            }`}
          >
            {o.label}
            {o.count != null && (
              <span className={`num text-[12px] ${ativo ? 'text-brand' : 'text-text-muted'}`}>{o.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
