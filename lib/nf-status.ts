// lib/nf-status.ts
// Fonte única de verdade pro status de uma nota fiscal (Omie): cruza c_etapa
// (fase do recebimento) com cCancelada (flag INDEPENDENTE de etapa -- uma NF
// pode estar em c_etapa='60' e cancelada ao mesmo tempo). Antes desta mudança,
// 3 lugares diferentes (lista, detalhe, export) faziam
// `etapa === '60' ? 'Concluída' : 'Pendente'` cada um do seu jeito, ignorando
// cancelamento -- casos reais confirmados (1-2 por loja) de NF "Concluída" que
// na verdade estava cancelada.
//
// So existem 2 valores reais de c_etapa na base hoje ('60' e '40') -- nao ha
// documentacao da Omie pros demais codigos possiveis, entao qualquer coisa
// != '60' vira "Pendente (etapa X)", nunca escondendo o codigo cru.
export type StatusNF = { label: string; tom: 'ok' | 'warn' | 'err' }

type FullObjectComCadastro = { infoCadastro?: { cCancelada?: string | null } } | null | undefined

export function statusNF(cEtapa: string | null, fullObject: unknown): StatusNF {
  const cancelada = (fullObject as FullObjectComCadastro)?.infoCadastro?.cCancelada === 'S'
  if (cancelada) return { label: 'Cancelada', tom: 'err' }
  if (cEtapa === '60') return { label: 'Concluída', tom: 'ok' }
  return { label: `Pendente (etapa ${cEtapa ?? '?'})`, tom: 'warn' }
}

// Fragmento null-safe pra "nao cancelada", usado dentro de .or(...) do
// supabase-js. `<> 'S'` sozinho seria FALSO (nao verdadeiro) quando o campo
// e null -- excluiria em silencio toda NF sem essa chave no JSONB. Sempre
// usar via .or(NAO_CANCELADA_OR), nunca um .neq(...) isolado nesse campo.
export const NAO_CANCELADA_OR =
  "full_object->infoCadastro->>cCancelada.is.null,full_object->infoCadastro->>cCancelada.neq.S"
