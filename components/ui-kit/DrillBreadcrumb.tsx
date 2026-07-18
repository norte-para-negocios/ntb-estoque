import Link from 'next/link'
import { X } from 'lucide-react'
import { hrefComDrill, type ParDrill } from '@/lib/drill'

// Trilha do drill: "‹raiz› › CARNES › Picanha [✕]". Server component.
// rotuloDe deixa a página traduzir o rotulo cru pra exibição (tipo '04' -> nome).
export function DrillBreadcrumb({
  basePath,
  sp,
  pares,
  raiz,
  rotuloDe,
}: {
  basePath: string
  sp: Record<string, string | undefined>
  pares: ParDrill[]
  raiz: string
  rotuloDe?: (par: ParDrill) => string
}) {
  if (!pares.length) return null
  return (
    <nav aria-label="Trilha do detalhamento" className="flex flex-wrap items-center gap-1.5 text-[13px]">
      <Link href={hrefComDrill(basePath, sp, [])} className="text-text-muted hover:text-text hover:underline">
        {raiz}
      </Link>
      {pares.map((p, i) => (
        <span key={`${p.dim}:${p.rotulo}`} className="flex items-center gap-1.5">
          <span className="text-text-muted">›</span>
          {i === pares.length - 1 ? (
            <span className="font-medium text-text">{rotuloDe?.(p) ?? p.rotulo}</span>
          ) : (
            <Link href={hrefComDrill(basePath, sp, pares.slice(0, i + 1))} className="text-text-muted hover:text-text hover:underline">
              {rotuloDe?.(p) ?? p.rotulo}
            </Link>
          )}
        </span>
      ))}
      <Link
        href={hrefComDrill(basePath, sp, [])}
        aria-label="Limpar detalhamento"
        className="ml-1 rounded p-0.5 text-text-muted hover:bg-surface-2 hover:text-text"
      >
        <X className="size-3.5" />
      </Link>
    </nav>
  )
}
