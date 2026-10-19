// Anexos (Fase G [O2], migration 221): conferências comuns às rotas /api/anexos e à action de excluir.
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { anexosPermitidos, ENTIDADES_ANEXO, type EntidadeAnexo } from './anexos-puro'

export const BUCKET_ANEXOS = 'anexos'

/** Permissão para VER o registro (quem vê o registro vê os anexos dele). */
const PERMISSAO_VER: Record<EntidadeAnexo, string[]> = {
  produto: ['Produtos'],
  nota_entrada: ['Notas Fiscais'],
  pedido_compra: ['Compras - Pedidos', 'Compras - Aprovar pedidos'],
  op: ['Ordens de Producao'],
}

export function ehEntidadeAnexo(v: unknown): v is EntidadeAnexo {
  return typeof v === 'string' && (ENTIDADES_ANEXO as readonly string[]).includes(v)
}

export async function podeVerEntidade(lojaId: number, entidade: EntidadeAnexo): Promise<boolean> {
  for (const p of PERMISSAO_VER[entidade]) if (await requirePermissao(lojaId, p)) return true
  return false
}

/** O registro existe nesta loja? (nunca anexa a registro de outra loja nem a id inventado) */
export async function registroExiste(lojaId: number, entidade: EntidadeAnexo, entidadeId: string): Promise<boolean> {
  if (!/^\d{1,20}$/.test(entidadeId)) return false
  const sb = createServiceClient()
  const q =
    entidade === 'produto' ? sb.from('produtos').select('id').eq('loja_id', lojaId).eq('codigo_produto', entidadeId)
    : entidade === 'nota_entrada' ? sb.from('notas_fiscais').select('id').eq('loja_id', lojaId).eq('id', entidadeId).is('deleted_at', null)
    : entidade === 'pedido_compra' ? sb.from('pedidos_compra').select('id').eq('loja_id', lojaId).eq('id', entidadeId)
    : sb.from('ordens_producao').select('id').eq('loja_id', lojaId).eq('id', entidadeId)
  const { data, error } = await q.limit(1)
  return !error && (data?.length ?? 0) > 0
}

export type ContextoAnexo = { lojaId: number }

/** Loja atual, modo (só estoque próprio nesta fase) e permissão. Erro já em texto para a tela. */
export async function contextoAnexo(entidade: EntidadeAnexo, acao: 'ver' | 'enviar' | 'excluir'): Promise<ContextoAnexo | { error: string; status: number }> {
  const lojaId = await getCurrentLojaId()
  if (!anexosPermitidos(await modoDaLoja(lojaId))) return { error: 'Anexos ainda não estão disponíveis para esta loja.', status: 403 }
  if (!(await podeVerEntidade(lojaId, entidade))) return { error: 'Sem permissão', status: 403 }
  if (acao === 'enviar' && !(await requirePermissao(lojaId, 'Anexos - Enviar'))) return { error: 'Sem permissão para enviar anexos', status: 403 }
  if (acao === 'excluir' && !(await requirePermissao(lojaId, 'Anexos - Excluir'))) return { error: 'Sem permissão para excluir anexos', status: 403 }
  return { lojaId }
}
