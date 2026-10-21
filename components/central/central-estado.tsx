'use client'

import * as React from 'react'
import type { CtxVisibilidade } from '@/lib/central/visibilidade'

// Estado do menu novo (só desenvolvedores): contexto de visibilidade, "menu antigo/novo" e favoritos.
// localStorage só dentro de useEffect (nada diferente do servidor na hidratação) e sempre com try/catch.

type Valor = { ctx: CtxVisibilidade; userId: string }
const CentralCtx = React.createContext<Valor | null>(null)

export function CentralProvider({ value, children }: { value: Valor; children: React.ReactNode }) {
  return <CentralCtx.Provider value={value}>{children}</CentralCtx.Provider>
}

export function useCentral(): Valor | null {
  return React.useContext(CentralCtx)
}

// ---- menu antigo / novo ----
const LS_MODO = 'ntb.menu.modo'
const EVT_MODO = 'ntb-menu-modo'

/** Padrão: novo para quem é desenvolvedor. O valor salvo só é lido depois de montar. */
export function useMenuNovo(isSuperAdmin: boolean): [boolean, (novo: boolean) => void] {
  const [novo, setNovo] = React.useState(isSuperAdmin)

  React.useEffect(() => {
    if (!isSuperAdmin) return
    const ler = () => {
      try {
        setNovo(window.localStorage.getItem(LS_MODO) !== 'antigo')
      } catch {
        setNovo(true)
      }
    }
    ler()
    window.addEventListener(EVT_MODO, ler)
    window.addEventListener('storage', ler)
    return () => {
      window.removeEventListener(EVT_MODO, ler)
      window.removeEventListener('storage', ler)
    }
  }, [isSuperAdmin])

  const alterar = React.useCallback((v: boolean) => {
    setNovo(v)
    try {
      window.localStorage.setItem(LS_MODO, v ? 'novo' : 'antigo')
    } catch {
      /* sem localStorage: vale só nesta aba */
    }
    window.dispatchEvent(new Event(EVT_MODO))
  }, [])

  return [isSuperAdmin && novo, alterar]
}

// ---- favoritos (por usuário) ----
const EVT_FAV = 'ntb-central-favs'

export function useFavoritos(userId: string): [string[], (href: string) => void] {
  const chave = `ntb.central.favs.${userId}`
  const [favs, setFavs] = React.useState<string[]>([])

  React.useEffect(() => {
    const ler = () => {
      try {
        const v = JSON.parse(window.localStorage.getItem(chave) ?? '[]')
        setFavs(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
      } catch {
        setFavs([])
      }
    }
    ler()
    window.addEventListener(EVT_FAV, ler)
    window.addEventListener('storage', ler)
    return () => {
      window.removeEventListener(EVT_FAV, ler)
      window.removeEventListener('storage', ler)
    }
  }, [chave])

  const alternar = React.useCallback(
    (href: string) => {
      setFavs((atual) => {
        const prox = atual.includes(href) ? atual.filter((h) => h !== href) : [...atual, href]
        try {
          window.localStorage.setItem(chave, JSON.stringify(prox))
        } catch {
          /* sem localStorage: vale só nesta aba */
        }
        // avisa as outras instâncias depois do commit
        setTimeout(() => window.dispatchEvent(new Event(EVT_FAV)), 0)
        return prox
      })
    },
    [chave]
  )

  return [favs, alternar]
}
