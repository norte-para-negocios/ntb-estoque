'use client'

import { createContext, useContext, type ReactNode } from 'react'

// Modo de estoque da loja atual para os componentes de cliente: em loja de estoque próprio as telas que já existiam
// (Ordens de Produção, Estrutura, ...) continuam iguais, só trocam o texto "no Omie" por "no estoque" e mostram os campos novos.
const Ctx = createContext(false)

export function ModoEstoqueProvider({ proprio, children }: { proprio: boolean; children: ReactNode }) {
  return <Ctx.Provider value={proprio}>{children}</Ctx.Provider>
}

export function useEstoqueProprio(): boolean {
  return useContext(Ctx)
}

/** "no Omie" no modo Omie, "no estoque" no estoque próprio. */
export function noSistema(proprio: boolean): string {
  return proprio ? 'no estoque' : 'no Omie'
}
