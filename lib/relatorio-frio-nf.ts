// Leitura fria (Contabo) para os relatórios baseados em nota fiscal —
// Compras, Auditoria Fiscal e o lado Compras dos Indicadores. As RPCs desses
// relatórios leem só o Supabase (janela quente de 90 dias); quando o período
// pedido começa antes do corte, a fatia antiga vem daqui: itens crus do
// Contabo + reagregação em JS espelhando fielmente o WHERE/GROUP BY das
// funções SQL (075_relatorio_compras_produto_local.sql e
// 076_auditoria_fiscal_produto_familia_local.sql). Se a função SQL mudar,
// replicar aqui também — mesmo contrato do precedente agregarMovimentacaoJS.
import { buscarFrio } from '@/lib/historico-contabo'

type Json = Record<string, unknown>

export type ItemNFFrio = {
  id: number
  nota_fiscal_id: number
  loja_id: number
  n_id_produto: number | null
  c_codigo_produto: string | null
  c_descricao_produto: string | null
  c_cfop: string | null
  n_qtde_nfe: number | string | null
  n_preco_unit: number | string | null
  full_object: Json | null
  nf_d_emissao_nfe: string
  nf_c_numero_nfe: string | null
  // enriquecidos pelo join client-side com /notas_fiscais:
  nf_c_etapa?: string | null
  nf_fornecedor?: string | null
  nf_cancelada?: boolean
}

type HeaderNFFrio = {
  id: number
  c_etapa: string | null
  c_razao_social: string | null
  c_nome: string | null
  full_object: Json | null
}

export type MetaProdutoNF = Map<number, { tipo: string | null; familia: string | null }>

/**
 * Busca itens de NF do Contabo no período, já enriquecidos com os campos do
 * cabeçalho que as agregações precisam (etapa, fornecedor, cancelada).
 * O endpoint /nota_fiscal_items já exclui NF deletada (deleted_at is null).
 * Teto do endpoint: 5000 itens / 2000 headers por chamada — suficiente pra
 * janela [início do ano, corte de 90 dias]; se o volume crescer além disso,
 * o endpoint precisa ganhar paginação (mudança no server.js do Contabo).
 */
export async function buscarItensNFFrio(opts: {
  lojaId: number
  dataInicio: string
  dataFinal: string
}): Promise<ItemNFFrio[]> {
  const [itens, headers] = await Promise.all([
    buscarFrio<ItemNFFrio>('/nota_fiscal_items', {
      loja_id: opts.lojaId,
      data_inicio: opts.dataInicio,
      data_final: opts.dataFinal,
    }),
    buscarFrio<HeaderNFFrio>('/notas_fiscais', {
      loja_id: opts.lojaId,
      data_inicio: opts.dataInicio,
      data_final: opts.dataFinal,
    }),
  ])
  const porId = new Map(headers.map((h) => [h.id, h]))
  for (const it of itens) {
    const h = porId.get(it.nota_fiscal_id)
    it.nf_c_etapa = h?.c_etapa ?? null
    it.nf_fornecedor = h?.c_razao_social || h?.c_nome || null
    const info = (h?.full_object as { infoCadastro?: { cCancelada?: string } } | null)?.infoCadastro
    it.nf_cancelada = (info?.cCancelada ?? 'N') === 'S'
  }
  return itens
}

const ajustesDe = (it: ItemNFFrio) =>
  (it.full_object as { itensAjustes?: Json } | null)?.itensAjustes ?? null

export const cfopEntradaDe = (it: ItemNFFrio): string | null =>
  ((ajustesDe(it) as { cCFOPEntrada?: string } | null)?.cCFOPEntrada ?? null)

const localDe = (it: ItemNFFrio): number | null => {
  const v = (ajustesDe(it) as { codigo_local_estoque?: number | string } | null)?.codigo_local_estoque
  return v == null ? null : Number(v)
}

const cfopDocDe = (it: ItemNFFrio): string | null =>
  it.c_cfop ??
  ((it.full_object as { itensCabec?: { cCFOP?: string } } | null)?.itensCabec?.cCFOP ?? null)

const valorDe = (it: ItemNFFrio): number => (Number(it.n_qtde_nfe) || 0) * (Number(it.n_preco_unit) || 0)

const right3 = (s: string | null): string => (s ?? '').replace(/\D/g, '').slice(-3)

const ilike = (campo: string | null | undefined, termo: string): boolean =>
  (campo ?? '').toLowerCase().includes(termo.toLowerCase())

export type FiltrosComprasFrio = {
  familias: string[]
  tipos: string[]
  fornecedor: string | null
  cfops: string[]
  produto: string | null
  local: number | null
}

/** Espelha o WHERE das relatorio_compras_* (incl. exclusão de CFOP 910/908). */
export function filtrarItensCompras(
  itens: ItemNFFrio[],
  f: FiltrosComprasFrio,
  meta: MetaProdutoNF
): ItemNFFrio[] {
  return itens.filter((it) => {
    const m = it.n_id_produto != null ? meta.get(Number(it.n_id_produto)) : undefined
    if (f.familias.length && !f.familias.includes(m?.familia ?? '')) return false
    if (f.tipos.length && !f.tipos.includes(m?.tipo ?? '')) return false
    if (f.fornecedor && !ilike(it.nf_fornecedor, f.fornecedor)) return false
    const cfopEnt = cfopEntradaDe(it)
    if (f.cfops.length && !f.cfops.includes(cfopEnt ?? '')) return false
    if (f.produto && !ilike(it.c_descricao_produto, f.produto) && !ilike(it.c_codigo_produto, f.produto)) return false
    if (f.local !== null && localDe(it) !== f.local) return false
    if (['910', '908'].includes(right3(cfopEnt))) return false
    return true
  })
}

