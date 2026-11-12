// Norte Cozinha: Insumos, Início e Estoque da cozinha (PURO, sem banco, sem alias do Next; node --test).
// Insumo = folha da ficha técnica (produto usado em alguma ficha que não tem ficha própria).
// O uso de cada insumo sai das árvores de custo (lib/estoque/arvore-custo-puro.ts) já montadas pelo loader:
// a quantidade é por 1 unidade do prato/preparação raiz, já descendo pelas preparações.
import type { ArvoreCusto, NoArvore } from '../estoque/arvore-custo-puro'

// ---------------------------------------------------------------------------------------------------------------
// Uso dos insumos nas fichas

export type Uso = {
  /** Prato ou preparação (a raiz da ficha). */
  raiz: number
  /** Quantidade do insumo em 1 unidade da raiz (somada se aparece mais de uma vez). */
  quantidade: number
  /** Quanto o insumo custa dentro de 1 unidade da raiz. */
  custo: number
  /** Custo de 1 unidade da raiz pela ficha. */
  custoRaiz: number
  /** Aparece direto na ficha da raiz (não só dentro de uma preparação). */
  direto: boolean
}

/** Para cada insumo (folha), onde ele é usado. Nó em ciclo ou com ficha não é insumo. */
export function usosDasArvores(arvores: Iterable<ArvoreCusto>): Map<number, Uso[]> {
  const out = new Map<number, Uso[]>()
  for (const a of arvores) {
    const daRaiz = new Map<number, Uso>()
    const andar = (nos: NoArvore[], nivel: number) => {
      for (const n of nos) {
        if (n.filhos.length) { andar(n.filhos, nivel + 1); continue }
        if (n.temFicha || n.ciclo) continue
        const u = daRaiz.get(n.codigo) ?? { raiz: a.codigo, quantidade: 0, custo: 0, custoRaiz: a.total, direto: false }
        u.quantidade += n.quantidade
        u.custo += n.custo
        if (nivel === 0) u.direto = true
        daRaiz.set(n.codigo, u)
      }
    }
    andar(a.filhos, 0)
    for (const [cod, u] of daRaiz) {
      const arr = out.get(cod) ?? []
      arr.push({ ...u, quantidade: arred6(u.quantidade), custo: arred6(u.custo) })
      out.set(cod, arr)
    }
  }
  return out
}

const arred6 = (n: number) => Math.round(n * 1e6) / 1e6

// ---------------------------------------------------------------------------------------------------------------
// Variação de custo

/** Variação (fração) entre dois custos; null se falta um dos dois. */
export function variacao(agora: number | null | undefined, antes: number | null | undefined): number | null {
  if (agora == null || antes == null || !(agora > 0) || !(antes > 0)) return null
  return agora / antes - 1
}

/** Salto de 5× para cima ou para baixo: quase sempre unidade trocada na entrada, não aumento de preço. */
export function saltoEstranho(v: number | null): boolean {
  return v != null && (v >= 4 || v <= -0.8)
}

/**
 * Quanto o custo de cada raiz subiu (R$ por unidade) entre a foto antiga e a atual, insumo a insumo:
 * Σ quantidade × (custo agora − custo antes). Insumo sem um dos dois custos, com salto estranho ou ignorado não entra.
 */
export function deltaPorRaiz(
  usos: Map<number, Uso[]>, agora: Map<number, number | null>, antes: Map<number, number>, ignorar: (cod: number) => boolean = () => false,
): Map<number, number> {
  const out = new Map<number, number>()
  for (const [cod, lista] of usos) {
    const a = agora.get(cod) ?? null
    const b = antes.get(cod) ?? null
    const v = variacao(a, b)
    if (v == null || saltoEstranho(v) || ignorar(cod)) continue
    for (const u of lista) out.set(u.raiz, (out.get(u.raiz) ?? 0) + u.quantidade * ((a as number) - (b as number)))
  }
  return out
}

export type Compra = { produto: number; data: string; quantidade: number; valor: number }
export type VarCompra = {
  /** Custo médio ponderado (por unidade do estoque) das compras dos últimos `recenteDias`. */
  agora: number
  /** Custo médio ponderado das compras entre `baseDias` e `recenteDias` atrás. */
  antes: number
  variacao: number
  ultimaData: string
  nAgora: number
  nAntes: number
}

