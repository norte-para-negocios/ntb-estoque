import type { SupabaseClient } from '@supabase/supabase-js'
import type { SituacaoTitulo, StatusTitulo } from './titulo-puro'
import type { Aprovacao, ConfigFinanceiro } from './aprovacao-puro'
import type { Periodicidade } from './recorrentes-puro'

// Consultas de leitura do financeiro (migrations 285/286). Recebem o cliente por parâmetro (sem imports do Next) para serem testadas
// com um cliente falso: lib/financeiro/consultas.test.ts. As telas usam os atalhos de lib/financeiro/dados.ts.
export type Db = Pick<SupabaseClient, 'rpc' | 'from'>

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
  titulo: Titulo & { cancelado_em: string | null; motivo_cancelamento: string | null; cancelado_por_nome: string | null; criado_por_nome: string | null
    // 370 (ausentes enquanto a migration não for aplicada)
    aprovacao?: Aprovacao; aprovacao_nivel?: number; aprovacao_em?: string | null; aprovacao_por_nome?: string | null; aprovacao_motivo?: string | null
    valor_a_confirmar?: boolean }
  pagamentos: PagamentoTitulo[]
  eventos: { tipo: string; detalhe: Record<string, unknown>; user_nome: string | null; created_at: string }[]
}

const n = (v: unknown) => Number(v ?? 0)
// Só "função/tabela não existe" (migration não aplicada) vira aviso de "não ativado"; qualquer outro erro é real.
const FALTA_MIGRATION = new Set(['PGRST202', 'PGRST205', '42883', '42P01'])
export const semMigration = (e: { code?: string } | null | undefined) => !!e?.code && FALTA_MIGRATION.has(e.code)

export async function listarContas(db: Db, lojaId: number): Promise<{ contas: ContaCorrente[]; semMigration: boolean }> {
  const { data, error } = await db.rpc('fin_contas_saldo', { p_loja: lojaId })
  if (error) {
    if (semMigration(error)) return { contas: [], semMigration: true } // a página mostra o aviso de "não ativado"
    throw new Error(`Não foi possível carregar as contas correntes: ${error.message}`)
  }
  const contas = ((data ?? []) as ContaCorrente[]).map((c) => ({ ...c, saldo_inicial: n(c.saldo_inicial), saldo_atual: n(c.saldo_atual), lancamentos: n(c.lancamentos) }))
  return { contas, semMigration: false }
}

export async function listarCategorias(db: Db, lojaId: number): Promise<Categoria[]> {
  const { data, error } = await db.from('fin_categorias').select('id, codigo, nome, tipo, grupo_dre, categoria_contabil_id, ativa')
    .eq('loja_id', lojaId).order('tipo', { ascending: false }).order('nome')
  if (error) {
    if (semMigration(error)) return [] // a própria página mostra o aviso de "não ativado"
    throw new Error(`Não foi possível carregar as categorias financeiras: ${error.message}`)
  }
  return (data ?? []) as Categoria[]
}

export async function listarCategoriasContabeis(db: Db, lojaId: number): Promise<{ id: number; nome: string }[]> {
  const { data, error } = await db.from('categorias_contabeis').select('id, nome').eq('loja_id', lojaId).eq('ativa', true).order('nome')
  if (error) throw new Error(`Não foi possível carregar as categorias contábeis: ${error.message}`)
  return (data ?? []) as { id: number; nome: string }[]
}

export async function listarFornecedores(db: Db, lojaId: number): Promise<{ id: number; nome: string }[]> {
  const out: { id: number; nome: string }[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('fornecedores').select('id, razao_social, nome_fantasia')
      .eq('loja_id', lojaId).eq('inativo', false).order('razao_social').order('id').range(from, from + 999)
    if (error) throw new Error(`Não foi possível carregar os fornecedores: ${error.message}`)
    for (const f of data ?? []) out.push({ id: Number(f.id), nome: String(f.nome_fantasia || f.razao_social) })
    if (!data || data.length < 1000) break
  }
  return out
}

export type FiltrosTitulos = { venc_de?: string; venc_ate?: string; fornecedor_id?: number; categoria_id?: number; situacao?: string; q?: string }

