import { Loader2 } from 'lucide-react'

/**
 * Spinner discreto para botões em estado "salvando/enviando" (A6).
 * Pequeno por padrão (size-3.5) para acompanhar o texto sem competir com ele.
 * Usa Loader2 (mesma família do toast de loading do sonner) girando com
 * animate-spin. Em prefers-reduced-motion o giro é zerado pelo globals.css,
 * mas o ícone continua visível como indicador de estado.
 */
export function Spinner({ className = '' }: { className?: string }) {
  return <Loader2 className={`size-3.5 shrink-0 animate-spin ${className}`} strokeWidth={2.25} aria-hidden />
}
