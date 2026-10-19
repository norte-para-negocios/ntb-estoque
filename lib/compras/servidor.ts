import { getCurrentLojaId, getProfile, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'

// Contexto comum das ações de compras do estoque próprio (Fase C2): loja própria + permissão, como em pedido-compra.ts.

export type CtxCompras = { lojaId: number; userId: string; nome: string }
export type ErroCompras = { error: string }

/** todas = exige todas as permissões; alguma = basta uma. */
export async function contextoCompras(permissoes: string[], modo: 'todas' | 'alguma' = 'todas'): Promise<CtxCompras | ErroCompras> {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') return { error: 'Compras pelo app só existem na loja de estoque próprio.' }
  const tem = await Promise.all(permissoes.map((p) => requirePermissao(lojaId, p)))
  if (modo === 'todas' ? tem.some((x) => !x) : !tem.some(Boolean)) return { error: 'Sem permissão' }
  const perfil = await getProfile()
  return { lojaId, userId: perfil.id, nome: perfil.name }
}

/** As funções do banco levantam as regras de negócio com errcode 22023 e mensagem em português; erro técnico não vaza. */
export function msgErroCompras(onde: string, e: { message?: string; code?: string } | null | undefined): string {
  if (e?.code === '22023' && e.message) return e.message
  console.error(`${onde}:`, e?.message)
  return 'Não foi possível concluir agora. Tente de novo; se continuar, avise o suporte.'
}
