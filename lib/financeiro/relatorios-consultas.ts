import type { SupabaseClient } from '@supabase/supabase-js'
// @ts-expect-error: o import com extensão .ts é exigido pelo node --test (type stripping); o tsc do Next não o aceita
import { listarContas, listarRecorrentes } from './consultas.ts'
// @ts-expect-error: idem
import { fimDoMes, inicioDoMes, mesclarTaxasCartao } from './dre-puro.ts'
import type { EntradaDre, LancamentoDre, Mes, TituloDre, VendaMes } from './dre-puro'
import type { ContaCorrente, Recorrente } from './consultas'
import type { EntradaFluxo, LancamentoFluxo, PagarFluxo, ReceberFluxo, Agrupar } from './fluxo-caixa-puro'

// Leituras da DRE e do fluxo de caixa (Fase 4 passo 5). Só leitura, sempre com o cliente de serviço DEPOIS de
// acessoFinanceiro (lib/financeiro/dados.ts). Recebem o cliente por parâmetro: testadas com cliente falso em
// relatorios-consultas.test.ts. Erro de banco é lançado (a tela mostra), nunca vira "zero"; só "migration não aplicada"
// (380 nas contas a receber) vira aviso.
export type Db = Pick<SupabaseClient, 'rpc' | 'from'>

const n = (v: unknown) => Number(v ?? 0)
const FALTA_MIGRATION = new Set(['PGRST202', 'PGRST205', 'PGRST204', '42883', '42P01', '42703'])
const semMigration = (e: { code?: string } | null | undefined) => !!e?.code && FALTA_MIGRATION.has(e.code)
type Resp = { data: unknown; error: { code?: string; message: string } | null }

/** Lê todas as páginas (1.000 por vez; a consulta tem de vir com ordem total). Erro = exceção com o que falhou. */
async function todas<T>(pagina: (de: number, ate: number) => PromiseLike<Resp>, oque: string): Promise<T[]> {
  const out: T[] = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await pagina(de, de + 999)
    if (error) throw Object.assign(new Error(`Não foi possível ler ${oque}: ${error.message}`), { code: error.code })
    const linhas = (data ?? []) as T[]
    out.push(...linhas)
    if (linhas.length < 1000) return out
  }
}

