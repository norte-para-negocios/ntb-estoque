// Regras puras da tela de contagem (sem imports @/, testavel via `node --test`).

/**
 * Sair do campo sem mudar nada nao pode reenviar: cada envio de item ja lancado
 * exclui o ajuste no Omie e relanca (2-4 chamadas), o que ajudava a estourar a
 * cota da loja (2026-09-24). Item nao concluido (Erro/Sem CMC/Iniciado) reenvia
 * mesmo com o mesmo valor -- e o jeito do usuario tentar de novo.
 */
export function precisaEnviar(
  atual: { quan: number | null; status: string | null } | undefined,
  novo: number | null
): boolean {
  if (!atual || atual.quan !== novo) return true
  if (novo === null) return atual.status !== 'Vazio'
  return atual.status !== 'Concluido'
}
