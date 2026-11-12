import type { Estado } from '@/lib/plataforma/modulos-puro'

// Rótulo e cor de cada estado de assinatura (fora do arquivo 'use client' para a página do servidor também usar).
export const ROTULO_ESTADO: Record<Estado, string> = { ativo: 'Ativo', teste: 'Em teste', bloqueado: 'Bloqueado', suspenso: 'Suspenso' }
export const COR_ESTADO: Record<Estado, string> = {
  ativo: 'bg-ok/12 text-ok',
  teste: 'bg-warn/12 text-warn',
  bloqueado: 'bg-surface-2 text-text-muted',
  suspenso: 'bg-err/10 text-err',
}
