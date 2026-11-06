// DRE por competência (Fase 4 passo 5). Regras puras, sem banco e sem imports (node --test lib/financeiro/dre-puro.test.ts).
//
// De onde vem cada número (o loader em relatorios-consultas.ts lê; aqui só se monta):
//  - Receita bruta e CMV: lucro_proprio(loja, ini, fim, 'mes') — a MESMA função do /relatorio-cmv da loja própria
//    (vendas_proprio que chegam pela integração do Norte Vendas, cancelada e devolvida fora; custo = baixas do estoque
//    próprio em estoque_movimentos_efetivo). Nada é recalculado aqui.
//  - Taxas de cartão (deduções): títulos a receber das vendas (380) quando existem; senão a prévia da 380
//    (fin_receber_vendas_previa, mesmo cadastro de taxa) marcada como estimada.
//  - Despesas: contas a pagar não canceladas pela data de COMPETÊNCIA + lançamentos avulsos (manual e o estorno deles)
//    pela data. Pagamentos, recebimentos e transferências NÃO entram (são caixa, não competência).
//  - A linha da DRE de cada conta é a da categoria (fin_categorias.grupo_dre, o plano de contas da loja).
//  - Fora da DRE, à vista: categoria de CMV em conta a pagar (compra para estoque: o custo entra pelo CMV quando a
//    mercadoria sai), investimento e conta sem categoria ("A definir").
// Convenção de sinal: cada linha guarda a magnitude no sentido do nome (receita positiva, despesa positiva);
// "Resultado financeiro" e "Outras" guardam o efeito líquido (positivo = ganho).

export type Mes = string // AAAA-MM
export type CategoriaDre = { id: number; nome: string; tipo: 'despesa' | 'receita'; grupo_dre: string }
export type VendaMes = { loja_id: number; mes: Mes; faturamento: number; cmv: number }
export type TaxaCartao = {
  loja_id: number; data: string; forma: string; quantidade: number; bruto: number; valor: number
  fonte: 'titulo' | 'previa'; configurar: boolean
}
export type TituloDre = {
  loja_id: number; id: number; numero: number; fornecedor_nome: string; documento: string | null; valor: number
  data_competencia: string; categoria_id: number | null; origem_tipo: string
}
export type LancamentoDre = {
  loja_id: number; id: number; data: string; tipo: 'entrada' | 'saida'; valor: number; descricao: string | null
  categoria_id: number | null; origem_tipo: string
}
export type EntradaDre = {
  meses: Mes[]; categorias: CategoriaDre[]; vendas: VendaMes[]; taxasCartao: TaxaCartao[]
  titulos: TituloDre[]; lancamentos: LancamentoDre[]; nomesLojas?: Record<number, string>
}

export type CodigoLinha =
  | 'receita_bruta' | 'deducoes' | 'receita_liquida' | 'cmv' | 'lucro_bruto'
  | 'despesa_pessoal' | 'despesa_ocupacao' | 'despesa_operacional' | 'despesa_administrativa' | 'total_despesas'
  | 'resultado_operacional' | 'resultado_financeiro' | 'outras' | 'imposto_resultado' | 'resultado_liquido'
export type CodigoFora = 'fora_compras_estoque' | 'fora_investimento' | 'fora_sem_categoria'
type Base = Exclude<CodigoLinha, 'receita_liquida' | 'lucro_bruto' | 'total_despesas' | 'resultado_operacional' | 'resultado_liquido'>

export type Origem = {
  linha: Base | CodigoFora; mes: Mes; loja_id: number
  tipo: 'vendas' | 'cmv' | 'taxa_cartao' | 'titulo_pagar' | 'lancamento'
  ref: string; data: string; descricao: string; categoria: string | null
  /** valor no sentido da linha (despesa positiva; estorno de despesa negativo) */
  valor: number; estimado: boolean; href: string | null
}
export type LinhaDre = {
  codigo: CodigoLinha; rotulo: string; nivel: 'base' | 'subtotal' | 'resultado'
  valores: Record<Mes, number | null>; total: number | null; abre: boolean
}
export type Dre = {
  meses: Mes[]; linhas: LinhaDre[]; temDespesas: boolean; avisos: string[]
  fora: Record<CodigoFora, Record<Mes, number>>
}

