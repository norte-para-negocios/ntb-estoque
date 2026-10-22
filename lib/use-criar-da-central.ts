'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

/**
 * Atalho da Central ("+ Novo ..."): /rota?criar=1 abre o formulário de criação da própria tela da lista
 * e limpa o endereço (um F5 não reabre). `ativo=false` nos formulários de edição (um por linha da lista).
 */
export function useCriarDaCentral(abrir: () => void, ativo = true) {
  const router = useRouter()
  const pathname = usePathname()
  const veio = useSearchParams().get('criar') === '1'
  const abrirRef = useRef(abrir)
  abrirRef.current = abrir
  useEffect(() => {
    if (!veio || !ativo) return
    abrirRef.current()
    router.replace(pathname, { scroll: false })
  }, [veio, ativo, pathname, router])
}
