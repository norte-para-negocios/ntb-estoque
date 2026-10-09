'use client'

import * as React from 'react'
import Link from 'next/link'
import { CloudOff, RefreshCw, TriangleAlert } from 'lucide-react'

// Faixa do app desktop: avisa quando está sem internet, enviando a fila ou com ação recusada.
// No site não aparece (NEXT_PUBLIC_DESKTOP só existe no build do app).
type Status = {
  online: boolean | null
  pendentes: number
  comErro: number
  erro: string | null
  logado: boolean
  carga?: { pronta: boolean; fase: string | null }
}

export function BannerSync() {
  const [st, setSt] = React.useState<Status | null>(null)

  React.useEffect(() => {
    if (process.env.NEXT_PUBLIC_DESKTOP !== '1') return
    let vivo = true
    async function ler() {
      try {
        const r = await fetch('/__ntb/status', { cache: 'no-store' })
        if (vivo) setSt(await r.json())
      } catch {
        // gateway reiniciando
      }
    }
    ler()
    const t = setInterval(ler, 4000)
    return () => {
      vivo = false
      clearInterval(t)
    }
  }, [])

  if (process.env.NEXT_PUBLIC_DESKTOP !== '1' || !st) return null

  let icone = null
  let texto = ''
  let tom = 'bg-surface text-text-muted'
  if (st.comErro > 0) {
    icone = <TriangleAlert className="size-4 shrink-0" />
    texto = `${st.comErro} ${st.comErro === 1 ? 'operação feita sem internet foi recusada' : 'operações feitas sem internet foram recusadas'} pelo servidor.`
    tom = 'bg-surface text-err'
  } else if (st.online === false) {
    icone = <CloudOff className="size-4 shrink-0" />
    texto = st.pendentes
      ? `Sem internet · ${st.pendentes} ${st.pendentes === 1 ? 'operação aguardando' : 'operações aguardando'} para enviar.`
      : 'Sem internet · você está vendo os dados guardados neste computador.'
  } else if (st.pendentes) {
    icone = <RefreshCw className="size-4 shrink-0 animate-spin" />
    texto = `Enviando ${st.pendentes} ${st.pendentes === 1 ? 'operação feita' : 'operações feitas'} sem internet…`
  } else if (st.carga && !st.carga.pronta && st.carga.fase) {
    icone = <RefreshCw className="size-4 shrink-0 animate-spin" />
    texto = st.carga.fase
  } else {
    return null
  }

  return (
    <Link
      href="/sincronizacao"
      className={`mb-3 flex items-center gap-2 rounded-[var(--r-md)] px-3 py-2 text-[13px] shadow-[var(--shadow-sm)] ${tom}`}
    >
      {icone}
      <span className="min-w-0 flex-1">{texto}</span>
      <span className="shrink-0 underline-offset-2 hover:underline">Ver</span>
    </Link>
  )
}
