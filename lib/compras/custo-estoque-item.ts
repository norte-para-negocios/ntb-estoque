// Valor de estoque de um item de nota recebida, na regra do Omie (regra N3 corrigida, omie-rea/regras/
// entrada-nf-fornecedor.md e xml-para-recebimento.md). O `vTotalItem` do Omie JÁ vem sem o desconto e já contém IPI,
// ICMS-ST e a parte do item nas despesas (vProd − vDesc + vIPI + vICMSST + vFCPST + vOutro + vFrete + vSeg, provado em
// 100/100 itens de 8 XMLs); as 8 marcações "é custo de estoque" de cada item tiram o que não entra no custo.
// Bate com o kardex do Omie em 1.014 de 1.021 pares nota × produto da loja 5 (quantidade × preço, o que os relatórios
// usavam, bate só 83,8 %). Puro: node --test lib/compras/custo-estoque-item.test.ts.

export type FlagsCustoOmie = {
  cICMSCusto?: string; cICMSSTCusto?: string; cIPICusto?: string; cPISCusto?: string; cCOFINSCusto?: string
  cOutrosDespCusto?: string; cFreteCusto?: string; cSeguroCusto?: string
  nAliqCredPISCusto?: number | string; nAliqCredCOFINSCusto?: number | string
}
export type EntradaCustoItem = { qtde: number; precoUnit: number; vTotalItem: number | null; vDesconto: number; vIPI: number; vST: number; vICMS: number; flags: FlagsCustoOmie | null }
export type CustoItem = { valorFiscal: number; valorEstoque: number; despesas: number; fonte: 'omie' | 'fiscal' }
export type TipoValorCompra = 'estoque' | 'fiscal'

const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

export function entradaCustoDoItem(fullObject: unknown, qtde: unknown, precoUnit: unknown): EntradaCustoItem {
  const fo = obj(fullObject)
  const cab = obj(fo.itensCabec)
  const total = cab.vTotalItem
  const flags = fo.itensCustoEstoque && typeof fo.itensCustoEstoque === 'object' ? (fo.itensCustoEstoque as FlagsCustoOmie) : null
  return {
    qtde: num(qtde), precoUnit: num(precoUnit),
    vTotalItem: total === undefined || total === null || total === '' ? null : num(total),
    vDesconto: num(cab.vDesconto), vIPI: num(obj(fo.itensIPI).nValIPI), vST: num(obj(fo.itensICMSST).nValorST), vICMS: num(obj(fo.itensICMS).nValor),
    flags,
  }
}

export function custoEstoqueItemOmie(e: EntradaCustoItem): CustoItem {
  const valorFiscal = e.qtde * e.precoUnit
  if (!e.flags || e.vTotalItem === null) return { valorFiscal, valorEstoque: round2(valorFiscal), despesas: 0, fonte: 'fiscal' }
  const f = e.flags
  const n = (k: keyof FlagsCustoOmie) => (f[k] ?? 'N') === 'N'
  const t = e.vTotalItem
  // frete, seguro e outras despesas do item juntos (N3b: frete/seguro sem caso real na loja 5 — hipótese de que entram
  // pelo mesmo vTotalItem e saem pela marcação de outras despesas)
  const despesas = Math.max(0, round2(t - (e.qtde * e.precoUnit - e.vDesconto) - e.vIPI - e.vST))
  const valorEstoque = round2(t
    - (n('cIPICusto') ? e.vIPI : 0) - (n('cICMSSTCusto') ? e.vST : 0) - (n('cICMSCusto') ? e.vICMS : 0)
    - (n('cPISCusto') ? t * num(f.nAliqCredPISCusto) / 100 : 0)
    - (n('cCOFINSCusto') ? t * num(f.nAliqCredCOFINSCusto) / 100 : 0)
    - (n('cOutrosDespCusto') ? despesas : 0))
  return { valorFiscal, valorEstoque, despesas, fonte: 'omie' }
}

/** Item que o Omie não lança no estoque: "não movimenta estoque" ou "ignorar item". "Não gera conta a pagar" entra. */
export function itemMovimentaEstoque(fullObject: unknown): boolean {
  const fo = obj(fullObject)
  return obj(fo.itensAjustes).cNaoGerarMovEstoque !== 'S' && obj(fo.itensCabec).cIgnorarItem !== 'S'
}

export function lerTipoValor(v: string | string[] | null | undefined): TipoValorCompra {
  const s = Array.isArray(v) ? v[0] : v
  return s === 'fiscal' ? 'fiscal' : 'estoque'
}
