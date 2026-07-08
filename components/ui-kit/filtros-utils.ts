// Tipos e funcoes puras compartilhadas pelo sistema de filtros (Filtros.tsx,
// FiltrosGaveta.tsx, ChipsFiltrosAtivos.tsx). Fica FORA de Filtros.tsx (que tem
// 'use client') porque Server Components nao podem chamar uma funcao importada
// de um modulo client boundary — so podem renderizar seus componentes como JSX.
// Um Server Component (ex.: uma page) que precise de `valoresMulti` para ler
// searchParams deve importar direto daqui, nao de Filtros.tsx.

export type CampoFiltro =
  | { tipo: 'texto'; nome: string; label: string }
  | { tipo: 'data'; nome: string; label: string }
  | { tipo: 'select'; nome: string; label: string; opcoes: { value: string; label: string }[] }
  | { tipo: 'combobox'; nome: string; label: string; opcoes: { value: string; label: string }[] }
  /** Seleção múltipla: valor na URL é a lista separada por vírgula (ex.: ?familia=1,2,3). */
  | { tipo: 'multi-select'; nome: string; label: string; opcoes: { value: string; label: string }[] }

/** Divide o valor de um campo multi-select (string separada por vírgula) numa lista, ignorando vazios. */
export function valoresMulti(valor: string | undefined): string[] {
  return (valor ?? '').split(',').map((v) => v.trim()).filter(Boolean)
}
