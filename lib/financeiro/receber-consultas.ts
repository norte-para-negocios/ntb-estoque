import type { SupabaseClient } from '@supabase/supabase-js'
// @ts-expect-error: o import com extensão .ts é exigido pelo node --test (type stripping); o tsc do Next não o aceita
import { FORMAS_RECEBIMENTO, situacaoReceber, type FormaRecebimento, type SituacaoReceber, type StatusReceber } from './receber-vendas-puro.ts'

// Leitura das contas a receber das vendas (migration 380). Recebe o cliente por parâmetro (testado com cliente falso em
// receber-consultas.test.ts). As telas usam os atalhos de lib/financeiro/dados.ts, depois de acessoFinanceiro.
export type Db = Pick<SupabaseClient, 'rpc' | 'from'>

export type FormaCadastro = {
  forma: FormaRecebimento; cadastrada: boolean; id: number | null; adquirente: string | null; taxa_percentual: number; taxa_fixa: number
  prazo_dias: number; dias_uteis: boolean; conta_id: number | null; observacao: string | null
}
export type TituloReceber = {
  id: number; data_venda: string; forma: FormaRecebimento; adquirente: string | null; quantidade: number; valor_bruto: number
  taxa_percentual: number; taxa_fixa: number; valor_taxa: number; valor_liquido: number; prazo_dias: number; dias_uteis: boolean
  data_prevista: string; conta_id: number | null; conta_nome: string | null; configurar: boolean; status: StatusReceber
  situacao: SituacaoReceber; valor_recebido: number | null; data_recebimento: string | null; diferenca: number | null
  recebimento_id: number | null; motivo_cancelamento: string | null
}
export type TotaisReceber = {
  quantidade: number; bruto: number; taxa: number; liquido: number; a_receber: number; atrasado: number; recebido: number
  diferenca: number; configurar: number
}
export type FiltrosReceber = { venda_de?: string; venda_ate?: string; prevista_de?: string; prevista_ate?: string; forma?: string; situacao?: string }

const n = (v: unknown) => Number(v ?? 0)
const nOuNulo = (v: unknown) => (v === null || v === undefined ? null : Number(v))
// "função/tabela/coluna não existe" (migration 380 não aplicada) vira aviso; qualquer outro erro é real.
const FALTA_MIGRATION = new Set(['PGRST202', 'PGRST205', 'PGRST204', '42883', '42P01', '42703'])
const semMigration = (e: { code?: string } | null | undefined) => !!e?.code && FALTA_MIGRATION.has(e.code)
const SEM_380 = 'As contas a receber ainda não foram ativadas nesta instalação (migration 380).'

export async function listarFormasRecebimento(db: Db, lojaId: number): Promise<{ formas: FormaCadastro[]; semMigration: boolean }> {
  const { data, error } = await db.from('fin_formas_recebimento')
    .select('id, forma, adquirente, taxa_percentual, taxa_fixa, prazo_dias, dias_uteis, conta_id, observacao').eq('loja_id', lojaId)
  if (error) {
    if (semMigration(error)) return { formas: [], semMigration: true }
    throw new Error(`Não foi possível carregar as formas de recebimento: ${error.message}`)
  }
  const porForma = new Map(((data ?? []) as Record<string, unknown>[]).map((f) => [String(f.forma), f]))
  const formas = FORMAS_RECEBIMENTO.map((forma): FormaCadastro => {
    const f = porForma.get(forma)
    return {
      forma, cadastrada: !!f, id: f ? Number(f.id) : null, adquirente: (f?.adquirente as string | null) ?? null,
      taxa_percentual: n(f?.taxa_percentual), taxa_fixa: n(f?.taxa_fixa), prazo_dias: n(f?.prazo_dias), dias_uteis: f?.dias_uteis === true,
      conta_id: nOuNulo(f?.conta_id), observacao: (f?.observacao as string | null) ?? null,
    }
  })
  return { formas, semMigration: false }
}

export async function listarTitulosReceber(db: Db, lojaId: number, filtros: FiltrosReceber, hoje: string, limite: number, offset: number):
  Promise<{ itens: TituloReceber[]; totais: TotaisReceber; erro: string | null }> {
  const vazio: TotaisReceber = { quantidade: 0, bruto: 0, taxa: 0, liquido: 0, a_receber: 0, atrasado: 0, recebido: 0, diferenca: 0, configurar: 0 }
  const { data, error } = await db.rpc('fin_titulos_receber_listar', { p_loja: lojaId, p_filtros: filtros, p_limite: limite, p_offset: offset, p_hoje: hoje })
  if (error && !semMigration(error)) console.error('financeiro: fin_titulos_receber_listar', error.code, error.message)
  if (error) return { itens: [], totais: vazio, erro: semMigration(error) ? SEM_380 : 'Não foi possível carregar as contas a receber.' }
  const r = (data ?? {}) as { itens?: Record<string, unknown>[]; totais?: Record<string, unknown> }
  const itens = (r.itens ?? []).map((t): TituloReceber => ({
    ...(t as unknown as TituloReceber),
    quantidade: n(t.quantidade), valor_bruto: n(t.valor_bruto), taxa_percentual: n(t.taxa_percentual), taxa_fixa: n(t.taxa_fixa),
    valor_taxa: n(t.valor_taxa), valor_liquido: n(t.valor_liquido), prazo_dias: n(t.prazo_dias),
    valor_recebido: nOuNulo(t.valor_recebido), diferenca: nOuNulo(t.diferenca), recebimento_id: nOuNulo(t.recebimento_id),
    conta_id: nOuNulo(t.conta_id), conta_nome: (t.conta_nome as string | null) ?? null,
    situacao: situacaoReceber(t.status as StatusReceber, String(t.data_prevista), hoje),
  }))
  const tt = r.totais ?? {}
  const totais = Object.fromEntries(Object.keys(vazio).map((k) => [k, n(tt[k])])) as TotaisReceber
  return { itens, totais, erro: null }
}

/** Chave lojas.fin_cr_vendas_ativo. Sem a coluna (380 não aplicada) = desligada, com aviso. */
export async function chaveLigada(db: Db, lojaId: number): Promise<{ ligada: boolean; semMigration: boolean }> {
  const { data, error } = await db.from('lojas').select('fin_cr_vendas_ativo').eq('id', lojaId).maybeSingle()
  if (error) {
    if (semMigration(error)) return { ligada: false, semMigration: true }
    throw new Error(`Não foi possível ler a chave da loja: ${error.message}`)
  }
  return { ligada: (data as { fin_cr_vendas_ativo?: boolean } | null)?.fin_cr_vendas_ativo === true, semMigration: false }
}