export const ROTULO_LINHA: Record<CodigoLinha | CodigoFora, string> = {
  receita_bruta: 'Receita bruta (vendas)',
  deducoes: '(−) Deduções: impostos sobre vendas e taxas de cartão',
  receita_liquida: 'Receita líquida',
  cmv: '(−) CMV: custo do que foi vendido (estoque)',
  lucro_bruto: 'Margem bruta',
  despesa_pessoal: '(−) Pessoal',
  despesa_ocupacao: '(−) Ocupação (aluguel, energia, água, gás)',
  despesa_operacional: '(−) Despesas operacionais',
  despesa_administrativa: '(−) Despesas administrativas',
  total_despesas: 'Total de despesas',
  resultado_operacional: 'Resultado operacional',
  resultado_financeiro: 'Resultado financeiro (receitas − despesas financeiras)',
  outras: 'Outras receitas e despesas',
  imposto_resultado: '(−) Impostos sobre o resultado',
  resultado_liquido: 'Resultado líquido',
  fora_compras_estoque: 'Compras para o estoque (o custo entra no CMV quando sai)',
  fora_investimento: 'Investimentos',
  fora_sem_categoria: 'Contas sem categoria (a definir)',
}

const ORDEM: { codigo: CodigoLinha; nivel: LinhaDre['nivel'] }[] = [
  { codigo: 'receita_bruta', nivel: 'base' }, { codigo: 'deducoes', nivel: 'base' }, { codigo: 'receita_liquida', nivel: 'subtotal' },
  { codigo: 'cmv', nivel: 'base' }, { codigo: 'lucro_bruto', nivel: 'resultado' },
  { codigo: 'despesa_pessoal', nivel: 'base' }, { codigo: 'despesa_ocupacao', nivel: 'base' }, { codigo: 'despesa_operacional', nivel: 'base' },
  { codigo: 'despesa_administrativa', nivel: 'base' }, { codigo: 'total_despesas', nivel: 'subtotal' },
  { codigo: 'resultado_operacional', nivel: 'resultado' }, { codigo: 'resultado_financeiro', nivel: 'base' }, { codigo: 'outras', nivel: 'base' },
  { codigo: 'imposto_resultado', nivel: 'base' }, { codigo: 'resultado_liquido', nivel: 'resultado' },
]
/** Linhas abaixo da margem bruta: sem nenhuma despesa lançada no período ficam vazias (nunca um zero inventado). */
const ABAIXO_DA_MARGEM = new Set<CodigoLinha>(['despesa_pessoal', 'despesa_ocupacao', 'despesa_operacional', 'despesa_administrativa',
  'total_despesas', 'resultado_operacional', 'resultado_financeiro', 'outras', 'imposto_resultado', 'resultado_liquido'])
const NATUREZA_DESPESA = new Set<string>(['deducoes', 'cmv', 'despesa_pessoal', 'despesa_ocupacao', 'despesa_operacional',
  'despesa_administrativa', 'imposto_resultado', 'fora_compras_estoque', 'fora_investimento', 'fora_sem_categoria'])
const FORMAS_COM_TAXA: Record<string, string> = {
  credito: 'Cartão de crédito', debito: 'Cartão de débito', voucher: 'Vale-refeição (voucher)', app_entrega: 'Apps de entrega',
}

/** Padrão de restaurante: grupo do plano de contas (fin_categorias.grupo_dre) → linha da DRE. */
export function linhaDoGrupo(grupo: string | null | undefined): Base | CodigoFora {
  switch (grupo) {
    case 'receita_bruta': case 'deducoes': case 'despesa_pessoal': case 'despesa_ocupacao': case 'despesa_operacional':
    case 'despesa_administrativa': case 'imposto_resultado': case 'outras':
      return grupo
    case 'despesa_financeira': case 'receita_financeira': return 'resultado_financeiro'
    case 'cmv': return 'fora_compras_estoque'
    case 'investimento': return 'fora_investimento'
    default: return 'fora_sem_categoria'
  }
}