/**
 * Variação do preço de compra por produto: média ponderada (Σ valor ÷ Σ quantidade) das compras dos últimos
 * `recenteDias` contra a dos `recenteDias`–`baseDias` dias antes. Produto sem compra em uma das duas janelas fica de fora.
 */
export function variacaoPorCompras(compras: Compra[], hoje: string, recenteDias = 30, baseDias = 120): Map<number, VarCompra> {
  const dia = (iso: string) => Date.parse(`${iso.slice(0, 10)}T12:00:00Z`)
  const h = dia(hoje)
  const corte = h - recenteDias * 86_400_000
  const inicio = h - baseDias * 86_400_000
  type Acc = { qa: number; va: number; qb: number; vb: number; na: number; nb: number; ultima: string }
  const acc = new Map<number, Acc>()
  for (const c of compras) {
    if (!(c.quantidade > 0) || !(c.valor > 0) || !c.data) continue
    const t = dia(c.data)
    if (!Number.isFinite(t) || t > h || t <= inicio) continue
    const a = acc.get(c.produto) ?? { qa: 0, va: 0, qb: 0, vb: 0, na: 0, nb: 0, ultima: '' }
    if (t > corte) { a.qa += c.quantidade; a.va += c.valor; a.na++ } else { a.qb += c.quantidade; a.vb += c.valor; a.nb++ }
    if (c.data.slice(0, 10) > a.ultima) a.ultima = c.data.slice(0, 10)
    acc.set(c.produto, a)
  }
  const out = new Map<number, VarCompra>()
  for (const [p, a] of acc) {
    if (!(a.qa > 0) || !(a.qb > 0)) continue
    const agora = a.va / a.qa
    const antes = a.vb / a.qb
    out.set(p, { agora, antes, variacao: agora / antes - 1, ultimaData: a.ultima, nAgora: a.na, nAntes: a.nb })
  }
  return out
}

/**
 * Custo médio "de antes" implícito: custo médio de hoje ÷ (1 + variação do preço de compra). Assim o impacto em R$
 * nos pratos fica na escala do custo médio (a unidade da nota às vezes vem errada) e a variação é a das compras.
 */
export function custoAntesImplicito(cmc: Map<number, number | null>, variacoes: Map<number, number>): Map<number, number> {
  const out = new Map<number, number>()
  for (const [cod, v] of variacoes) {
    const c = cmc.get(cod)
    if (c != null && c > 0 && v > -1) out.set(cod, c / (1 + v))
  }
  return out
}

export type Alta = {
  codigo: number
  antes: number
  agora: number
  variacao: number
  /** Pratos (não preparações) que usam o insumo. */
  pratos: number
  /** Em média, quanto cada prato afetado ficou mais caro (R$). */
  impactoMedio: number
  /** Soma do aumento em 1 unidade de cada prato afetado (ordena a lista). */
  peso: number
}

/** Insumos cujo custo subiu pelo menos `minimo` (fração), do que mais pesa nos pratos para o que menos pesa. */
export function altasDeCusto(
  usos: Map<number, Uso[]>, agora: Map<number, number | null>, antes: Map<number, number>,
  opcoes: { minimo?: number; ehPrato: (raiz: number) => boolean; ignorar?: (cod: number) => boolean },
): Alta[] {
  const minimo = opcoes.minimo ?? 0.03
  const out: Alta[] = []
  for (const [cod, lista] of usos) {
    const a = agora.get(cod) ?? null
    const b = antes.get(cod) ?? null
    const v = variacao(a, b)
    if (v == null || v < minimo || saltoEstranho(v) || opcoes.ignorar?.(cod)) continue
    const pratos = lista.filter((u) => opcoes.ehPrato(u.raiz))
    const peso = pratos.reduce((s, u) => s + u.quantidade * ((a as number) - (b as number)), 0)
    out.push({ codigo: cod, antes: b as number, agora: a as number, variacao: v, pratos: pratos.length, impactoMedio: pratos.length ? peso / pratos.length : 0, peso })
  }
  return out.sort((x, y) => y.peso - x.peso || y.variacao - x.variacao)
}