/** Tudo que a DRE de uma loja precisa, nos meses pedidos. Vendas e CMV = lucro_proprio (a fonte do /relatorio-cmv). */
export async function lerEntradaDreLoja(db: Db, lojaId: number, meses: Mes[]): Promise<{ entrada: Omit<EntradaDre, 'meses' | 'nomesLojas'>; avisos: string[] }> {
  const ini = inicioDoMes(meses[0])
  const fim = fimDoMes(meses[meses.length - 1])
  const avisos: string[] = []
  const [cats, titulos, lancs, vendas, receber, previa] = await Promise.all([
    db.from('fin_categorias').select('id, nome, tipo, grupo_dre').eq('loja_id', lojaId).order('id'),
    todas<Record<string, unknown>>((a, b) => db.from('fin_titulos_pagar')
      .select('id, numero, fornecedor_nome, documento, valor, data_competencia, categoria_id, origem_tipo')
      .eq('loja_id', lojaId).neq('status', 'cancelado').gte('data_competencia', ini).lte('data_competencia', fim).order('id').range(a, b), 'as contas a pagar'),
    todas<Record<string, unknown>>((a, b) => db.from('fin_lancamentos')
      .select('id, data, tipo, valor, descricao, categoria_id, origem_tipo')
      .eq('loja_id', lojaId).in('origem_tipo', ['manual', 'estorno_manual']).gte('data', ini).lte('data', fim).order('id').range(a, b), 'os lançamentos avulsos'),
    db.rpc('lucro_proprio', { p_loja: lojaId, p_ini: ini, p_fim: fim, p_dim: 'mes' }),
    todas<Record<string, unknown>>((a, b) => db.from('fin_titulos_receber')
      .select('id, data_venda, forma, quantidade, valor_bruto, valor_taxa, configurar')
      .eq('loja_id', lojaId).neq('status', 'cancelado').gte('data_venda', ini).lte('data_venda', fim).order('id').range(a, b), 'as contas a receber')
      .catch((e: { code?: string }) => { if (semMigration(e)) return null; throw e }),
    db.rpc('fin_receber_vendas_previa', { p_loja: lojaId, p_de: ini, p_ate: fim }),
  ])
  if (cats.error) throw new Error(`Não foi possível ler as categorias: ${cats.error.message}`)
  if (vendas.error) throw new Error(`Não foi possível ler as vendas e o custo (lucro_proprio): ${vendas.error.message}`)
  let previaRows: Record<string, unknown>[] = []
  if (previa.error) {
    if (!semMigration(previa.error)) throw new Error(`Não foi possível ler as taxas de cartão: ${previa.error.message}`)
    avisos.push('Contas a receber das vendas ainda não ativadas nesta instalação (migration 380): sem taxa de cartão nas deduções.')
  } else previaRows = (previa.data ?? []) as Record<string, unknown>[]
  const vendasMes: VendaMes[] = ((vendas.data ?? []) as Record<string, unknown>[])
    .map((r) => ({ loja_id: lojaId, mes: String(r.rotulo), faturamento: n(r.faturamento), cmv: n(r.cmv) }))
  const temVenda = new Set(vendasMes.map((v) => v.mes))
  for (const mes of meses) if (!temVenda.has(mes)) vendasMes.push({ loja_id: lojaId, mes, faturamento: 0, cmv: 0 })
  const semBaixa = ((vendas.data ?? []) as Record<string, unknown>[]).reduce((s, r) => s + n(r.itens_sem_baixa), 0)
  const semCusto = ((vendas.data ?? []) as Record<string, unknown>[]).reduce((s, r) => s + n(r.itens_sem_custo), 0)
  if (semBaixa || semCusto) avisos.push(`CMV: ${semBaixa} item(ns) vendido(s) sem baixa no estoque e ${semCusto} com insumo sem custo (mesmo aviso do relatório de CMV).`)

  // Conferência com a fonte da 380: os pagamentos das mesmas vendas somam o mesmo que a receita?
  const brutoPg = previaRows.reduce((s, r) => s + Math.round(n(r.valor_bruto) * 100), 0)
  const receitaC = vendasMes.reduce((s, v) => s + Math.round(v.faturamento * 100), 0)
  if (previaRows.length && brutoPg !== receitaC) {
    const dif = (brutoPg - receitaC) / 100
    avisos.push(`Os pagamentos das vendas somam ${(brutoPg / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}, ${Math.abs(dif).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} ${dif > 0 ? 'a mais' : 'a menos'} que a receita (venda com pagamento maior ou menor que o valor dos itens). A receita da DRE é o valor dos itens vendidos, igual ao relatório de CMV.`)
  }

  const titulosDre: TituloDre[] = titulos.map((t) => ({
    loja_id: lojaId, id: n(t.id), numero: n(t.numero), fornecedor_nome: String(t.fornecedor_nome ?? ''), documento: (t.documento as string | null) ?? null,
    valor: n(t.valor), data_competencia: String(t.data_competencia), categoria_id: t.categoria_id == null ? null : n(t.categoria_id), origem_tipo: String(t.origem_tipo),
  }))
  const lancsDre: LancamentoDre[] = lancs.map((l) => ({
    loja_id: lojaId, id: n(l.id), data: String(l.data), tipo: l.tipo === 'entrada' ? 'entrada' : 'saida', valor: n(l.valor),
    descricao: (l.descricao as string | null) ?? null, categoria_id: l.categoria_id == null ? null : n(l.categoria_id), origem_tipo: String(l.origem_tipo),
  }))
  const taxa = (r: Record<string, unknown>) => ({ loja_id: lojaId, data_venda: String(r.data_venda), forma: String(r.forma), quantidade: n(r.quantidade),
    valor_bruto: n(r.valor_bruto), valor_taxa: n(r.valor_taxa), configurar: r.configurar === true })
  return {
    entrada: {
      categorias: ((cats.data ?? []) as Record<string, unknown>[]).map((c) => ({ id: n(c.id), nome: String(c.nome), tipo: c.tipo === 'receita' ? 'receita' : 'despesa', grupo_dre: String(c.grupo_dre) })),
      vendas: vendasMes, titulos: titulosDre, lancamentos: lancsDre,
      taxasCartao: mesclarTaxasCartao((receber ?? []).map(taxa), previaRows.map(taxa)),
    },
    avisos,
  }
}

/** Receita e CMV de um mês por produto (origem das duas linhas): lucro_proprio por produto, igual à aba Produtos do CMV. */
export async function vendasPorProduto(db: Db, lojaId: number, mes: Mes): Promise<{ rotulo: string; quantidade: number; faturamento: number; cmv: number }[]> {
  return (await todas<Record<string, unknown>>((a, b) => db.rpc('lucro_proprio', { p_loja: lojaId, p_ini: inicioDoMes(mes), p_fim: fimDoMes(mes), p_dim: 'produto' })
    .range(a, b), 'as vendas por produto'))
    .map((r) => ({ rotulo: String(r.rotulo), quantidade: n(r.quantidade), faturamento: n(r.faturamento), cmv: n(r.cmv) }))
}

