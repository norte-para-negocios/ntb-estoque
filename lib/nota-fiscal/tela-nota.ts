// Tela de dentro da nota fiscal (27/10/2026): contas e frases curtas a partir do que já veio do Omie/SEFAZ
// (full_object). Sem imports @/, testável via `node --test lib/nota-fiscal/tela-nota.test.ts`.

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {})
const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

export const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const qtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })

/** 34640245000103 → 34.640.245/0001-03; CPF com 11 dígitos também. Outro formato volta como veio. */
export function fmtCnpj(v: string | null | undefined): string {
  const d = String(v ?? '').replace(/\D/g, '')
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
  return String(v ?? '')
}

/**
 * Total do item: a coluna v_total_item vem vazia nas notas do Omie (o valor está em full_object.itensCabec.vTotalItem);
 * sem nenhum dos dois, quantidade × preço.
 */
export function totalDoItem(item: { v_total_item?: number | string | null; n_qtde_nfe?: number | string | null; n_preco_unit?: number | string | null; full_object?: unknown }): number | null {
  const direto = num(item.v_total_item)
  if (direto != null) return direto
  const cab = num(obj(obj(item.full_object).itensCabec).vTotalItem)
  if (cab != null) return cab
  const q = num(item.n_qtde_nfe)
  const p = num(item.n_preco_unit)
  return q != null && p != null ? Math.round(q * p * 100) / 100 : null
}

/**
 * O que entra no estoque: unidade e quantidade do cadastro (itensAjustes.cUnidade / nQtdeRecebida). Só volta quando é
 * diferente do que a nota diz (ex.: a nota diz "3 UND9" e entra "3 UN").
 */
export function entraNoEstoque(item: { n_qtde_nfe?: number | string | null; c_unidade_nfe?: string | null; full_object?: unknown }): { quantidade: number; unidade: string } | null {
  const a = obj(obj(item.full_object).itensAjustes)
  const unidade = txt(a.cUnidade)
  const quantidade = num(a.nQtdeRecebida) ?? num(item.n_qtde_nfe)
  if (!unidade || quantidade == null) return null
  const mesmaUnidade = unidade.toUpperCase() === String(item.c_unidade_nfe ?? '').trim().toUpperCase()
  const mesmaQtd = quantidade === num(item.n_qtde_nfe)
  return mesmaUnidade && mesmaQtd ? null : { quantidade, unidade }
}

/** Categoria do item no Omie (itensInfoAdic.cCategoriaItem), ex.: "2.01.01". */
export function categoriaDoItemOmie(fullObject: unknown): string | null {
  return txt(obj(obj(fullObject).itensInfoAdic).cCategoriaItem)
}

const FRETE: Record<string, string> = {
  '0': 'por conta do fornecedor (CIF)',
  '1': 'por conta da loja (FOB)',
  '2': 'por conta de terceiros',
  '3': 'transporte próprio do fornecedor',
  '4': 'transporte próprio da loja',
  '9': 'sem transporte',
}

export type Resumos = {
  fornecedor: string
  transporte: string | null
  impostos: string
  parcelas: string | null
  situacao: string | null
}

