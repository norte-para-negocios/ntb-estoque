// Etapas do recebimento da nota (estoque próprio, Fase B, R9): reaproveitam a situação de sincronizar_situacao_nota.
// Puro: node --test lib/estoque/nf-etapas.test.ts.

export type EtapaNF = 'aguardando_xml' | 'a_conferir' | 'conferida' | 'lancada' | 'fora'

export const ROTULO_ETAPA: Record<EtapaNF, string> = {
  aguardando_xml: 'Aguardando o XML', a_conferir: 'A conferir', conferida: 'Conferida', lancada: 'Lançada no estoque', fora: 'Canceladas e desfeitas',
}
export const ORDEM_ETAPAS: readonly EtapaNF[] = ['aguardando_xml', 'a_conferir', 'conferida', 'lancada']

export function etapaDaNota(situacao: string | null, cancelada: boolean): EtapaNF {
  if (cancelada) return 'fora'
  switch (situacao) {
    case 'resumo': return 'aguardando_xml'
    case 'conferida': return 'conferida'
    case 'lancada': case 'parcial': return 'lancada'
    case 'estornada': case 'recusada': return 'fora'
    default: return 'a_conferir' // a_conferir, divergente, sem situação
  }
}

export function agruparPorEtapa<T extends { situacao: string | null; cancelada: boolean }>(notas: T[]): Record<EtapaNF, T[]> {
  const g: Record<EtapaNF, T[]> = { aguardando_xml: [], a_conferir: [], conferida: [], lancada: [], fora: [] }
  for (const n of notas) g[etapaDaNota(n.situacao, n.cancelada)].push(n)
  return g
}
