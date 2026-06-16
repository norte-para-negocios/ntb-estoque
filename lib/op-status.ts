// Conclusao de uma Ordem de Producao, usada de forma consistente na listagem,
// no export CSV e no relatorio PDF (antes cada um tinha um criterio diferente).
// Verdade: o marcador local adicionais_d_dt_conclusao (gravado por finishOP)
// OU o campo cConcluida do Omie. Aceita tanto o escalar achatado c_concluida
// (full_object->outrasInf->>cConcluida) quanto o full_object inteiro, para os
// chamadores que ainda trazem o JSON.
export function isOpConcluida(o: {
  adicionais_d_dt_conclusao?: string | null
  c_concluida?: string | null
  full_object?: unknown
}): boolean {
  if (o.adicionais_d_dt_conclusao) return true
  if (o.c_concluida != null) return o.c_concluida === 'S'
  const fo = (o.full_object ?? {}) as { outrasInf?: { cConcluida?: string } }
  return fo.outrasInf?.cConcluida === 'S'
}

// Valores sem acento (derivados do banco). O label visivel e mapeado na UI.
export type OpStatus = 'concluida' | 'prevista' | 'atrasada' | 'pendente'

// Status granular da OP comparando a data prevista (YYYY-MM-DD) com hoje. hojeISO
// deve vir em America/Bahia (hojeBahiaISO) e e passado por fora para a funcao
// continuar pura. Comparacao lexicografica de YYYY-MM-DD e correta.
export function opStatus(
  o: {
    adicionais_d_dt_conclusao?: string | null
    c_concluida?: string | null
    full_object?: unknown
    identificacao_d_dt_previsao?: string | null
  },
  hojeISO: string
): OpStatus {
  if (isOpConcluida(o)) return 'concluida'
  const prev = o.identificacao_d_dt_previsao?.slice(0, 10)
  if (!prev) return 'pendente'
  if (prev > hojeISO) return 'prevista'
  if (prev < hojeISO) return 'atrasada'
  return 'pendente'
}
