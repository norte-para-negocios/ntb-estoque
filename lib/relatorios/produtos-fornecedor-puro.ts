// Produtos por fornecedor (matriz N3, relatório ERP_PRD_FOR_FORNECEDOR do Omie): uma linha por produto × fornecedor com a
// última compra (RPC relatorio_produtos_fornecedor, migration 210), o cadastro e o custo médio de hoje.
// Puro, sem imports: node --test lib/relatorios/produtos-fornecedor-puro.test.ts

export type BrutoPF = {
  n_cod_prod: number; fornecedor_chave: string; fornecedor: string; fornecedor_fantasia: string | null; codigo_fornecedor: string | null
  ultima_data: string | null; ultima_nota: string | null; ultima_nota_id: number | null; qtde: number | null; unidade: string | null
  preco_unit: number | null; total: number | null; custo_unit: number | null; compras: number; total_comprado: number | null; primeira_data: string | null
}
export type MetaPF = {
  codigo: string | null; descricao: string | null; familia: string | null; tipo: string | null; unidade: string | null
  inativo: boolean; custoMedio: number | null; estoque: number
}
export type OpcoesPF = { ver: 'produto' | 'fornecedor'; q: string; fornecedor: string; tipos: string[]; familias: string[]; inativos: boolean }
export type LinhaPF = BrutoPF & {
  codigo: string; descricao: string; familia: string; tipo: string; inativo: boolean; custoMedio: number | null; estoque: number
  nFornecedores: number; maisBarato: boolean; variacaoPct: number | null
}
export type ResumoPF = { produtos: number; fornecedores: number; pares: number; multiFornecedor: number }

export const SEM_FAMILIA = 'Sem família'
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const cmp = (a: string, b: string) => a.localeCompare(b, 'pt-BR')

export function montarProdutosFornecedor(brutas: BrutoPF[], meta: Map<number, MetaPF>, op: OpcoesPF): { linhas: LinhaPF[]; resumo: ResumoPF } {
  // contagens por produto com TODOS os fornecedores (antes dos filtros)
  const porProduto = new Map<number, BrutoPF[]>()
  for (const b of brutas) porProduto.set(Number(b.n_cod_prod), [...(porProduto.get(Number(b.n_cod_prod)) ?? []), b])
  const menorCusto = new Map<number, number>()
  for (const [p, ls] of porProduto) {
    const custos = ls.map((l) => num(l.custo_unit)).filter((c): c is number => c != null && c > 0)
    if (ls.length > 1 && custos.length) menorCusto.set(p, Math.min(...custos))
  }

  const termo = semAcento(op.q.trim())
  const forn = semAcento(op.fornecedor.trim())
  const linhas: LinhaPF[] = []
  for (const b of brutas) {
    const cod = Number(b.n_cod_prod)
    const m = meta.get(cod)
    const familia = m?.familia?.trim() || SEM_FAMILIA
    const tipo = m?.tipo ?? ''
    const inativo = m?.inativo ?? false
    const descricao = m?.descricao?.trim() || `Produto ${cod}`
    const codigo = m?.codigo ?? String(cod)
    if (!op.inativos && inativo) continue
    if (op.tipos.length && !op.tipos.includes(tipo || '_')) continue
    if (op.familias.length && !op.familias.includes(familia)) continue
    if (forn && !semAcento(`${b.fornecedor} ${b.fornecedor_fantasia ?? ''}`).includes(forn)) continue
    if (termo && !semAcento(`${descricao} ${codigo} ${b.codigo_fornecedor ?? ''}`).includes(termo)) continue
    const custo = num(b.custo_unit)
    const custoMedio = m?.custoMedio ?? null
    const menor = menorCusto.get(cod)
    linhas.push({
      ...b, codigo, descricao, familia, tipo, inativo, custoMedio, estoque: m?.estoque ?? 0,
      nFornecedores: porProduto.get(cod)?.length ?? 1,
      maisBarato: menor != null && custo != null && custo === menor,
      variacaoPct: custo != null && custoMedio != null && custoMedio > 0 ? Math.round(((custo - custoMedio) / custoMedio) * 1000) / 10 : null,
    })
  }
  linhas.sort(op.ver === 'fornecedor'
    ? (a, b) => cmp(a.fornecedor, b.fornecedor) || cmp(a.descricao, b.descricao) || a.n_cod_prod - b.n_cod_prod
    : (a, b) => cmp(a.descricao, b.descricao) || a.n_cod_prod - b.n_cod_prod || (b.ultima_data ?? '').localeCompare(a.ultima_data ?? '') || cmp(a.fornecedor, b.fornecedor))

  const prods = new Set(linhas.map((l) => l.n_cod_prod))
  return {
    linhas,
    resumo: {
      produtos: prods.size,
      fornecedores: new Set(linhas.map((l) => l.fornecedor_chave)).size,
      pares: linhas.length,
      multiFornecedor: [...prods].filter((p) => (porProduto.get(p)?.length ?? 0) > 1).length,
    },
  }
}
