import { notFound } from 'next/navigation'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { exigirDev } from '@/lib/recursos-dev'
import type { SituacaoTitulo, StatusTitulo } from './titulo-puro'

// Leitura do financeiro (migrations 285/286) para as telas. Sempre pelo servidor, com o service role, DEPOIS de checar:
// desenvolvedor, loja de estoque próprio e permissão. Nenhum cliente acessa as tabelas fin_* direto.

export const PERM = {
  contasPagar: 'Financeiro - Contas a pagar',
  pagar: 'Financeiro - Contas a pagar - Pagar',
  contasCorrentes: 'Financeiro - Contas correntes',
  categorias: 'Financeiro - Categorias',
} as const

/** Porta de entrada de toda página do financeiro: 404 para quem não é dev, loja não-própria ou sem permissão. */
export async function acessoFinanceiro(permissao: string): Promise<{ lojaId: number; podePagar: boolean }> {
  await exigirDev()
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  if (!(await requirePermissao(lojaId, permissao))) notFound()
  const podePagar = permissao === PERM.contasPagar ? await requirePermissao(lojaId, PERM.pagar) : false
  return { lojaId, podePagar }
}

export type ContaCorrente = {
  id: number; nome: string; tipo: 'caixa' | 'banco' | 'outro'; banco: string | null; agencia: string | null; numero_conta: string | null
  saldo_inicial: number; data_saldo_inicial: string; ativa: boolean; observacao: string | null; saldo_atual: number; lancamentos: number
}
export type Categoria = {
  id: number; codigo: string | null; nome: string; tipo: 'despesa' | 'receita'; grupo_dre: string
  categoria_contabil_id: number | null; ativa: boolean
}
export type Titulo = {
  id: number; numero: number; fornecedor_id: number; fornecedor_nome: string; documento: string | null; parcela: number; total_parcelas: number
  valor: number; valor_quitado: number; restante: number; data_emissao: string | null; data_vencimento: string; data_competencia: string
  categoria_id: number | null; categoria_nome: string | null; observacao: string | null; status: StatusTitulo; situacao: SituacaoTitulo
  data_quitacao: string | null; origem_tipo: string; origem_id: number | null
}
export type TotaisTitulos = { quantidade: number; valor_total: number; valor_pago: number; valor_restante: number; valor_atrasado: number; quantidade_atrasada: number }
export type LinhaExtrato = {
  id: number; data: string; tipo: 'entrada' | 'saida'; valor: number; descricao: string | null; origem_tipo: string
  origem_id: number | null; estorno_de: number | null; saldo_apos: number
}
export type PagamentoTitulo = {
  id: number; conta_id: number; conta_nome: string; data_pagamento: string; valor_principal: number; juros: number; desconto: number
  valor_pago: number; forma: string | null; observacao: string | null; criado_por_nome: string | null; created_at: string
  estornado_em: string | null; estornado_por_nome: string | null; motivo_estorno: string | null
}
export type DetalheTitulo = {
  titulo: Titulo & { cancelado_em: string | null; motivo_cancelamento: string | null; cancelado_por_nome: string | null; criado_por_nome: string | null }
  pagamentos: PagamentoTitulo[]
  eventos: { tipo: string; detalhe: Record<string, unknown>; user_nome: string | null; created_at: string }[]
}

const n = (v: unknown) => Number(v ?? 0)
// Só "função/tabela não existe" (migration não aplicada) vira aviso de "não ativado"; qualquer outro erro é real.
const FALTA_MIGRATION = new Set(['PGRST202', 'PGRST205', '42883', '42P01'])
export const semMigration = (e: { code?: string } | null | undefined) => !!e?.code && FALTA_MIGRATION.has(e.code)

export async function listarContas(lojaId: number): Promise<{ contas: ContaCorrente[]; semMigration: boolean }> {
  const { data, error } = await createServiceClient().rpc('fin_contas_saldo', { p_loja: lojaId })
  if (error) if (!semMigration(error)) console.error('financeiro: fin_contas_saldo', error.message, error.code)
  return { contas: [], semMigration: semMigration(error) }
  const contas = ((data ?? []) as ContaCorrente[]).map((c) => ({ ...c, saldo_inicial: n(c.saldo_inicial), saldo_atual: n(c.saldo_atual), lancamentos: n(c.lancamentos) }))
  return { contas, semMigration: false }
}

