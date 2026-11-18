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

/**
 * F-17: aviso ao concluir. Com item que não foi ao Omie (Erro/Sem CMC/Iniciado) o aviso não pode ser verde nem dizer
 * "enviado": o inventário fica Finalizado e os itens seguem pendentes para "Reenviar pendentes".
 */
export function avisoConclusaoInventario(o: { proprio: boolean; comErro?: number | null }): { tipo: 'success' | 'warning'; titulo: string; descricao?: string } {
  const n = o.comErro ?? 0
  if (n <= 0) return { tipo: 'success', titulo: o.proprio ? 'Inventário concluído' : 'Inventário enviado ao Omie' }
  const itens = n === 1 ? '1 item' : `${n} itens`
  return o.proprio
    ? { tipo: 'warning', titulo: `Concluído, mas ${itens} não ${n === 1 ? 'foi lançado' : 'foram lançados'}`, descricao: 'Use "Reenviar pendentes" para tentar de novo.' }
    : { tipo: 'warning', titulo: `Finalizado, mas ${itens} não ${n === 1 ? 'foi' : 'foram'} ao Omie`, descricao: 'Use "Reenviar pendentes" para tentar de novo.' }
}
