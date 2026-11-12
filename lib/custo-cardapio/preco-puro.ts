// Custo e Cardápio: conta do preço (PURO, sem banco, sem alias do Next; testado por node --test).
// O custo do prato vem da árvore da ficha (lib/estoque/arvore-custo-puro.ts); aqui só preço, CMV e o que sobra.

export type Taxas = {
  /** Meta de CMV (fração, 0,30 = 30%). */
  metaCmv: number
  /** Imposto sobre a venda (fração). */
  impostoPct: number
  /** Taxa do cartão (fração). */
  taxaCartaoPct: number
  /** Comissão do app de entrega (fração). */
  taxaDeliveryPct: number
  /** Embalagem por pedido de delivery (R$). */
  embalagem: number
}

export const TAXAS_PADRAO: Taxas = { metaCmv: 0.3, impostoPct: 0.06, taxaCartaoPct: 0.03, taxaDeliveryPct: 0.23, embalagem: 2 }

export type Canal = 'salao' | 'delivery'

/** CMV (fração) do prato; null sem preço. */
export function cmv(custo: number, preco: number | null | undefined): number | null {
  if (!preco || !(preco >= 0.1)) return null
  return custo / preco
}

/** Preço de salão que bate a meta de CMV. */
export function precoSugeridoSalao(custo: number, t: Pick<Taxas, 'metaCmv'>): number {
  return t.metaCmv > 0 ? custo / t.metaCmv : 0
}

/**
 * Preço de delivery: app, cartão e imposto comem uma fatia do preço.
 * (custo + embalagem) tem que ser a meta de CMV do que SOBRA depois das taxas:
 * preço = (custo + embalagem) / (meta × (1 − app − cartão − imposto)).
 */
export function precoSugeridoDelivery(custo: number, t: Taxas): number {
  const liquido = 1 - t.taxaDeliveryPct - t.taxaCartaoPct - t.impostoPct
  if (liquido <= 0 || t.metaCmv <= 0) return 0
  return (custo + t.embalagem) / (t.metaCmv * liquido)
}

/** Quanto fica por venda depois do custo e das taxas (antes do custo fixo). */
export function sobraPorVenda(preco: number, custo: number, t: Taxas, canal: Canal): number {
  const taxas = t.impostoPct + t.taxaCartaoPct + (canal === 'delivery' ? t.taxaDeliveryPct : 0)
  return preco * (1 - taxas) - custo - (canal === 'delivery' ? t.embalagem : 0)
}

/** Arredonda o preço para terminar em ,90 (padrão de cardápio), sempre para cima. */
export function arredondarPreco(v: number): number {
  if (!(v > 0)) return 0
  const inteiro = Math.floor(v)
  const candidato = inteiro + 0.9
  return Math.round((candidato >= v - 1e-9 ? candidato : inteiro + 1.9) * 100) / 100
}

export type Situacao = 'ok' | 'atencao' | 'acima' | 'sem_preco' | 'sem_custo' | 'incompleto' | 'suspeito'

/**
 * Situação do prato contra a meta: até a meta = ok; até 5 pontos acima = atenção; mais = acima.
 * Insumo sem custo: nada de custo = sem_custo; parte = incompleto (o CMV real é MAIOR), salvo se já passa da meta.
 */
export function situacao(custo: number, preco: number | null, semCusto: number, t: Pick<Taxas, 'metaCmv'>, suspeitos = 0): Situacao {
  if (!precoReal(preco)) return 'sem_preco'
  if (suspeitos > 0) return 'suspeito'
  if (semCusto > 0 && custo <= 0) return 'sem_custo'
  const c = custo / preco
  if (semCusto > 0 && c <= t.metaCmv + 0.05 + 1e-9) return 'incompleto'
  if (c <= t.metaCmv + 1e-9) return 'ok'
  if (c <= t.metaCmv + 0.05) return 'atencao'
  return 'acima'
}

/** Preço de verdade: R$ 0,01 e afins são marcadores no cadastro (item de cortesia, aniversário), não preço. */
export function precoReal(preco: number | null | undefined): preco is number {
  return preco != null && preco >= 0.1
}

/**
 * Custo médio do insumo que não faz sentido para a unidade (ex.: R$ 39,67 por ml de Martini = entrada lançada por garrafa).
 * Teto: R$ 2 por g/ml, R$ 2.000 por kg/l, R$ 5.000 por unidade.
 */
export function custoSuspeito(custoUnitario: number | null, unidade: string | null): boolean {
  if (custoUnitario == null || !(custoUnitario > 0)) return false
  const u = (unidade ?? '').toUpperCase()
  const teto = u === 'G' || u === 'ML' || u === 'GR' ? 2 : u === 'KG' || u === 'L' || u === 'LT' ? 2000 : 5000
  return custoUnitario > teto
}

