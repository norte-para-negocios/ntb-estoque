import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

export type SecaoNota = { id: string; titulo: string; resumo: string; conteudo: ReactNode }

/**
 * Informação secundária da nota em linhas recolhidas (27/10/2026, troca as 7 abas): cada linha diz numa frase o que tem
 * dentro e só abre quando a pessoa precisa. Nada sumiu: o conteúdo é o mesmo das abas antigas. <details> nativo, sem JS.
 */
export function SecoesNota({ secoes }: { secoes: SecaoNota[] }) {
  if (!secoes.length) return null
  return (
    <section className="space-y-2" aria-label="Mais informações da nota">
      {secoes.map((s) => (
        <details key={s.id} className="group rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)] [&[open]>summary_svg]:rotate-90">
          <summary className="flex cursor-pointer list-none items-center gap-3 rounded-[var(--r-lg)] px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-brand [&::-webkit-details-marker]:hidden">
            <span className="w-40 shrink-0 text-[14px] font-semibold text-text max-sm:w-auto">{s.titulo}</span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-text-muted max-sm:hidden">{s.resumo}</span>
            <ChevronRight className="ml-auto size-4 shrink-0 text-text-muted transition-transform" aria-hidden />
          </summary>
          <p className="px-4 pb-2 text-[13px] text-text-muted sm:hidden">{s.resumo}</p>
          <div className="space-y-4 px-4 pb-4">{s.conteudo}</div>
        </details>
      ))}
    </section>
  )
}