export async function listarTitulos(db: Db, lojaId: number, filtros: FiltrosTitulos, hoje: string, limite: number, offset: number):
  Promise<{ itens: Titulo[]; totais: TotaisTitulos; erro: string | null }> {
  const vazio: TotaisTitulos = { quantidade: 0, valor_total: 0, valor_pago: 0, valor_restante: 0, valor_atrasado: 0, quantidade_atrasada: 0 }
  const { data, error } = await db.rpc('fin_titulos_pagar_listar', {
    p_loja: lojaId, p_filtros: filtros, p_limite: limite, p_offset: offset, p_hoje: hoje,
  })
  if (error && !semMigration(error)) console.error('financeiro: fin_titulos_pagar_listar', error.code, error.message)
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

export async function detalheTitulo(db: Db, lojaId: number, id: number, hoje: string): Promise<DetalheTitulo | null> {
  const { data, error } = await db.rpc('fin_titulo_pagar_detalhe', { p_loja: lojaId, p_id: id, p_hoje: hoje })
  if (error) {
    if (semMigration(error)) return null
    throw new Error(`Não foi possível carregar o título: ${error.message}`)
  }
  if (!data) return null
  const d = data as DetalheTitulo
  return {
    titulo: { ...d.titulo, valor: n(d.titulo.valor), valor_quitado: n(d.titulo.valor_quitado), restante: n(d.titulo.restante) },
    pagamentos: (d.pagamentos ?? []).map((p) => ({ ...p, valor_principal: n(p.valor_principal), juros: n(p.juros), desconto: n(p.desconto), valor_pago: n(p.valor_pago) })),
    eventos: d.eventos ?? [],
  }
}

export async function extratoConta(db: Db, lojaId: number, contaId: number, de: string | null, ate: string | null):
  Promise<{ saldoAnterior: number; saldoFinal: number; itens: LinhaExtrato[] } | null> {
  const { data, error } = await db.rpc('fin_extrato', { p_loja: lojaId, p_conta: contaId, p_de: de, p_ate: ate })
  if (error) {
    if (semMigration(error) || error.code === '22023') return null // sem migration, ou conta que não é desta loja
    throw new Error(`Não foi possível carregar o extrato: ${error.message}`)
  }
  if (!data) return null
  const r = data as { saldo_anterior: number; saldo_final: number; itens: LinhaExtrato[] }
  return {
    saldoAnterior: n(r.saldo_anterior), saldoFinal: n(r.saldo_final),
    itens: (r.itens ?? []).map((i) => ({ ...i, valor: n(i.valor), saldo_apos: n(i.saldo_apos) })),
  }
}

// ------------------------------------------------------------------- contas a pagar geradas pela nota de entrada (340)
export type TituloNota = {
  id: number; numero: number; parcela: number; total_parcelas: number; valor: number; valor_quitado: number
  data_vencimento: string; status: StatusTitulo; motivo_cancelamento: string | null
  categoria_id?: number | null; categoria_nome?: string | null
}

/** Contas a pagar de uma nota (origem 'nota_entrada') e o motivo da última falha de geração, se a última notícia for falha. */
export async function titulosDaNota(db: Db, lojaId: number, notaId: number):
  Promise<{ titulos: TituloNota[]; falha: string | null; semMigration: boolean }> {
  const { data, error } = await db.from('fin_titulos_pagar')
    .select('id, numero, parcela, total_parcelas, valor, valor_quitado, data_vencimento, status, motivo_cancelamento, categoria_id')
    .eq('loja_id', lojaId).eq('origem_tipo', 'nota_entrada').eq('origem_id', notaId).order('parcela').order('id')
  if (error) {
    if (semMigration(error)) return { titulos: [], falha: null, semMigration: true }
    throw new Error(`Não foi possível carregar as contas a pagar da nota: ${error.message}`)
  }
  const { data: ev, error: ee } = await db.from('fin_eventos').select('tipo, detalhe')
    .eq('loja_id', lojaId).eq('entidade', 'nota_entrada').eq('entidade_id', notaId).order('id', { ascending: false }).limit(1)
  if (ee && !semMigration(ee)) throw new Error(`Não foi possível carregar o histórico da nota: ${ee.message}`)
  const ultimo = ((ev ?? []) as { tipo: string; detalhe: { erro?: string } }[])[0]
  const ids = [...new Set(((data ?? []) as TituloNota[]).map((t) => t.categoria_id).filter((c): c is number => c != null))]
  const nomes = new Map<number, string>()
  if (ids.length) {
    const { data: cats, error: ec } = await db.from('fin_categorias').select('id, nome').eq('loja_id', lojaId).in('id', ids)
    if (ec) throw new Error(`Não foi possível carregar as categorias da nota: ${ec.message}`)
    for (const c of (cats ?? []) as { id: number; nome: string }[]) nomes.set(n(c.id), String(c.nome))
  }
  const titulos = ((data ?? []) as TituloNota[]).map((t) => ({
    ...t, valor: n(t.valor), valor_quitado: n(t.valor_quitado), categoria_id: t.categoria_id ?? null,
    categoria_nome: t.categoria_id != null ? nomes.get(n(t.categoria_id)) ?? null : null,
  }))
  return { titulos, falha: ultimo?.tipo === 'titulos_falha' ? String(ultimo.detalhe?.erro ?? 'erro desconhecido') : null, semMigration: false }
}

// ------------------------------------------------------------- decisões do dono de 05/11 (migration 360)
export type FamiliaCategoria = {
  codigo_familia: number; nome: string; inativa: boolean; produtos: number; categoria_id: number | null; categoria_nome: string | null; categoria_ok: boolean
}

/** Famílias da loja com a categoria financeira ligada (mapa família → categoria, tela só dev). */
export async function listarFamiliasCategoria(db: Db, lojaId: number): Promise<{ familias: FamiliaCategoria[]; semMigration: boolean }> {
  const { data, error } = await db.rpc('fin_familia_categoria_listar', { p_loja: lojaId })
  if (error) {
    if (semMigration(error)) return { familias: [], semMigration: true }
    throw new Error(`Não foi possível carregar as famílias: ${error.message}`)
  }
  const familias = ((data ?? []) as FamiliaCategoria[]).map((f) => ({
    codigo_familia: n(f.codigo_familia), nome: String(f.nome), inativa: !!f.inativa, produtos: n(f.produtos),
    categoria_id: f.categoria_id == null ? null : n(f.categoria_id), categoria_nome: f.categoria_nome ?? null, categoria_ok: !!f.categoria_ok,
  }))
  return { familias, semMigration: false }
}

export type ParcelaPrevista = { parcela: number; total: number; vencimento: string; valor: number }
export type NotaSemConta = {
  loja_id: number; loja_nome: string; chave_ligada: boolean; nota_id: number; compra_id: number; numero: string | null
  fornecedor_nome: string | null; fornecedor_cnpj: string | null; emissao: string | null; data_entrada: string | null; valor_total: number
  status_compra: string; regra: string; parcelas: ParcelaPrevista[]; categoria_id: number | null; categoria_nome: string | null
  familia_nome: string | null; motivo_categoria: string | null; ultima_falha: string | null
}

/** Notas de entrada confirmadas de loja própria sem conta a pagar (p_loja null = todas as lojas próprias). */
export async function notasSemConta(db: Db, lojaId: number | null): Promise<{ notas: NotaSemConta[]; semMigration: boolean }> {
  const { data, error } = await db.rpc('fin_notas_sem_conta', { p_loja: lojaId, p_limite: 2000 })
  if (error) {
    if (semMigration(error)) return { notas: [], semMigration: true }
    throw new Error(`Não foi possível carregar as notas sem conta a pagar: ${error.message}`)
  }
  const notas = ((data ?? []) as NotaSemConta[]).map((x) => ({
    ...x, loja_id: n(x.loja_id), nota_id: n(x.nota_id), compra_id: n(x.compra_id), valor_total: n(x.valor_total),
    categoria_id: x.categoria_id == null ? null : n(x.categoria_id),
    parcelas: (x.parcelas ?? []).map((p) => ({ parcela: n(p.parcela), total: n(p.total), vencimento: String(p.vencimento), valor: n(p.valor) })),
  }))
  return { notas, semMigration: false }
}

export type PendenciaNotaDesfeita = {
  titulo_id: number; numero: number; nota_id: number; documento: string | null; fornecedor_nome: string; parcela: number; total_parcelas: number
  valor: number; valor_quitado: number; data_vencimento: string; status: string; status_compra: string | null; desfeita_em: string; pagamentos: number
}

/** Contas pagas (no todo ou em parte) de notas cuja entrada foi desfeita, esperando a decisão do gerente. */
export async function pendenciasNotaDesfeita(db: Db, lojaId: number): Promise<{ pendencias: PendenciaNotaDesfeita[]; semMigration: boolean }> {
  const { data, error } = await db.rpc('fin_pendencias_nota_desfeita', { p_loja: lojaId })
  if (error) {
    if (semMigration(error)) return { pendencias: [], semMigration: true }
    throw new Error(`Não foi possível carregar as contas de notas desfeitas: ${error.message}`)
  }
  const pendencias = ((data ?? []) as PendenciaNotaDesfeita[]).map((p) => ({
    ...p, titulo_id: n(p.titulo_id), numero: n(p.numero), nota_id: n(p.nota_id), parcela: n(p.parcela), total_parcelas: n(p.total_parcelas),
    valor: n(p.valor), valor_quitado: n(p.valor_quitado), pagamentos: n(p.pagamentos),
  }))
  return { pendencias, semMigration: false }
}

// ------------------------------------------------- Fase 4 passo 2 (migration 370): aprovação, recorrentes, avulsos e transferências

// Mesmo valor de CONFIG_PADRAO (aprovacao-puro.ts; o teste confere): módulo lido pelo node --test não importa valor de outro módulo.
const CONFIG_PADRAO_LOCAL: ConfigFinanceiro = { ativa: false, ateCent: 1000_00, altoAcimaCent: 5000_00, autorPodeAprovar: true, recorrentesDias: 45 }
const cent = (v: unknown) => Math.round(Number(v ?? 0) * 100)

export async function lerConfigFinanceiro(db: Db, lojaId: number): Promise<{
  config: ConfigFinanceiro; salva: boolean; atualizadoPor: string | null; atualizadoEm: string | null; semMigration: boolean
}> {
  const { data, error } = await db.rpc('fin_config_ler', { p_loja: lojaId })
  if (error) {
    if (semMigration(error)) return { config: { ...CONFIG_PADRAO_LOCAL }, salva: false, atualizadoPor: null, atualizadoEm: null, semMigration: true }
    throw new Error(`Não foi possível carregar a configuração do financeiro: ${error.message}`)
  }
  const d = (data ?? {}) as Record<string, unknown>
  return {
    config: {
      ativa: !!d.aprovacao_ativa, ateCent: cent(d.aprovacao_ate), altoAcimaCent: cent(d.aprovacao_alto_acima),
      autorPodeAprovar: d.aprovacao_autor_pode_aprovar !== false, recorrentesDias: n(d.recorrentes_dias) || 45,
    },
    salva: !!d.salva, atualizadoPor: (d.atualizado_por_nome as string | null) ?? null, atualizadoEm: (d.updated_at as string | null) ?? null,
    semMigration: false,
  }
}

export type TituloAprovacao = {
  id: number; numero: number; fornecedor_nome: string; documento: string | null; parcela: number; total_parcelas: number; valor: number
  data_vencimento: string; categoria_nome: string | null; origem_tipo: string; origem_id: number | null; status: string; situacao: string
  aprovacao: Aprovacao; aprovacao_nivel: number; aprovacao_em: string | null; aprovacao_por_nome: string | null; aprovacao_motivo: string | null
  criado_por: string | null; criado_por_nome: string | null; valor_a_confirmar: boolean; observacao: string | null
}

export async function listarAprovacoes(db: Db, lojaId: number, situacao: 'pendente' | 'decididas'): Promise<{ itens: TituloAprovacao[]; semMigration: boolean }> {
  const { data, error } = await db.rpc('fin_titulos_aprovacao_listar', { p_loja: lojaId, p_situacao: situacao, p_limite: 500 })
  if (error) {
    if (semMigration(error)) return { itens: [], semMigration: true }
    throw new Error(`Não foi possível carregar as contas da aprovação: ${error.message}`)
  }
  const itens = ((data ?? []) as TituloAprovacao[]).map((t) => ({
    ...t, id: n(t.id), numero: n(t.numero), valor: n(t.valor), parcela: n(t.parcela), total_parcelas: n(t.total_parcelas),
    aprovacao_nivel: n(t.aprovacao_nivel), origem_id: t.origem_id == null ? null : n(t.origem_id), valor_a_confirmar: !!t.valor_a_confirmar,
  }))
  return { itens, semMigration: false }
}

export type Recorrente = {
  id: number; descricao: string; fornecedor_id: number; fornecedor_nome: string; categoria_id: number | null; categoria_nome: string | null
  documento: string | null; valor: number; valor_estimado: boolean; periodicidade: Periodicidade; dia: number; data_inicio: string
  data_fim: string | null; ativa: boolean; observacao: string | null; geradas: number; ultima_gerada: string | null; proxima: string | null
  ultima_falha: string | null
}

export async function listarRecorrentes(db: Db, lojaId: number, hoje: string): Promise<{ recorrentes: Recorrente[]; semMigration: boolean }> {
  const { data, error } = await db.rpc('fin_recorrentes_listar', { p_loja: lojaId, p_hoje: hoje })
  if (error) {
    if (semMigration(error)) return { recorrentes: [], semMigration: true }
    throw new Error(`Não foi possível carregar as contas recorrentes: ${error.message}`)
  }
  const recorrentes = ((data ?? []) as Recorrente[]).map((r) => ({
    ...r, id: n(r.id), fornecedor_id: n(r.fornecedor_id), categoria_id: r.categoria_id == null ? null : n(r.categoria_id), valor: n(r.valor),
    dia: n(r.dia), geradas: n(r.geradas), valor_estimado: !!r.valor_estimado, ativa: !!r.ativa,
  }))
  return { recorrentes, semMigration: false }
}

export type LancamentoAvulso = {
  id: number; data: string; tipo: 'entrada' | 'saida'; valor: number; descricao: string | null; conta_id: number; conta_nome: string
  categoria_id: number | null; categoria_nome: string | null; criado_por_nome: string | null; estorno_id: number | null; estorno_data: string | null
}
export type Transferencia = {
  id: number; data: string; valor: number; descricao: string | null; conta_origem_id: number; conta_origem_nome: string
  conta_destino_id: number; conta_destino_nome: string; criado_por_nome: string | null; estornada_em: string | null
  estornada_por_nome: string | null; motivo_estorno: string | null
}

export async function listarAvulsosTransferencias(db: Db, lojaId: number): Promise<{
  avulsos: LancamentoAvulso[]; transferencias: Transferencia[]; semMigration: boolean
}> {
  const { data, error } = await db.rpc('fin_avulsos_transferencias_listar', { p_loja: lojaId })
  if (error) {
    if (semMigration(error)) return { avulsos: [], transferencias: [], semMigration: true }
    throw new Error(`Não foi possível carregar os lançamentos e transferências: ${error.message}`)
  }
  const d = (data ?? {}) as { avulsos?: LancamentoAvulso[]; transferencias?: Transferencia[] }
  return {
    avulsos: (d.avulsos ?? []).map((l) => ({ ...l, id: n(l.id), valor: n(l.valor), conta_id: n(l.conta_id),
      categoria_id: l.categoria_id == null ? null : n(l.categoria_id), estorno_id: l.estorno_id == null ? null : n(l.estorno_id) })),
    transferencias: (d.transferencias ?? []).map((t) => ({ ...t, id: n(t.id), valor: n(t.valor), conta_origem_id: n(t.conta_origem_id),
      conta_destino_id: n(t.conta_destino_id) })),
    semMigration: false,
  }
}
