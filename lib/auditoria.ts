import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, getUser } from '@/lib/auth'

export type AcaoAuditoria = 'criar' | 'editar' | 'excluir'

/**
 * Registra uma acao na trilha de auditoria (quem fez o que, quando, em qual loja).
 * Best-effort: NUNCA derruba a operacao principal se o log falhar. Chamar nas server
 * actions de mutacao DEPOIS da acao dar certo.
 *
 * descricao: rotulo legivel do registro (ex.: "Acucar Cristal (80095)") para a tela
 * de auditoria nao precisar de joins.
 */
export async function registrarAuditoria(
  acao: AcaoAuditoria,
  entidade: string,
  entidadeId: string | number | null,
  descricao?: string | null
): Promise<void> {
  try {
    const lojaId = await getCurrentLojaId()
    const user = await getUser()
    const supabase = createServiceClient()
    // Nome do usuario (profiles) gravado junto, para a tela nao depender de join.
    let userNome: string | null = null
    if (user?.id) {
      const { data } = await supabase.from('profiles').select('name').eq('id', user.id).maybeSingle()
      userNome = data?.name ?? null
    }
    await supabase.from('audit_log').insert({
      loja_id: lojaId,
      user_id: user?.id ?? null,
      user_nome: userNome,
      acao,
      entidade,
      entidade_id: entidadeId != null ? String(entidadeId) : null,
      descricao: descricao ?? null,
    })
  } catch {
    // Auditoria e secundaria: nunca quebra a operacao principal.
  }
}
