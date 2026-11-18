'use client'
// "Reduzir movimento" do sistema operacional, lido SEM divergir entre servidor e navegador (F-13).
// O useReducedMotion do motion devolve null no servidor e true/false no navegador já na 1ª renderização, então quem
// tem "reduzir movimento" ligado hidratava com `style`/`transform` diferentes do HTML do servidor (aviso de hidratação
// em /central). Aqui a hidratação usa o snapshot do servidor (false) e o valor real entra logo depois, como re-render.
import * as React from 'react'

const CONSULTA = '(prefers-reduced-motion: reduce)'

export function assinar(aviso: () => void): () => void {
  const mq = window.matchMedia(CONSULTA)
  mq.addEventListener('change', aviso)
  return () => mq.removeEventListener('change', aviso)
}
export const lerNavegador = (): boolean => window.matchMedia(CONSULTA).matches
export const lerServidor = (): boolean => false

export function useMovimentoReduzido(): boolean {
  return React.useSyncExternalStore(assinar, lerNavegador, lerServidor)
}