const cent = (v: number) => Math.round((Number(v) || 0) * 100)
const reais = (c: number) => c / 100
const mesDe = (data: string) => data.slice(0, 7)
const ultimoDia = (mes: Mes) => {
  const [a, m] = mes.split('-').map(Number)
  return new Date(Date.UTC(a, m, 0)).getUTCDate()
}
export const inicioDoMes = (mes: Mes) => `${mes}-01`
export const fimDoMes = (mes: Mes) => `${mes}-${String(ultimoDia(mes)).padStart(2, '0')}`
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** Meses de `de` a `ate` (AAAA-MM, inclusive); intervalo invertido = vazio; acima de `max` fica com os últimos. */
export function mesesEntre(de: Mes, ate: Mes, max = 24): Mes[] {
  if (!/^\d{4}-\d{2}$/.test(de) || !/^\d{4}-\d{2}$/.test(ate) || de > ate) return []
  const out: Mes[] = []
  let [a, m] = de.split('-').map(Number)
  for (;;) {
    const k = `${a}-${String(m).padStart(2, '0')}`
    if (k > ate) break
    out.push(k)
    if (++m > 12) { m = 1; a++ }
  }
  return out.slice(-max)
}

/** Título gerado (380) vale; sem título no dia × forma, a prévia (mesmo cadastro, marcada como estimada). */
export function mesclarTaxasCartao(
  titulos: { loja_id: number; data_venda: string; forma: string; quantidade: number; valor_bruto: number; valor_taxa: number; configurar: boolean }[],
  previa: { loja_id: number; data_venda: string; forma: string; quantidade: number; valor_bruto: number; valor_taxa: number; configurar: boolean }[],
): TaxaCartao[] {
  const out = new Map<string, TaxaCartao>()
  const k = (t: { loja_id: number; data_venda: string; forma: string }) => JSON.stringify([t.loja_id, t.data_venda, t.forma])
  for (const t of titulos) {
    out.set(k(t), { loja_id: t.loja_id, data: t.data_venda, forma: t.forma, quantidade: Number(t.quantidade) || 0, bruto: Number(t.valor_bruto) || 0,
      valor: Number(t.valor_taxa) || 0, fonte: 'titulo', configurar: t.configurar === true })
  }
  for (const p of previa) {
    if (out.has(k(p))) continue
    out.set(k(p), { loja_id: p.loja_id, data: p.data_venda, forma: p.forma, quantidade: Number(p.quantidade) || 0, bruto: Number(p.valor_bruto) || 0,
      valor: Number(p.valor_taxa) || 0, fonte: 'previa', configurar: p.configurar === true })
  }
  return [...out.values()].sort((a, b) => a.data.localeCompare(b.data) || a.forma.localeCompare(b.forma) || a.loja_id - b.loja_id)
}

