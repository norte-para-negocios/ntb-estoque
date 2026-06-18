// Fonte única de cor semântica do app. Os hex vivem só no globals.css (:root/.dark),
// então o dark mode acompanha automaticamente. Tudo aqui é por TOKEN; o Tailwind
// precisa enxergar as classes literais, por isso os mapas guardam strings completas.

export type CorToken = 'ok' | 'warn' | 'err' | 'info' | 'brand' | 'neutro'

// Selo/badge: texto + fundo tonal (StatusPill, badge de OP, alertas da home).
export const SELO_CLASSE: Record<CorToken, string> = {
  ok: 'text-ok bg-ok/10',
  warn: 'text-warn bg-warn/10',
  err: 'text-err bg-err/10',
  info: 'text-info bg-info/10',
  brand: 'text-brand bg-brand-soft',
  neutro: 'text-text-muted bg-surface-2',
}

// Só texto (margem, totais, status inline).
export const TEXTO_CLASSE: Record<CorToken, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  err: 'text-err',
  info: 'text-info',
  brand: 'text-brand',
  neutro: 'text-text-muted',
}

// Só fundo cheio (bolinha de validade, indicadores).
export const FUNDO_CLASSE: Record<CorToken, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  err: 'bg-err',
  info: 'bg-info',
  brand: 'bg-brand',
  neutro: 'bg-text-muted',
}

// var() para os poucos casos que exigem valor CSS (props/style inline).
export const COR_VAR: Record<CorToken, string> = {
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  err: 'var(--err)',
  info: 'var(--info)',
  brand: 'var(--brand)',
  neutro: 'var(--text-muted)',
}

// Status do sistema (Omie + internos) -> rótulo + token. Fonte única do StatusPill.
// `vivo`: status que representam trabalho ACONTECENDO agora (contando, processando).
// A bolinha do selo ganha um halo pulsante ("live dot"); os terminais ficam estáticos.
const STATUS: Record<string, { label: string; token: CorToken; vivo?: true }> = {
  Concluido: { label: 'Concluído', token: 'ok' },
  Concluida: { label: 'Concluída', token: 'ok' },
  Finalizado: { label: 'Finalizado', token: 'ok' },
  Processando: { label: 'Processando', token: 'info', vivo: true },
  'Processando no Omie': { label: 'Processando no Omie', token: 'info', vivo: true },
  'Em contagem': { label: 'Em contagem', token: 'warn', vivo: true },
  Iniciado: { label: 'Iniciado', token: 'neutro' },
  Vazio: { label: 'Sem quantidade', token: 'neutro' },
  'Sem CMC': { label: 'Sem CMC', token: 'warn' },
  Erro: { label: 'Erro', token: 'err' },
  Pendente: { label: 'Pendente', token: 'warn' },
  // Perfis de usuario (selo na tela de Usuarios)
  Admin: { label: 'Admin', token: 'brand' },
  AdminLoja: { label: 'Admin da loja', token: 'info' },
  Usuario: { label: 'Usuário', token: 'neutro' },
}

export function statusInfo(status: string | null): { label: string; token: CorToken; vivo?: true } {
  return (status && STATUS[status]) || { label: status ?? 'N/A', token: 'neutro' }
}

// Urgência de validade (dias até vencer) -> token.
export function urgenciaValidade(dias: number): CorToken {
  if (dias < 0) return 'err' // vencido
  if (dias <= 3) return 'warn' // crítico
  return 'neutro'
}

// Margem de lucro (0..1) -> token.
export function corMargem(m: number): CorToken {
  if (m <= 0) return 'err'
  if (m < 0.2) return 'warn'
  return 'ok'
}
