'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { CircleAlert } from 'lucide-react'
import { moduloDaRota, type Acesso, type ModuloId } from '@/lib/plataforma/modulos-puro'

// Plataforma Norte: faixa "módulo suspenso" no topo do conteúdo e, na troca de tela pelo próprio app (o layout não
// roda de novo na navegação do cliente), o mesmo desvio para /modulos/<id> que o layout faz no carregamento.
export function FaixaModulo({ acessos }: { acessos: Record<ModuloId, Acesso> }) {
  const pathname = usePathname()
  const router = useRouter()
  const modulo = moduloDaRota(pathname)
  const a = modulo ? acessos[modulo] : 'abre'

  useEffect(() => {
    if (modulo && a === 'vitrine') router.replace('/modulos/' + modulo)
  }, [modulo, a, router])

  if (a !== 'consulta') return null
  return (
    <p role="status" className="mb-4 flex items-start gap-2 rounded-[var(--r-lg)] bg-warn/10 px-4 py-2.5 text-[13px] text-warn print:hidden">
      <CircleAlert className="mt-0.5 size-4 shrink-0" />
      Este módulo está suspenso nesta loja: dá para consultar, mas não lançar. Fale com a Norte para reativar.
    </p>
  )
}