/** Todas as linhas de origem do período, cada uma já na linha da DRE e no sentido dela. */
export function coletarOrigens(ent: EntradaDre): Origem[] {
  const meses = new Set(ent.meses)
  const cats = new Map(ent.categorias.map((c) => [c.id, c]))
  const valorNaLinha = (linha: string, efeito: number) => (NATUREZA_DESPESA.has(linha) ? -efeito : efeito)
  const out: Origem[] = []
  for (const v of ent.vendas) {
    if (!meses.has(v.mes)) continue
    const href = `/relatorio-cmv?ini=${inicioDoMes(v.mes)}&fim=${fimDoMes(v.mes)}`
    out.push({ linha: 'receita_bruta', mes: v.mes, loja_id: v.loja_id, tipo: 'vendas', ref: `vendas:${v.mes}`, data: inicioDoMes(v.mes),
      descricao: 'Vendas do Norte Vendas no mês', categoria: null, valor: Number(v.faturamento) || 0, estimado: false, href })
    out.push({ linha: 'cmv', mes: v.mes, loja_id: v.loja_id, tipo: 'cmv', ref: `cmv:${v.mes}`, data: inicioDoMes(v.mes),
      descricao: 'Custo das baixas do estoque pelas vendas', categoria: null, valor: Number(v.cmv) || 0, estimado: false, href })
  }
  for (const t of ent.taxasCartao) {
    const mes = mesDe(t.data)
    if (!meses.has(mes) || !(t.valor > 0)) continue
    out.push({ linha: 'deducoes', mes, loja_id: t.loja_id, tipo: 'taxa_cartao', ref: `taxa:${t.data}:${t.forma}`, data: t.data,
      descricao: `Taxa de ${FORMAS_COM_TAXA[t.forma] ?? t.forma} (${t.quantidade} pagamentos, bruto ${brl(t.bruto)})`,
      categoria: null, valor: t.valor, estimado: t.fonte === 'previa',
      href: t.fonte === 'titulo' ? `/financeiro/contas-receber?venda_de=${t.data}&venda_ate=${t.data}` : '/financeiro/formas-recebimento' })
  }
  for (const t of ent.titulos) {
    const mes = mesDe(t.data_competencia)
    if (!meses.has(mes)) continue
    const c = t.categoria_id != null ? cats.get(t.categoria_id) : undefined
    const linha = linhaDoGrupo(c?.grupo_dre)
    out.push({ linha, mes, loja_id: t.loja_id, tipo: 'titulo_pagar', ref: `titulo:${t.id}`, data: t.data_competencia,
      descricao: `Conta nº ${t.numero} · ${t.fornecedor_nome}${t.documento ? ` · ${t.documento}` : ''}`, categoria: c?.nome ?? null,
      valor: valorNaLinha(linha, -(Number(t.valor) || 0)), estimado: false, href: `/financeiro/contas-pagar/${t.id}` })
  }
  for (const l of ent.lancamentos) {
    const mes = mesDe(l.data)
    if (!meses.has(mes)) continue
    const c = l.categoria_id != null ? cats.get(l.categoria_id) : undefined
    const linha = linhaDoGrupo(c?.grupo_dre)
    const efeito = l.tipo === 'entrada' ? Number(l.valor) || 0 : -(Number(l.valor) || 0)
    out.push({ linha, mes, loja_id: l.loja_id, tipo: 'lancamento', ref: `lancamento:${l.id}`, data: l.data,
      descricao: `${l.origem_tipo === 'estorno_manual' ? 'Estorno de lançamento avulso' : 'Lançamento avulso'}${l.descricao ? ` · ${l.descricao}` : ''}`,
      categoria: c?.nome ?? null, valor: valorNaLinha(linha, efeito), estimado: false, href: '/financeiro/lancamentos' })
  }
  return out
}

/** Linhas de origem de uma linha da DRE (ou de "fora da DRE"); mes null = período todo. A soma é o valor da linha. */
export function origensDaLinha(ent: EntradaDre, linha: string, mes: Mes | null): Origem[] {
  return coletarOrigens(ent).filter((o) => o.linha === linha && (mes === null || o.mes === mes))
}