/** Uma frase por seção recolhida (o que aparece sem abrir). `transporte`/`parcelas` null = a nota não tem. */
export function resumosDaNota(fullObject: unknown, nomeFornecedor: string | null, semOmie: boolean): Resumos {
  const fo = obj(fullObject)
  const cabec = obj(fo.cabec)
  const tr = obj(fo.transporte)
  const tot = obj(fo.totais)
  const ic = obj(fo.infoCadastro)
  const parcelas = Array.isArray(obj(fo.parcelas).parcelasLista) ? (obj(fo.parcelas).parcelasLista as Obj[]) : []

  const fornecedor = [nomeFornecedor, txt(cabec.cCNPJ_CPF) && `CNPJ ${fmtCnpj(txt(cabec.cCNPJ_CPF))}`, txt(cabec.cInscricao) && `IE ${txt(cabec.cInscricao)}`]
    .filter(Boolean)
    .join(' · ')

  const tipoFrete = txt(tr.cTipoFrete)
  const nomeTransp = txt(tr.cNomeTransp)
  const volumes = num(tr.nQtdeVolume)
  const temTransporte = !!nomeTransp || (tipoFrete != null && tipoFrete !== '9') || (volumes != null && volumes > 0)
  const valorFrete = num(tot.vFrete) ?? 0
  const transporte = temTransporte
    ? [
        tipoFrete ? (FRETE[tipoFrete] ?? `frete ${tipoFrete}`) : null,
        nomeTransp,
        volumes ? `${qtd(volumes)} ${volumes === 1 ? 'volume' : 'volumes'}` : null,
        valorFrete > 0 ? `frete ${brl(valorFrete)}` : null,
      ]
        .filter(Boolean)
        .join(' · ')
        .replace(/^./, (c) => c.toUpperCase())
    : null

  const mercadorias = num(tot.vTotalProdutos)
  const extras = (['vTotalDescontos', 'vTotalIPI', 'vICMSSubstituicao', 'vFrete'] as const).filter((k) => (num(tot[k]) ?? 0) > 0)
  const nomes: Record<string, string> = { vTotalDescontos: 'desconto', vTotalIPI: 'IPI', vICMSSubstituicao: 'ST', vFrete: 'frete' }
  const impostos = [
    mercadorias != null ? `Mercadorias ${brl(mercadorias)}` : null,
    extras.length ? extras.map((k) => `${nomes[k]} ${brl(num(tot[k]) ?? 0)}`).join(' · ') : 'sem desconto, IPI, ST ou frete',
  ]
    .filter(Boolean)
    .join(' · ')

  const parcelasTxt = parcelas.length
    ? parcelas.length === 1
      ? `1 parcela · vence ${txt(parcelas[0].dVencimento) ?? '?'}`
      : `${parcelas.length} parcelas · a 1ª vence ${txt(parcelas[0].dVencimento) ?? '?'}`
    : null

  let situacao: string | null = null
  if (Object.keys(ic).length) {
    const partes: string[] = []
    if (ic.cCancelada === 'S') partes.push('cancelada')
    if (ic.cDevolvido === 'S') partes.push('devolvida')
    if (ic.cBloqueado === 'S') partes.push('bloqueada')
    partes.push(ic.cRecebido === 'S' ? `recebida${txt(ic.dRec) ? ` em ${txt(ic.dRec)}` : ''}` : 'ainda não recebida')
    if (!semOmie && ic.cFaturado === 'S') partes.push(`faturada${txt(ic.dFat) ? ` em ${txt(ic.dFat)}` : ''}`)
    situacao = partes.join(' · ').replace(/^./, (c) => c.toUpperCase())
  }

  return { fornecedor: fornecedor || 'Sem dados do fornecedor', transporte, impostos, parcelas: parcelasTxt, situacao }
}

/** Totais para o painel de entrada: mercadorias, o resto (desconto negativo) e o total da nota. */
export function totaisDaNota(fullObject: unknown, valorNota: number | null, somaItens: number): { mercadorias: number; outros: number; total: number } {
  const tot = obj(obj(fullObject).totais)
  const mercadorias = num(tot.vTotalProdutos) ?? somaItens
  const total = num(tot.vTotalNFe) ?? valorNota ?? somaItens
  return { mercadorias, outros: Math.round((total - mercadorias) * 100) / 100, total }
}

/**
 * Categoria que a nota nova recebe sozinha (loja própria, na chegada pela SEFAZ): a do fornecedor quando ele é
 * constante — pelo menos 2 notas anteriores e 80% dos itens classificados nelas na mesma categoria. Senão null
 * (a pessoa escolhe; a tela só sugere).
 */
export function categoriaAutomatica(itensPorCategoria: Map<number, number>, notasAnteriores: number): number | null {
  if (notasAnteriores < 2) return null
  const total = [...itensPorCategoria.values()].reduce((a, b) => a + b, 0)
  if (!total) return null
  const [id, n] = [...itensPorCategoria.entries()].sort((a, b) => b[1] - a[1])[0]
  return n / total >= 0.8 ? id : null
}
