// Leitura do histórico de alterações (migration 220) pela sessão do usuário: a RLS da tabela limita à loja dele.
import { createClient } from '@/lib/supabase/server'
import type { LinhaHistorico } from './historico-puro'
import type { EntidadeHistorico } from './rotulos'
import { tabelaAusente } from '@/lib/supabase/tabela-ausente'

export const LIMITE_HISTORICO = 2000

export async function carregarHistorico(
  lojaId: number,
  entidade: EntidadeHistorico,
  ids: (string | number)[],
): Promise<{ linhas: LinhaHistorico[]; erro: string | null; cortado: boolean }> {
  const lista = [...new Set(ids.map(String))].filter(Boolean)
  if (!lista.length) return { linhas: [], erro: null, cortado: false }
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('historico_alteracoes')
    .select('id, tabela, linha, operacao, campo, valor_de, valor_para, autor_nome, origem, txid, created_at')
    .eq('loja_id', lojaId)
    .eq('entidade', entidade)
    .in('entidade_id', lista)
    .order('id', { ascending: false })
    .limit(LIMITE_HISTORICO)
  if (error) {
    // tabela ainda não existe (migration 220 não aplicada ou cache do PostgREST velho): a tela mostra "ainda não ativado"
    return { linhas: [], erro: tabelaAusente(error) ? 'nao_ativado' : error.message, cortado: false }
  }
  const linhas = (data ?? []).map((r) => ({ ...r, txid: Number(r.txid), id: Number(r.id) })) as LinhaHistorico[]
  return { linhas, erro: null, cortado: linhas.length === LIMITE_HISTORICO }
}