// ---------------------------------------------------------------------------------------------------------------
// "E se o preço mudar"

export type Simulacao = {
  raiz: number
  custoAntes: number
  custoDepois: number
  /** R$ a mais (ou a menos) em 1 unidade da raiz. */
  diferenca: number
  preco: number | null
  cmvAntes: number | null
  cmvDepois: number | null
}

/**
 * Novo custo do insumo (por unidade) → novo custo de cada prato/preparação que o usa e o CMV com o preço de venda.
 * Insumo hoje sem custo conta como 0 (o prato já está sem esse pedaço). Preço abaixo de R$ 0,10 não é preço.
 */
export function simularPreco(usos: (Uso & { preco?: number | null })[], custoAtual: number | null, custoNovo: number): Simulacao[] {
  const atual = custoAtual != null && custoAtual > 0 ? custoAtual : 0
  const novo = Number.isFinite(custoNovo) && custoNovo > 0 ? custoNovo : 0
  return usos.map((u) => {
    const diferenca = u.quantidade * (novo - atual)
    const custoDepois = Math.max(0, u.custoRaiz + diferenca)
    const preco = u.preco != null && u.preco >= 0.1 ? u.preco : null
    return {
      raiz: u.raiz, custoAntes: u.custoRaiz, custoDepois, diferenca, preco,
      cmvAntes: preco ? u.custoRaiz / preco : null, cmvDepois: preco ? custoDepois / preco : null,
    }
  })
}

/** Lê o preço digitado ("12,50", "1.234,5", "12.5"). null se não é número positivo. */
export function lerPreco(texto: string): number | null {
  const t = texto.trim().replace(/^r\$\s*/i, '')
  if (!t) return null
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  const n = Number(normal)
  return Number.isFinite(n) && n > 0 ? n : null
}

// ---------------------------------------------------------------------------------------------------------------
// Início: pratos que pesam e pratos que deixam mais

/** O mínimo de um prato que as listas do Início usam (LinhaPrato de carregar.ts encaixa). */
export type PratoResumo = {
  codigo: number; descricao: string; custo: number; preco: number | null; cmv: number | null
  situacao: string; sobraSalao: number | null; tipo: 'prato' | 'preparacao'
}

/** Pratos acima ou perto da meta, do que mais custa a mais por venda (custo − meta × preço) para o que menos. */
export function pratosQueMaisPesam<T extends PratoResumo>(linhas: T[], meta: number, n = 5): (T & { excesso: number })[] {
  return linhas
    .filter((l) => l.tipo === 'prato' && (l.situacao === 'acima' || l.situacao === 'atencao') && l.preco != null)
    .map((l) => ({ ...l, excesso: l.custo - meta * (l.preco as number) }))
    .filter((l) => l.excesso > 0)
    .sort((a, b) => b.excesso - a.excesso)
    .slice(0, n)
}

/** Pratos dentro da meta que mais deixam por venda (depois do custo e das taxas): os que vale empurrar. */
export function pratosQueMaisDeixam<T extends PratoResumo>(linhas: T[], n = 5): T[] {
  return linhas
    .filter((l) => l.tipo === 'prato' && l.situacao === 'ok' && l.sobraSalao != null && l.sobraSalao > 0)
    .sort((a, b) => (b.sobraSalao as number) - (a.sobraSalao as number))
    .slice(0, n)
}

const mediana = (v: number[]) => {
  if (!v.length) return null
  const o = [...v].sort((a, b) => a - b)
  const m = Math.floor(o.length / 2)
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2
}

/**
 * CMV típico (mediana, mesmo critério do resumir de preco-puro) agora e com o custo dos insumos de antes.
 * Só pratos de custo completo e confiável, com preço.
 */
