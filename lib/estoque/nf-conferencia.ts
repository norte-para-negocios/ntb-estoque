// Conferência automática dos itens de uma nota de entrada com o cadastro de produtos (estoque próprio).
// Ordem: 1) de-para do fornecedor (CNPJ + cProd), 2) EAN/GTIN, 3) descrição normalizada (só sugere, nunca lança sozinho).
// Puro e testável com `node --test`.

export type ProdutoCad = { codigo_produto: number; codigo: string; descricao: string; unidade: string | null; ean: string | null; inativo?: boolean | null }
export type Depara = { c_prod: string; codigo_produto: number; fator: number }
export type ItemParaCasar = { cProd: string; ean: string | null; descricao: string; unidade: string }

export type Casamento = {
  codigoProduto: number | null // preenchido só quando o casamento é seguro (de-para ou EAN)
  fator: number
  origem: 'depara' | 'ean' | 'descricao' | null
  score: number | null
  sugestao: number | null // produto sugerido (EAN com unidade diferente, ou descrição parecida)
  automatico: boolean // pode entrar no estoque sem conferência humana
}

const SEM_CASAMENTO: Casamento = { codigoProduto: null, fator: 1, origem: null, score: null, sugestao: null, automatico: false }

export function normalizar(s: string): string {
  return (s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const UNIDADES: Record<string, string> = {
  un: 'un', und: 'un', unid: 'un', unidade: 'un', pc: 'un', pç: 'un', pca: 'un', peca: 'un',
  kg: 'kg', kgs: 'kg', quilo: 'kg', g: 'g', gr: 'g', grs: 'g', l: 'l', lt: 'l', lts: 'l', litro: 'l', ml: 'ml',
  cx: 'cx', caixa: 'cx', fd: 'fd', fardo: 'fd', pct: 'pct', pacote: 'pct', dz: 'dz', duzia: 'dz',
}
export function unidadeCanonica(u: string | null | undefined): string {
  const n = normalizar(u ?? '').replace(/\s+/g, '')
  return UNIDADES[n] ?? n
}
export function unidadesCompativeis(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = unidadeCanonica(a), y = unidadeCanonica(b)
  return !!x && x === y
}

function bigramas(s: string): Map<string, number> {
  const m = new Map<string, number>()
  const t = ` ${s} `
  for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1) }
  return m
}

/** 0..1. Maior entre o coeficiente de Dice por bigramas (tolera erro de digitação) e a sobreposição de palavras (tolera ordem diferente). */
export function similaridade(a: string, b: string): number {
  const x = normalizar(a), y = normalizar(b)
  if (!x || !y) return 0
  if (x === y) return 1
  const bx = bigramas(x), by = bigramas(y)
  let inter = 0, tx = 0, ty = 0
  for (const [, n] of bx) tx += n
  for (const [, n] of by) ty += n
  for (const [g, n] of bx) inter += Math.min(n, by.get(g) ?? 0)
  const dice = (2 * inter) / (tx + ty)
  const px = new Set(x.split(' ')), py = new Set(y.split(' '))
  let comuns = 0
  for (const p of px) if (py.has(p)) comuns++
  const sobreposicao = comuns / Math.min(px.size, py.size)
  return Math.round(Math.max(dice, sobreposicao * 0.95) * 10000) / 10000
}

export const LIMIAR_SUGESTAO = 0.55

export type ContextoCasamento = { depara: Map<string, Depara>; produtosPorCodigo: Map<number, ProdutoCad>; produtos: ProdutoCad[] }

export function montarContexto(produtos: ProdutoCad[], depara: Depara[]): ContextoCasamento {
  const ativos = produtos.filter((p) => !p.inativo)
  return {
    depara: new Map(depara.map((d) => [d.c_prod, d])),
    produtosPorCodigo: new Map(ativos.map((p) => [Number(p.codigo_produto), p])),
    produtos: ativos,
  }
}

export function casarItem(item: ItemParaCasar, ctx: ContextoCasamento): Casamento {
  // 1) de-para do fornecedor: o fator de conversão já foi confirmado por uma pessoa, então é seguro lançar
  const d = ctx.depara.get(item.cProd)
  if (d && ctx.produtosPorCodigo.has(Number(d.codigo_produto))) {
    return { codigoProduto: Number(d.codigo_produto), fator: Number(d.fator) > 0 ? Number(d.fator) : 1, origem: 'depara', score: 1, sugestao: null, automatico: true }
  }
  // 2) EAN/GTIN: único no cadastro. Só é automático se a unidade da nota é a do produto (senão falta o fator).
  if (item.ean) {
    const iguais = ctx.produtos.filter((p) => p.ean && p.ean.replace(/\D/g, '') === item.ean!.replace(/\D/g, ''))
    if (iguais.length === 1) {
      const p = iguais[0]
      const compat = unidadesCompativeis(item.unidade, p.unidade)
      return compat
        ? { codigoProduto: Number(p.codigo_produto), fator: 1, origem: 'ean', score: 1, sugestao: null, automatico: true }
        : { ...SEM_CASAMENTO, origem: 'ean', score: 1, sugestao: Number(p.codigo_produto) }
    }
    if (iguais.length > 1) return { ...SEM_CASAMENTO, origem: 'ean', score: 0.9, sugestao: Number(iguais[0].codigo_produto) }
  }
  // 3) descrição parecida: só sugere
  let melhor: { p: ProdutoCad; s: number } | null = null
  for (const p of ctx.produtos) {
    const s = similaridade(item.descricao, p.descricao)
    if (!melhor || s > melhor.s) melhor = { p, s }
  }
  if (melhor && melhor.s >= LIMIAR_SUGESTAO) return { ...SEM_CASAMENTO, origem: 'descricao', score: melhor.s, sugestao: Number(melhor.p.codigo_produto) }
  return SEM_CASAMENTO
}

/** Lança sozinho só se TODOS os itens casaram com segurança (de-para ou EAN com a mesma unidade). */
export function podeLancarAutomatico(casamentos: Casamento[]): boolean {
  return casamentos.length > 0 && casamentos.every((c) => c.automatico && c.codigoProduto != null)
}

export type SituacaoNota = 'resumo' | 'a_conferir' | 'parcial' | 'lancada' | 'estornada' | 'divergente'
export const ROTULO_SITUACAO: Record<SituacaoNota, string> = {
  resumo: 'Recebida (aguardando o XML completo)',
  a_conferir: 'A conferir',
  parcial: 'Parcial',
  lancada: 'Lançada no estoque',
  estornada: 'Entrada desfeita',
  divergente: 'Divergente',
}