/** Tudo que o fluxo de caixa de uma loja precisa. */
export async function lerEntradaFluxo(db: Db, lojaId: number, de: string, ate: string, hoje: string, por: Agrupar): Promise<{ entrada: EntradaFluxo; avisos: string[] }> {
  const avisos: string[] = []
  const [contas, lancs, pagar, receber, recs, ocs] = await Promise.all([
    listarContas(db, lojaId),
    todas<Record<string, unknown>>((a, b) => db.from('fin_lancamentos').select('id, conta_id, data, tipo, valor, descricao, origem_tipo')
      .eq('loja_id', lojaId).gte('data', de).order('id').range(a, b), 'o extrato'),
    todas<Record<string, unknown>>((a, b) => db.from('fin_titulos_pagar')
      .select('id, numero, fornecedor_nome, documento, valor, valor_quitado, data_vencimento, aprovacao, valor_a_confirmar')
      .eq('loja_id', lojaId).in('status', ['aberto', 'parcial']).lte('data_vencimento', ate).order('id').range(a, b), 'as contas a pagar'),
    todas<Record<string, unknown>>((a, b) => db.from('fin_titulos_receber').select('id, data_venda, forma, valor_liquido, data_prevista, conta_id')
      .eq('loja_id', lojaId).eq('status', 'aberto').lte('data_prevista', ate).order('id').range(a, b), 'as contas a receber')
      .catch((e: { code?: string }) => { if (semMigration(e)) return null; throw e }),
    listarRecorrentes(db, lojaId, hoje).catch((e: { code?: string }) => { if (semMigration(e)) return { recorrentes: [], semMigration: true }; throw e }),
    todas<Record<string, unknown>>((a, b) => db.from('fin_recorrentes_ocorrencias').select('id, recorrente_id, data_vencimento')
      .eq('loja_id', lojaId).gte('data_vencimento', hoje < de ? hoje : de).lte('data_vencimento', ate).order('id').range(a, b), 'as ocorrências das recorrentes')
      .catch((e: { code?: string }) => { if (semMigration(e)) return [] as Record<string, unknown>[]; throw e }),
  ])
  if (contas.semMigration) avisos.push('Financeiro ainda não ativado nesta instalação.')
  if (receber === null) avisos.push('Contas a receber das vendas ainda não ativadas nesta instalação (migration 380).')
  return {
    entrada: {
      de, ate, hoje, por,
      contas: (contas.contas as ContaCorrente[]).filter((c) => c.ativa || n(c.saldo_atual) !== 0).map((c) => ({ id: n(c.id), nome: c.nome, saldo_atual: n(c.saldo_atual) })),
      lancamentos: lancs.map((l): LancamentoFluxo => ({ id: n(l.id), conta_id: n(l.conta_id), data: String(l.data), tipo: l.tipo === 'entrada' ? 'entrada' : 'saida',
        valor: n(l.valor), descricao: (l.descricao as string | null) ?? null, origem_tipo: String(l.origem_tipo) })),
      titulosPagar: pagar.map((t): PagarFluxo => ({ id: n(t.id), numero: n(t.numero), fornecedor_nome: String(t.fornecedor_nome ?? ''),
        documento: (t.documento as string | null) ?? null, valor: n(t.valor), valor_quitado: n(t.valor_quitado), data_vencimento: String(t.data_vencimento),
        aprovacao: String(t.aprovacao ?? 'nao_exige'), valor_a_confirmar: t.valor_a_confirmar === true })),
      titulosReceber: (receber ?? []).map((r): ReceberFluxo => ({ id: n(r.id), data_venda: String(r.data_venda), forma: String(r.forma),
        valor_liquido: n(r.valor_liquido), data_prevista: String(r.data_prevista), conta_id: r.conta_id == null ? null : n(r.conta_id) })),
      recorrentes: (recs.recorrentes as Recorrente[]).filter((r) => r.ativa).map((r) => ({ id: r.id, descricao: r.descricao, fornecedor_nome: r.fornecedor_nome, valor: r.valor,
        valor_estimado: r.valor_estimado, periodicidade: r.periodicidade, dia: r.dia, data_inicio: r.data_inicio, data_fim: r.data_fim })),
      ocorrencias: ocs.map((o) => ({ recorrente_id: n(o.recorrente_id), data_vencimento: String(o.data_vencimento) })),
    },
    avisos,
  }
}