export function agregarComprasTotal(itens: ItemNFFrio[]): { valor: number; nNotas: number } {
  const notas = new Set<number>()
  let valor = 0
  for (const it of itens) {
    valor += valorDe(it)
    notas.add(it.nota_fiscal_id)
  }
  return { valor, nNotas: notas.size }
}

export function agregarComprasMatriz(
  itens: ItemNFFrio[],
  dim: string,
  meta: MetaProdutoNF
): { rotulo: string; mes: string; valor: number }[] {
  const grupos = new Map<string, { rotulo: string; mes: string; valor: number }>()
  for (const it of itens) {
    const m = it.n_id_produto != null ? meta.get(Number(it.n_id_produto)) : undefined
    const cru =
      dim === 'familia' ? m?.familia
      : dim === 'tipo' ? m?.tipo
      : dim === 'produto' ? it.c_descricao_produto
      : dim === 'fornecedor' ? it.nf_fornecedor
      : cfopEntradaDe(it)
    const rotulo = cru || 'Sem classificação'
    const mes = it.nf_d_emissao_nfe.slice(0, 7)
    const k = `${rotulo}|${mes}`
    const e = grupos.get(k) ?? { rotulo, mes, valor: 0 }
    e.valor += valorDe(it)
    grupos.set(k, e)
  }
  return [...grupos.values()]
}

export type FiltrosAuditoriaFrio = {
  produto: string | null
  familia: string | null
  fornecedor: string | null
  local: number | null
}

/** Espelha o WHERE das relatorio_auditoria_fiscal_* (etapa 60, não cancelada). */
export function filtrarItensAuditoria(
  itens: ItemNFFrio[],
  f: FiltrosAuditoriaFrio,
  meta: MetaProdutoNF
): ItemNFFrio[] {
  return itens.filter((it) => {
    if (it.nf_c_etapa !== '60') return false
    if (it.nf_cancelada) return false
    if (f.produto && !ilike(it.c_descricao_produto, f.produto) && !ilike(it.c_codigo_produto, f.produto)) return false
    if (f.familia) {
      const m = it.n_id_produto != null ? meta.get(Number(it.n_id_produto)) : undefined
      if ((m?.familia ?? '') !== f.familia) return false
    }
    if (f.fornecedor && !ilike(it.nf_fornecedor, f.fornecedor)) return false
    if (f.local !== null && localDe(it) !== f.local) return false
    return true
  })
}

const creditaIcmsDe = (it: ItemNFFrio): boolean =>
  (((ajustesDe(it) as { itensSitTribEnt?: { cNaoCredICMSE?: string } } | null)?.itensSitTribEnt
    ?.cNaoCredICMSE ?? 'N') !== 'S')

const moveEstoqueDe = (it: ItemNFFrio): boolean =>
  (((ajustesDe(it) as { cNaoGerarMovEstoque?: string } | null)?.cNaoGerarMovEstoque ?? 'N') !== 'S')

export function agregarAuditoriaCfop(itens: ItemNFFrio[]): {
  cfop_doc: string
  cfop_entrada: string | null
  itens: number
  valor: number
  credita_icms: number
  move_estoque: number
}[] {
  const grupos = new Map<
    string,
    { cfop_doc: string; cfop_entrada: string | null; itens: number; valor: number; credita_icms: number; move_estoque: number }
  >()
  for (const it of itens) {
    const doc = cfopDocDe(it) ?? ''
    const ent = cfopEntradaDe(it)
    const k = `${doc}|${ent ?? ''}`
    const e = grupos.get(k) ?? { cfop_doc: doc, cfop_entrada: ent, itens: 0, valor: 0, credita_icms: 0, move_estoque: 0 }
    e.itens += 1
    e.valor += valorDe(it)
    if (creditaIcmsDe(it)) e.credita_icms += 1
    if (moveEstoqueDe(it)) e.move_estoque += 1
    grupos.set(k, e)
  }
  return [...grupos.values()]
}

export function mapearAuditoriaItens(
  itens: ItemNFFrio[],
  sel: { cfopDoc: string; cfopEntrada: string }
): {
  data: string
  nota: string
  fornecedor: string
  produto: string
  codigo: string
  cfop_doc: string
  cfop_entrada: string
  cst_icms: string
  origem: string
  credita_icms: boolean
  move_estoque: boolean
  valor: number
  item_id: number
}[] {
  return itens
    .filter((it) => (cfopDocDe(it) ?? '') === sel.cfopDoc && (cfopEntradaDe(it) ?? '') === sel.cfopEntrada)
    .map((it) => {
      const icms = (it.full_object as { itensICMS?: { cSitTrib?: string; cOrigem?: string } } | null)?.itensICMS
      return {
        data: it.nf_d_emissao_nfe,
        nota: it.nf_c_numero_nfe ?? '',
        fornecedor: it.nf_fornecedor ?? '',
        produto: it.c_descricao_produto ?? '',
        codigo: it.c_codigo_produto ?? '',
        cfop_doc: cfopDocDe(it) ?? '',
        cfop_entrada: cfopEntradaDe(it) ?? '',
        cst_icms: icms?.cSitTrib ?? '',
        origem: icms?.cOrigem ?? '',
        credita_icms: creditaIcmsDe(it),
        move_estoque: moveEstoqueDe(it),
        valor: valorDe(it),
        item_id: it.id,
      }
    })
}
