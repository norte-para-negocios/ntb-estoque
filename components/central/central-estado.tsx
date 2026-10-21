'use client'

import * as React from 'react'
import type { CtxVisibilidade } from '@/lib/nav-visivel'
import { menuNovoAtivo } from '@/lib/nav-visivel'

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

/**
 * Padrão: novo para quem é desenvolvedor. O valor salvo só é lido depois de montar; até lá `pronto` é false
 * (o menu não desenha nenhuma das duas versões, para não piscar). Quem não é dev: sempre [false, _, true].
 */
export function useMenuNovo(isSuperAdmin: boolean): [boolean, (novo: boolean) => void, boolean] {
  const [novo, setNovo] = React.useState(isSuperAdmin)
  const [pronto, setPronto] = React.useState(!isSuperAdmin)

  React.useEffect(() => {
    if (!isSuperAdmin) return
    const ler = () => {
      try {
        setNovo(menuNovoAtivo(true, window.localStorage.getItem(LS_MODO)))
      } catch {
        setNovo(true)
      }
      setPronto(true)
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

  return [isSuperAdmin && novo, alterar, pronto]
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
      const prox = favs.includes(href) ? favs.filter((h) => h !== href) : [...favs, href]
      setFavs(prox)
      try {
        window.localStorage.setItem(chave, JSON.stringify(prox))
      } catch {
        /* sem localStorage: vale só nesta aba */
      }
      window.dispatchEvent(new Event(EVT_FAV))
    },
    [chave, favs]
  )

  return [favs, alternar]
}