export function cmvTipicoAgoraEAntes(linhas: PratoResumo[], delta: Map<number, number>): { agora: number | null; antes: number | null } {
  const validas = linhas.filter((l) => l.tipo === 'prato' && l.preco != null && l.preco >= 0.1 && l.custo > 0 &&
    (l.situacao === 'ok' || l.situacao === 'atencao' || l.situacao === 'acima'))
  return {
    agora: mediana(validas.map((l) => l.custo / (l.preco as number))),
    antes: mediana(validas.map((l) => Math.max(0, l.custo - (delta.get(l.codigo) ?? 0)) / (l.preco as number))),
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Estoque da cozinha e lista de compras

export type SituacaoEstoque = 'negativo' | 'zerado' | 'abaixo' | 'ok' | 'sem_minimo'

export function situacaoEstoque(saldo: number, minimo: number): SituacaoEstoque {
  if (saldo < -1e-9) return 'negativo'
  if (Math.abs(saldo) <= 1e-9) return 'zerado'
  if (minimo > 0 && saldo < minimo - 1e-9) return 'abaixo'
  return minimo > 0 ? 'ok' : 'sem_minimo'
}

/** Precisa comprar: tem mínimo e o saldo (negativo conta como zero) está abaixo dele. */
export const precisaComprar = (saldo: number, minimo: number) => minimo > 0 && Math.max(saldo, 0) < minimo - 1e-9

/** Compra não vem em fração estranha: g/ml de 100 em 100, kg/l de meio em meio, o resto inteiro. */
export function arredondarCompra(q: number, unidade: string | null): number {
  if (!(q > 0)) return 0
  const u = (unidade ?? '').toUpperCase()
  if (u === 'G' || u === 'GR' || u === 'ML') return Math.ceil(q / 100 - 1e-9) * 100
  if (u === 'KG' || u === 'L' || u === 'LT') return Math.ceil(q * 2 - 1e-9) / 2
  return Math.ceil(q - 1e-9)
}

/**
 * Quanto comprar: o que falta para o mínimo + uma folga. Folga = consumo de `diasCobertura` dias quando se sabe o
 * consumo; senão metade do mínimo. Saldo negativo conta como zero. Arredondado para a unidade.
 */
export function quantidadeSugerida(saldo: number, minimo: number, unidade: string | null, consumoPorDia: number | null, diasCobertura = 7): number {
  if (!precisaComprar(saldo, minimo)) return 0
  const falta = minimo - Math.max(saldo, 0)
  const folga = consumoPorDia != null && consumoPorDia > 0 ? consumoPorDia * diasCobertura : minimo * 0.5
  return arredondarCompra(falta + folga, unidade)
}

export type ItemCompra = { codigo: number; descricao: string; unidade: string | null; fornecedor: string | null; quantidade: number; custoUnitario: number | null }
export type GrupoCompra = { fornecedor: string | null; itens: ItemCompra[]; total: number }

/** Agrupa por fornecedor (nome sem diferença de caixa/espaço), A–Z, "sem fornecedor" por último. */
export function agruparPorFornecedor(itens: ItemCompra[]): GrupoCompra[] {
  const m = new Map<string, GrupoCompra>()
  for (const i of itens) {
    const nome = i.fornecedor?.trim() || null
    const k = nome ? nome.toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ') : ''
    const g = m.get(k) ?? { fornecedor: nome, itens: [], total: 0 }
    g.itens.push(i)
    g.total += i.custoUnitario != null && i.custoUnitario > 0 ? i.quantidade * i.custoUnitario : 0
    m.set(k, g)
  }
  return [...m.values()]
    .map((g) => ({ ...g, itens: [...g.itens].sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR')) }))
    .sort((a, b) => (a.fornecedor == null ? 1 : b.fornecedor == null ? -1 : a.fornecedor.localeCompare(b.fornecedor, 'pt-BR')))
}

/** "5 kg", "500 g", "2 un", "1,5 l". */
export function quantidadeTexto(q: number, unidade: string | null): string {
  const u = (unidade ?? '').trim().toLowerCase()
  return `${q.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}${u ? ` ${u}` : ''}`
}

/** Texto para colar no WhatsApp: um bloco por fornecedor, nome do fornecedor em negrito. */
export function textoWhatsApp(grupos: GrupoCompra[], titulo = 'Lista de compras'): string {
  const linhas: string[] = [titulo]
  for (const g of grupos) {
    linhas.push('', `*${g.fornecedor ?? 'Sem fornecedor'}*`)
    for (const i of g.itens) linhas.push(`- ${quantidadeTexto(i.quantidade, i.unidade)} de ${i.descricao}`)
  }
  return linhas.join('\n')
}
