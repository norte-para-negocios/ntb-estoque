import { createClient } from '@/lib/supabase/server'
import { requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { anexosPermitidos, type EntidadeAnexo } from '@/lib/anexos/anexos-puro'
import { AnexosLista, type AnexoLinha } from './AnexosLista'
import { tabelaAusente } from '@/lib/supabase/tabela-ausente'

/** Seção "Anexos" de um registro (Fase G [O2]). Só estoque próprio nesta fase; some sem a migration 221. */
export async function AnexosRegistro({ lojaId, entidade, entidadeId }: { lojaId: number; entidade: EntidadeAnexo; entidadeId: number | string }) {
  if (!anexosPermitidos(await modoDaLoja(lojaId))) return null
  const supabase = await createClient()
  const { data, error } = await supabase.from('anexos')
    .select('id, nome_arquivo, tipo_mime, tamanho, enviado_por_nome, created_at')
    .eq('loja_id', lojaId).eq('entidade', entidade).eq('entidade_id', String(entidadeId)).is('excluido_em', null)
    .order('id', { ascending: false })
  if (error) {
    if (!tabelaAusente(error)) console.error('AnexosRegistro: falha ao listar', error.message)
    return null
  }
  const [podeEnviar, podeExcluir] = await Promise.all([requirePermissao(lojaId, 'Anexos - Enviar'), requirePermissao(lojaId, 'Anexos - Excluir')])
  const anexos: AnexoLinha[] = (data ?? []).map((a) => ({
    id: Number(a.id), nome: a.nome_arquivo as string, mime: a.tipo_mime as string, tamanho: Number(a.tamanho),
    enviadoPor: (a.enviado_por_nome as string | null) ?? null, em: a.created_at as string,
  }))
  return (
    <section className="rounded-[var(--r-lg)] bg-surface p-5 shadow-[var(--shadow-sm)]">
      <h2 className="mb-3 text-[17px] font-semibold text-text">Anexos{anexos.length ? <span className="ml-1.5 text-[13px] font-normal text-text-muted">{anexos.length}</span> : null}</h2>
      <AnexosLista entidade={entidade} entidadeId={String(entidadeId)} anexos={anexos} podeEnviar={podeEnviar} podeExcluir={podeExcluir} />
    </section>
  )
}