export async function listarCategorias(lojaId: number): Promise<Categoria[]> {
  const { data, error } = await createServiceClient().from('fin_categorias').select('id, codigo, nome, tipo, grupo_dre, categoria_contabil_id, ativa')
    .eq('loja_id', lojaId).order('tipo', { ascending: false }).order('nome')
  if (error) {
    if (semMigration(error)) return [] // a própria página mostra o aviso de "não ativado"
    throw new Error(`Não foi possível carregar as categorias financeiras: ${error.message}`)
  }
  return (data ?? []) as Categoria[]
}

export async function listarCategoriasContabeis(lojaId: number): Promise<{ id: number; nome: string }[]> {
  const { data } = await createServiceClient().from('categorias_contabeis').select('id, nome').eq('loja_id', lojaId).eq('ativa', true).order('nome')
  return (data ?? []) as { id: number; nome: string }[]
}

export async function listarFornecedores(lojaId: number): Promise<{ id: number; nome: string }[]> {
  const out: { id: number; nome: string }[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await createServiceClient().from('fornecedores').select('id, razao_social, nome_fantasia')
      .eq('loja_id', lojaId).eq('inativo', false).order('razao_social').order('id').range(from, from + 999)
    if (error) throw new Error(`Não foi possível carregar os fornecedores: ${error.message}`)
    for (const f of data ?? []) out.push({ id: Number(f.id), nome: String(f.nome_fantasia || f.razao_social) })
    if (!data || data.length < 1000) break
  }
  return out
}

export type FiltrosTitulos = { venc_de?: string; venc_ate?: string; fornecedor_id?: number; categoria_id?: number; situacao?: string; q?: string }

export async function listarTitulos(lojaId: number, filtros: FiltrosTitulos, hoje: string, limite: number, offset: number):
  Promise<{ itens: Titulo[]; totais: TotaisTitulos; erro: string | null }> {
  const vazio: TotaisTitulos = { quantidade: 0, valor_total: 0, valor_pago: 0, valor_restante: 0, valor_atrasado: 0, quantidade_atrasada: 0 }
  const { data, error } = await createServiceClient().rpc('fin_titulos_pagar_listar', {
    p_loja: lojaId, p_filtros: filtros, p_limite: limite, p_offset: offset, p_hoje: hoje,
  })
  if (error) return { itens: [], totais: vazio, erro: semMigration(error) ? 'O contas a pagar ainda não foi ativado nesta instalação (migrations 285 e 286).' : 'Não foi possível carregar os títulos.' }
  const r = data as { itens: Titulo[]; totais: TotaisTitulos }
  const itens = (r.itens ?? []).map((t) => ({ ...t, valor: n(t.valor), valor_quitado: n(t.valor_quitado), restante: n(t.restante) }))
  const t = r.totais ?? vazio
  return {
    itens,
    totais: { quantidade: n(t.quantidade), valor_total: n(t.valor_total), valor_pago: n(t.valor_pago), valor_restante: n(t.valor_restante), valor_atrasado: n(t.valor_atrasado), quantidade_atrasada: n(t.quantidade_atrasada) },
    erro: null,
  }
}

export async function detalheTitulo(lojaId: number, id: number, hoje: string): Promise<DetalheTitulo | null> {
  const { data } = await createServiceClient().rpc('fin_titulo_pagar_detalhe', { p_loja: lojaId, p_id: id, p_hoje: hoje })
  if (!data) return null
  const d = data as DetalheTitulo
  return {
    titulo: { ...d.titulo, valor: n(d.titulo.valor), valor_quitado: n(d.titulo.valor_quitado), restante: n(d.titulo.restante) },
    pagamentos: (d.pagamentos ?? []).map((p) => ({ ...p, valor_principal: n(p.valor_principal), juros: n(p.juros), desconto: n(p.desconto), valor_pago: n(p.valor_pago) })),
    eventos: d.eventos ?? [],
  }
}

export async function extratoConta(lojaId: number, contaId: number, de: string | null, ate: string | null):
  Promise<{ saldoAnterior: number; saldoFinal: number; itens: LinhaExtrato[] } | null> {
  const { data, error } = await createServiceClient().rpc('fin_extrato', { p_loja: lojaId, p_conta: contaId, p_de: de, p_ate: ate })
  if (error || !data) return null
  const r = data as { saldo_anterior: number; saldo_final: number; itens: LinhaExtrato[] }
  return {
    saldoAnterior: n(r.saldo_anterior), saldoFinal: n(r.saldo_final),
    itens: (r.itens ?? []).map((i) => ({ ...i, valor: n(i.valor), saldo_apos: n(i.saldo_apos) })),
  }
}