const mediana = (v: number[]) => {
  if (!v.length) return null
  const o = [...v].sort((a, b) => a - b)
  const m = Math.floor(o.length / 2)
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2
}

export type ResumoCardapio = {
  pratos: number
  comPreco: number
  /** CMV mediano dos pratos com preço e custo completo e confiável (metade fica abaixo). */
  cmvMedio: number | null
  acima: number
  atencao: number
  semPreco: number
  semCusto: number
  /** Com algum insumo sem custo (o CMV mostrado é menor que o real). */
  incompletos: number
  suspeitos: number
}

export function resumir(linhas: { custo: number; preco: number | null; situacao: Situacao }[]): ResumoCardapio {
  // Só pratos de custo completo e confiável; mediana porque um custo errado no Omie vira 15.000% e arrasta a média.
  const validas = linhas.filter((l) => precoReal(l.preco) && l.custo > 0 && (l.situacao === 'ok' || l.situacao === 'atencao' || l.situacao === 'acima'))
  return {
    pratos: linhas.length,
    comPreco: linhas.filter((l) => precoReal(l.preco)).length,
    cmvMedio: mediana(validas.map((l) => l.custo / (l.preco as number))),
    acima: linhas.filter((l) => l.situacao === 'acima').length,
    atencao: linhas.filter((l) => l.situacao === 'atencao').length,
    semPreco: linhas.filter((l) => l.situacao === 'sem_preco').length,
    semCusto: linhas.filter((l) => l.situacao === 'sem_custo').length,
    incompletos: linhas.filter((l) => l.situacao === 'incompleto').length,
    suspeitos: linhas.filter((l) => l.situacao === 'suspeito').length,
  }
}

/** Lê as taxas gravadas (numeric vem como string), caindo no padrão no que faltar. */
export function lerTaxas(row: Partial<Record<'meta_cmv' | 'imposto_pct' | 'taxa_cartao_pct' | 'taxa_delivery_pct' | 'embalagem', string | number | null>> | null): Taxas {
  const n = (v: string | number | null | undefined, p: number) => (v == null || v === '' || !Number.isFinite(Number(v)) ? p : Number(v))
  if (!row) return { ...TAXAS_PADRAO }
  return {
    metaCmv: n(row.meta_cmv, TAXAS_PADRAO.metaCmv),
    impostoPct: n(row.imposto_pct, TAXAS_PADRAO.impostoPct),
    taxaCartaoPct: n(row.taxa_cartao_pct, TAXAS_PADRAO.taxaCartaoPct),
    taxaDeliveryPct: n(row.taxa_delivery_pct, TAXAS_PADRAO.taxaDeliveryPct),
    embalagem: n(row.embalagem, TAXAS_PADRAO.embalagem),
  }
}

/** Valida as taxas digitadas (frações). Devolve a lista de problemas. */
export function validarTaxas(t: Taxas): string[] {
  const e: string[] = []
  if (!(t.metaCmv > 0 && t.metaCmv < 1)) e.push('A meta de CMV deve ficar entre 1% e 99%.')
  for (const [k, v] of [['Imposto', t.impostoPct], ['Taxa do cartão', t.taxaCartaoPct], ['Taxa do app', t.taxaDeliveryPct]] as const) {
    if (!(v >= 0 && v < 1)) e.push(`${k} deve ficar entre 0% e 99%.`)
  }
  if (t.impostoPct + t.taxaCartaoPct + t.taxaDeliveryPct >= 1) e.push('As taxas somadas passam de 100% do preço.')
  if (!(t.embalagem >= 0)) e.push('A embalagem não pode ser negativa.')
  return e
}

/**
 * Custo médio (CMC) do Omie por produto na foto do dia: usa a linha consolidada (local 0) quando tem CMC;
 * senão pondera pelos locais com saldo positivo; senão o maior CMC visto (produto zerado mas com custo).
 */
export function cmcDaFoto(linhas: { produto: number; local: number; cmc: number; saldo: number }[]): Map<number, number> {
  const acc = new Map<number, { consolidado: number | null; valor: number; saldo: number; maior: number }>()
  for (const l of linhas) {
    if (!(l.cmc > 0)) continue
    const a = acc.get(l.produto) ?? { consolidado: null, valor: 0, saldo: 0, maior: 0 }
    if (l.local === 0) a.consolidado = l.cmc
    if (l.saldo > 0) { a.valor += l.cmc * l.saldo; a.saldo += l.saldo }
    if (l.cmc > a.maior) a.maior = l.cmc
    acc.set(l.produto, a)
  }
  const out = new Map<number, number>()
  for (const [p, a] of acc) out.set(p, a.consolidado ?? (a.saldo > 0 ? a.valor / a.saldo : a.maior))
  return out
}
