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
export type EntradaCustoItem = {
  qtde: number; precoUnit: number; vTotalItem: number | null; vDesconto: number; vIPI: number; vST: number; vICMS: number; flags: FlagsCustoOmie | null
  /** Só na nota do estoque próprio (bloco `sefaz` da projeção, Fase B/R3): frete, seguro e CT-e com as suas marcações. */
  vFrete?: number; vSeguro?: number; freteExterno?: number
}
export type CustoItem = { valorFiscal: number; valorEstoque: number; despesas: number; fonte: 'omie' | 'fiscal' }
export type TipoValorCompra = 'estoque' | 'fiscal'

const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

/** ICMS que sai do custo quando "ICMS é custo" = N. No Simples Nacional (CSOSN 101/201) a nota não tem ICMS próprio
 *  (`itensICMS.nValor` = 0) e o crédito é o do Simples (`itensICMSSN.nCredSN`, no XML `vCredICMSSN`): o Omie tira esse
 *  crédito do custo. PROVADO 20/10/2026 com o kardex da loja 5 (omie-rea/gaps/paridade-numerica-2026-10-20.md, bug 3):
 *  6 de 6 pares NF × produto (34972 / 60781: 318,00 → 305,66 = kardex; 4922, 4958, 4988, 5008, 5037 / 80074: custo
 *  unitário igual ao do kardex nas 6 casas). Mesma regra na projeção SQL da nota própria (185) e em
 *  custo_estoque_item_omie (280). */
export function icmsDoCusto(icms: number, csosn: string | null | undefined, credIcmsSn: number | null | undefined): number {
  return (Number(icms) || 0) === 0 && (csosn === '101' || csosn === '201') ? Number(credIcmsSn) || 0 : Number(icms) || 0
}

export function entradaCustoDoItem(fullObject: unknown, qtde: unknown, precoUnit: unknown): EntradaCustoItem {
  const fo = obj(fullObject)
  const cab = obj(fo.itensCabec)
  const total = cab.vTotalItem
  const flags = fo.itensCustoEstoque && typeof fo.itensCustoEstoque === 'object' ? (fo.itensCustoEstoque as FlagsCustoOmie) : null
  // Item do Omie não tem bloco `sefaz` (D1: nenhuma chave de frete/seguro em itensCabec): os três ficam indefinidos e o
  // cálculo é exatamente o da Fase A.
  const sefaz = fo.sefaz && typeof fo.sefaz === 'object' ? obj(fo.sefaz) : null
  const extras = sefaz ? { vFrete: num(sefaz.vFrete), vSeguro: num(sefaz.vSeg), freteExterno: num(sefaz.freteCte) } : {}
  return {
    ...extras,
    qtde: num(qtde), precoUnit: num(precoUnit),
    vTotalItem: total === undefined || total === null || total === '' ? null : num(total),
    vDesconto: num(cab.vDesconto), vIPI: num(obj(fo.itensIPI).nValIPI), vST: num(obj(fo.itensICMSST).nValorST),
    vICMS: icmsDoCusto(num(obj(fo.itensICMS).nValor), obj(fo.itensICMSSN).cSitTribSN as string | undefined, num(obj(fo.itensICMSSN).nCredSN)),
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
  const impostos = t
    - (n('cIPICusto') ? e.vIPI : 0) - (n('cICMSSTCusto') ? e.vST : 0) - (n('cICMSCusto') ? e.vICMS : 0)
    - (n('cPISCusto') ? t * num(f.nAliqCredPISCusto) / 100 : 0)
    - (n('cCOFINSCusto') ? t * num(f.nAliqCredCOFINSCusto) / 100 : 0)
  if (e.vFrete === undefined && e.vSeguro === undefined && e.freteExterno === undefined) {
    return { valorFiscal, valorEstoque: round2(impostos - (n('cOutrosDespCusto') ? despesas : 0)), despesas, fonte: 'omie' }
  }
  // Nota própria (R3): frete e seguro do item saem pelas próprias marcações; outras despesas = o resto (HIPÓTESE N3b: sem
  // caso real de frete/seguro por item na loja 5); CT-e entra só com Frete = S (HIPÓTESE N8, sem fórmula provada no Omie).
  const vFrete = e.vFrete ?? 0, vSeguro = e.vSeguro ?? 0
  const outras = Math.max(0, round2(despesas - vFrete - vSeguro))
  const valorEstoque = round2(impostos
    - (n('cFreteCusto') ? vFrete : 0) - (n('cSeguroCusto') ? vSeguro : 0) - (n('cOutrosDespCusto') ? outras : 0)
    + (n('cFreteCusto') ? 0 : (e.freteExterno ?? 0)))
  return { valorFiscal, valorEstoque, despesas, fonte: 'omie' }
}

/** Custo unitário da entrada: valor de estoque do item ÷ quantidade recebida (unidade de estoque), 6 casas (R3/R4). */
export function custoUnitarioEntrada(valorEstoque: number, quantidadeRecebida: number): number | null {
  if (!(quantidadeRecebida > 0)) return null
  return Math.round((valorEstoque / quantidadeRecebida) * 1e6) / 1e6
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