export function montarDre(ent: EntradaDre): Dre {
  const origens = coletarOrigens(ent)
  const soma = new Map<string, number>() // linha|mes → centavos
  for (const o of origens) {
    const k = `${o.linha}|${o.mes}`
    soma.set(k, (soma.get(k) ?? 0) + cent(o.valor))
  }
  const c = (linha: string, mes: Mes) => soma.get(`${linha}|${mes}`) ?? 0
  const despesaLancada = (o: Origem) => (o.tipo === 'titulo_pagar' || o.tipo === 'lancamento') && ABAIXO_DA_MARGEM.has(o.linha as CodigoLinha)
  const temDespesas = origens.some(despesaLancada)

  const porMes = ent.meses.map((mes) => {
    const v: Record<string, number> = {}
    for (const b of ['receita_bruta', 'deducoes', 'cmv', 'despesa_pessoal', 'despesa_ocupacao', 'despesa_operacional', 'despesa_administrativa',
      'resultado_financeiro', 'outras', 'imposto_resultado']) v[b] = c(b, mes)
    v.receita_liquida = v.receita_bruta - v.deducoes
    v.lucro_bruto = v.receita_liquida - v.cmv
    v.total_despesas = v.despesa_pessoal + v.despesa_ocupacao + v.despesa_operacional + v.despesa_administrativa
    v.resultado_operacional = v.lucro_bruto - v.total_despesas
    v.resultado_liquido = v.resultado_operacional + v.resultado_financeiro + v.outras - v.imposto_resultado
    return v
  })

  const linhas: LinhaDre[] = ORDEM.map(({ codigo, nivel }) => {
    const vazio = !temDespesas && ABAIXO_DA_MARGEM.has(codigo)
    const valores: Record<Mes, number | null> = {}
    let total = 0
    ent.meses.forEach((mes, i) => {
      valores[mes] = vazio ? null : reais(porMes[i][codigo])
      total += porMes[i][codigo]
    })
    return { codigo, rotulo: ROTULO_LINHA[codigo], nivel, valores, total: vazio ? null : reais(total), abre: !vazio }
  })

  const fora = { fora_compras_estoque: {}, fora_investimento: {}, fora_sem_categoria: {} } as Dre['fora']
  for (const k of Object.keys(fora) as CodigoFora[]) for (const mes of ent.meses) fora[k][mes] = reais(c(k, mes))

  const avisos: string[] = []
  const lojas = [...new Set([...ent.vendas.map((v) => v.loja_id), ...origens.map((o) => o.loja_id)])].sort((a, b) => a - b)
  const nome = (id: number) => ent.nomesLojas?.[id] ?? `Loja ${id}`
  if (!temDespesas) {
    avisos.push('Sem despesas lançadas no financeiro neste período: a DRE vai até a margem bruta. Pessoal, ocupação e as outras despesas aparecem quando as contas a pagar forem lançadas.')
  } else if (lojas.length > 1) {
    for (const id of lojas) {
      if (!origens.some((o) => o.loja_id === id && despesaLancada(o))) avisos.push(`${nome(id)}: sem despesas lançadas no financeiro neste período (o consolidado não tem despesas desta loja).`)
    }
  }
  const semCat = origens.filter((o) => o.linha === 'fora_sem_categoria')
  if (semCat.length) {
    avisos.push(`${semCat.length} conta(s) sem categoria (${brl(reais(semCat.reduce((s, o) => s + cent(o.valor), 0)))}) ficaram fora da DRE. Escolha a categoria na conta ou ligue a família à categoria.`)
  }
  const naoCadastradas = new Set<string>()
  for (const t of ent.taxasCartao) if (t.configurar && t.bruto > 0 && FORMAS_COM_TAXA[t.forma] && ent.meses.includes(mesDe(t.data))) naoCadastradas.add(FORMAS_COM_TAXA[t.forma])
  if (naoCadastradas.size) {
    avisos.push(`Taxa de cartão não cadastrada para: ${[...naoCadastradas].join(', ')}. A dedução dessas formas está em zero até cadastrar em "Taxas e prazos de recebimento".`)
  }
  if (origens.some((o) => o.tipo === 'taxa_cartao' && o.estimado)) {
    avisos.push('Parte das taxas de cartão é estimada pelo cadastro de taxas (as contas a receber desses dias ainda não foram geradas).')
  }
  return { meses: ent.meses, linhas, temDespesas, avisos, fora }
}

/** Origem da receita ou do CMV por produto (lucro_proprio por produto do mês), com a diferença de arredondamento. */
export function linhasVendasPorProduto(
  rows: { rotulo: string; quantidade: number; faturamento: number; cmv: number }[], campo: 'receita' | 'cmv', totalDoMes: number,
): { linhas: { rotulo: string; quantidade: number; valor: number }[]; soma: number; diferenca: number } {
  const linhas = rows
    .map((r) => ({ rotulo: r.rotulo, quantidade: Number(r.quantidade) || 0, valor: reais(cent(campo === 'cmv' ? r.cmv : r.faturamento)) }))
    .sort((a, b) => b.valor - a.valor || a.rotulo.localeCompare(b.rotulo))
  const somaC = linhas.reduce((s, l) => s + cent(l.valor), 0)
  return { linhas, soma: reais(somaC), diferenca: reais(cent(totalDoMes) - somaC) }
}
