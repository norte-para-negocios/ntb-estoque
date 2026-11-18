// Permissão por tabela no canal offline (/api/offline/{snapshot,linhas,mudancas}). Sem rede nem banco: só a regra.
// Mesma regra da tela que mostra cada tabela (ver e2e/robo/permissoes-matriz.ts, TABELAS_OFFLINE). Tabela fora desta
// lista continua livre para quem está logado (cadastros, saldos etc.): o app desktop precisa delas para funcionar offline.
// cargo_permissao, permissao_user, loja_user e profiles ficam livres de propósito: o app as usa para decidir permissão sem internet.

export type RegraTabela = { dev?: boolean; gestao?: boolean; anyOf?: string[] }

export const REGRAS_TABELA: Record<string, RegraTabela> = {
  contas_pagar: { dev: true, anyOf: ['Financeiro - Contas a pagar'] },
  contas_receber: { dev: true, anyOf: ['Financeiro - Contas a receber'] },
  contas_correntes: { dev: true, anyOf: ['Financeiro - Contas correntes'] },
  compras_proprio: { anyOf: ['Compras'] },
  notas_fiscais: { anyOf: ['Notas Fiscais'] },
  faturamento_importado: { gestao: true },
  margem_importada: { gestao: true },
  metas_faturamento: { gestao: true },
}

export type ContextoPermissao = {
  perfil: string | null
  superAdmin: boolean
  /** Permissões por loja (nomes). '*' = acesso total (Admin, ou AdminLoja vinculado à loja). */
  permissoes: Map<number, Set<string>>
}

export function tabelaRestrita(tabela: string): boolean {
  return Object.hasOwn(REGRAS_TABELA, tabela)
}

export function lojaPodeLerTabela(tabela: string, loja: number, ctx: ContextoPermissao): boolean {
  if (!tabelaRestrita(tabela)) return true
  const regra = REGRAS_TABELA[tabela]
  const perms = ctx.permissoes.get(loja) ?? new Set<string>()
  if (regra.dev && !ctx.superAdmin) return false
  if (regra.gestao && !(ctx.perfil === 'Admin' || (ctx.perfil === 'AdminLoja' && perms.has('*')))) return false
  if (regra.anyOf?.length && !perms.has('*') && !regra.anyOf.some((p) => perms.has(p))) return false
  return true
}

export function lojasQuePodemLer(tabela: string, lojas: number[], ctx: ContextoPermissao): number[] {
  return lojas.filter((l) => lojaPodeLerTabela(tabela, l, ctx))
}

type Mudanca = { tabela: string; dado: unknown; apagado: boolean }

/** Tira das mudanças as linhas de tabela restrita que o usuário não pode ler. Linha apagada leva só o pk (sem dado): passa. */
export function filtrarMudancas<T extends Mudanca>(mudancas: T[], lojas: number[], ctx: ContextoPermissao): T[] {
  return mudancas.filter((m) => {
    if (!tabelaRestrita(m.tabela) || m.apagado) return true
    const loja = Number((m.dado as { loja_id?: unknown } | null)?.loja_id)
    if (Number.isInteger(loja) && loja > 0) return lojaPodeLerTabela(m.tabela, loja, ctx)
    return lojasQuePodemLer(m.tabela, lojas, ctx).length === lojas.length
  })
}
