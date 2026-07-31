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

type FullObjectComCadastro =
  | { infoCadastro?: { cCancelada?: string | null; cRecebido?: string | null } }
  | null
  | undefined

export function statusNF(cEtapa: string | null, fullObject: unknown): StatusNF {
  const cancelada = (fullObject as FullObjectComCadastro)?.infoCadastro?.cCancelada === 'S'
  if (cancelada) return { label: 'Cancelada', tom: 'err' }
  if (cEtapa === '60') return { label: 'Concluída', tom: 'ok' }
  return { label: `Pendente (etapa ${cEtapa ?? '?'})`, tom: 'warn' }
}

// cRecebido é campo PRÓPRIO da Omie (independente de c_etapa -- achado real
// 2026-07-31: c_etapa='40' sempre tem cRecebido='N', mas c_etapa='60' só tem
// cRecebido='S' em 10487 de 10491 casos, não é sinônimo exato de Concluída).
export function manifestada(fullObject: unknown): boolean {
  return (fullObject as FullObjectComCadastro)?.infoCadastro?.cRecebido === 'S'
}

// Fragmento null-safe pra "nao cancelada", usado dentro de .or(...) do
// supabase-js. `<> 'S'` sozinho seria FALSO (nao verdadeiro) quando o campo
// e null -- excluiria em silencio toda NF sem essa chave no JSONB. Sempre
// usar via .or(NAO_CANCELADA_OR), nunca um .neq(...) isolado nesse campo.
export const NAO_CANCELADA_OR =
  "full_object->infoCadastro->>cCancelada.is.null,full_object->infoCadastro->>cCancelada.neq.S"

// Mesma logica do filtro de status usado nas queries do Supabase (CONCLUIDA/
// PENDENTE/CANCELADA, com compat C/P e etapa crua), so que em memoria -- usada
// pra filtrar dado que vem do Contabo (frio), que nao sabe filtrar por status
// no servidor. Fonte unica pra esse filtro em memoria: nota-fiscal/page.tsx e
// os dois exports (export/route.ts, relatorio/route.ts) usam esta mesma
// funcao, em vez de cada um reimplementar a logica.
export function statusBateFiltro(nf: { c_etapa: string | null; full_object: unknown }, status: string): boolean {
  const { label } = statusNF(nf.c_etapa, nf.full_object)
  if (status === 'C' || status === 'CONCLUIDA') return label === 'Concluída'
  if (status === 'P' || status === 'PENDENTE') return label !== 'Concluída' && label !== 'Cancelada'
  if (status === 'CANCELADA') return label === 'Cancelada'
  if (status === 'MANIFESTADA') return manifestada(nf.full_object)
  return nf.c_etapa === status
}
