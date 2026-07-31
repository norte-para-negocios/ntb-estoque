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

export const TETO_ITENS = 5000
export const TETO_HEADERS = 2000
export const TETO_FAT = 5000

const addDia = (d: string): string => new Date(Date.parse(d) + 86400000).toISOString().slice(0, 10)

/**
 * Busca em `caminho` paginando por DATA (o endpoint não tem offset/limit):
 * se a resposta vier no teto documentado do endpoint (5000 itens / 2000
 * headers por chamada), o Contabo pode estar cortando dados sem avisar —
 * divide o intervalo [dataInicio, dataFinal] ao meio e refaz recursivamente
 * até cada pedaço vir abaixo do teto. Achado real (2026-07-18, auditoria de
 * Pendências de Classificação): TODAS as lojas com volume médio+ (2,3,4,5,6)
 * batiam exatamente 5000 numa janela de 9 meses -- a soma de sub-janelas
 * menores mostrou até 8857 itens reais pra loja 3 (quase 44% descartado em
 * silêncio). Mesma classe de bug do teto de 1000 linhas do PostgREST, só que
 * no endpoint do Contabo.
 */
export async function buscarComPaginacaoPorData<T>(
  caminho: string,
  lojaId: number,
  dataInicio: string,
  dataFinal: string,
  teto: number
): Promise<T[]> {
  const rows = (await buscarFrio<T>(caminho, { loja_id: lojaId, data_inicio: dataInicio, data_final: dataFinal })) ?? []
  if (rows.length < teto || dataInicio >= dataFinal) return rows
  const meio = new Date((Date.parse(dataInicio) + Date.parse(dataFinal)) / 2).toISOString().slice(0, 10)
  const inicioSegunda = addDia(meio)
  if (meio < dataInicio || inicioSegunda > dataFinal) return rows // intervalo de 1 dia, não dá pra dividir mais
  const [a, b] = await Promise.all([
    buscarComPaginacaoPorData<T>(caminho, lojaId, dataInicio, meio, teto),
    buscarComPaginacaoPorData<T>(caminho, lojaId, inicioSegunda, dataFinal, teto),
  ])
  return [...a, ...b]
}

/**
 * Busca itens de NF do Contabo no período, já enriquecidos com os campos do
 * cabeçalho que as agregações precisam (etapa, fornecedor, cancelada).
 * O endpoint /nota_fiscal_items já exclui NF deletada (deleted_at is null).
 */
export async function buscarItensNFFrio(opts: {
  lojaId: number
  dataInicio: string
  dataFinal: string
}): Promise<ItemNFFrio[]> {
  const [itens, headers] = await Promise.all([
    buscarComPaginacaoPorData<ItemNFFrio>('/nota_fiscal_items', opts.lojaId, opts.dataInicio, opts.dataFinal, TETO_ITENS),
    buscarComPaginacaoPorData<HeaderNFFrio>('/notas_fiscais', opts.lojaId, opts.dataInicio, opts.dataFinal, TETO_HEADERS),
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

// Resolve o conjunto de `nota_fiscal_id` (espaço de ID do CONTABO, nao do
// Supabase) que casam com o filtro de tipo/familia/produto/local -- usado
// pra completar esse filtro na fatia fria de notas_fiscais/nota_fiscal_items
// (nota-fiscal/page.tsx e os 2 arquivos irmaos). `codigosProduto` ja vem
// resolvido localmente (join com `produtos`, que nunca e duplicado no
// Contabo) -- aqui so cruza com os itens crus do Contabo. Achado real
// (2026-07-26): reaproveitar um Set de ids derivado do Supabase pra filtrar
// linhas do Contabo e o MESMO bug de espaco de ID ja corrigido pra
// movimentos/NF/OP (commits 3f02341/46b6279/2ea39ce) -- o Contabo gera seu
// proprio id (dual-write ja em producao), entao o filtro precisa devolver
// ids no espaco CERTO pra fatia que vai usa-lo.
export async function buscarNotaIdsFrio(opts: {
  lojaId: number
  dataInicio: string
  dataFinal: string
  codigosProduto: string[] | null
  produtoBusca: string | null
  localCod: number | null
}): Promise<Set<number>> {
  const itens = await buscarItensNFFrio({ lojaId: opts.lojaId, dataInicio: opts.dataInicio, dataFinal: opts.dataFinal })
  const termo = opts.produtoBusca?.toLowerCase() || null
  const ids = new Set<number>()
  for (const it of itens) {
    if (opts.codigosProduto && !opts.codigosProduto.includes(String(it.n_id_produto))) continue
    if (termo && !ilike(it.c_descricao_produto, termo) && !ilike(it.c_codigo_produto, termo)) continue
    if (opts.localCod !== null && localDe(it) !== opts.localCod) continue
    ids.add(it.nota_fiscal_id)
  }
  return ids
}

const ajustesDe = (it: ItemNFFrio) =>
  (it.full_object as { itensAjustes?: Json } | null)?.itensAjustes ?? null

export const cfopEntradaDe = (it: ItemNFFrio): string | null =>
  ((ajustesDe(it) as { cCFOPEntrada?: string } | null)?.cCFOPEntrada ?? null)

export const localDe = (it: ItemNFFrio): number | null => {
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

// Espelha a funcao SQL nf_bate_status (migration 097) -- CONCLUIDA e o
// padrao (bate com o hardcode anterior de Compras/Auditoria), PENDENTE e
// CANCELADA se somam exatamente ao TODAS (particao exaustiva, validado
// contra dado real na migration).
function itemBateStatus(it: ItemNFFrio, status: string | undefined): boolean {
  const s = status || 'CONCLUIDA'
  if (s === 'TODAS') return true
  if (s === 'CANCELADA') return !!it.nf_cancelada
  if (s === 'PENDENTE') return it.nf_c_etapa !== '60' && !it.nf_cancelada
  return it.nf_c_etapa === '60' && !it.nf_cancelada
}

export type FiltrosComprasFrio = {
  status: string
  familias: string[]
  tipos: string[]
  fornecedor: string | null
  cfops: string[]
  produto: string | null
  local: number | null
}

const SEM = '__sem__'

/** Espelha o WHERE das relatorio_compras_* (incl. exclusão de CFOP 910/908, o
 * sentinela '__sem__' = valor nulo (migration 077), e o filtro de status
 * (migration 097, default CONCLUIDA — mesmo comportamento do hardcode
 * anterior da migration 083)). */
export function filtrarItensCompras(
  itens: ItemNFFrio[],
  f: FiltrosComprasFrio,
  meta: MetaProdutoNF
): ItemNFFrio[] {
  return itens.filter((it) => {
    if (!itemBateStatus(it, f.status)) return false
    const m = it.n_id_produto != null ? meta.get(Number(it.n_id_produto)) : undefined
    if (f.familias.length) {
      const fam = m?.familia ?? null
      const casa = (fam !== null && f.familias.includes(fam)) || (f.familias.includes(SEM) && fam === null)
      if (!casa) return false
    }
    if (f.tipos.length) {
      const tipo = m?.tipo ?? null
      const casa = (tipo !== null && f.tipos.includes(tipo)) || (f.tipos.includes(SEM) && tipo === null)
      if (!casa) return false
    }
    if (f.fornecedor) {
      if (f.fornecedor === SEM) { if (it.nf_fornecedor != null) return false }
      else if (!ilike(it.nf_fornecedor, f.fornecedor)) return false
    }
    const cfopEnt = cfopEntradaDe(it)
    if (f.cfops.length) {
      const casa = (cfopEnt !== null && f.cfops.includes(cfopEnt)) || (f.cfops.includes(SEM) && cfopEnt === null)
      if (!casa) return false
    }
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

export type LinhaDetalheCompra = {
  data: string; mes: string; nota: string; fornecedor: string
  tipo: string | null; familia: string | null; produto: string; codigo: string
  ncm: string; cfop: string; unidade: string; qtde: number; preco_unit: number; total: number
}

/** Espelha o SELECT de relatorio_compras_detalhe pro pedaço frio (migration 077). */
export function mapearComprasDetalhe(itens: ItemNFFrio[], meta: MetaProdutoNF): LinhaDetalheCompra[] {
  return itens.map((it) => {
    const m = it.n_id_produto != null ? meta.get(Number(it.n_id_produto)) : undefined
    const fo = it.full_object as { itensCabec?: { cNCM?: string } } | null
    return {
      data: it.nf_d_emissao_nfe,
      mes: it.nf_d_emissao_nfe.slice(0, 7),
      nota: it.nf_c_numero_nfe ?? '',
      fornecedor: it.nf_fornecedor ?? '',
      tipo: m?.tipo ?? null,
      familia: m?.familia ?? null,
      produto: it.c_descricao_produto ?? '',
      codigo: it.c_codigo_produto ?? '',
      ncm: fo?.itensCabec?.cNCM ?? '',
      cfop: cfopEntradaDe(it) ?? '',
      unidade: (it as { c_unidade_nfe?: string | null }).c_unidade_nfe ?? '',
      qtde: Number(it.n_qtde_nfe) || 0,
      preco_unit: Number(it.n_preco_unit) || 0,
      total: valorDe(it),
    }
  })
}

export type FiltrosAuditoriaFrio = {
  status: string
  produto: string | null
  familias: string[]
  fornecedor: string | null
  local: number | null
}

/** Espelha o WHERE das relatorio_auditoria_fiscal_* (status via nf_bate_status, migration 097). */
export function filtrarItensAuditoria(
  itens: ItemNFFrio[],
  f: FiltrosAuditoriaFrio,
  meta: MetaProdutoNF
): ItemNFFrio[] {
  return itens.filter((it) => {
    if (!itemBateStatus(it, f.status)) return false
    if (f.produto && !ilike(it.c_descricao_produto, f.produto) && !ilike(it.c_codigo_produto, f.produto)) return false
    if (f.familias.length) {
      const m = it.n_id_produto != null ? meta.get(Number(it.n_id_produto)) : undefined
      const fam = m?.familia ?? null
      const casa = (fam !== null && f.familias.includes(fam)) || (f.familias.includes(SEM) && fam === null)
      if (!casa) return false
    }
    if (f.fornecedor) {
      if (f.fornecedor === SEM) { if (it.nf_fornecedor != null) return false }
      else if (!ilike(it.nf_fornecedor, f.fornecedor)) return false
    }
    if (f.local !== null && localDe(it) !== f.local) return false
    return true
  })
}

const creditaIcmsDe = (it: ItemNFFrio): boolean =>
  (((ajustesDe(it) as { itensSitTribEnt?: { cNaoCredICMSE?: string } } | null)?.itensSitTribEnt
    ?.cNaoCredICMSE ?? 'N') !== 'S')

const moveEstoqueDe = (it: ItemNFFrio): boolean =>
  (((ajustesDe(it) as { cNaoGerarMovEstoque?: string } | null)?.cNaoGerarMovEstoque ?? 'N') !== 'S')

// nValor de itensICMS vem do full_object (JSONB) do Contabo -- pode ter sido
// gravado como number ou string dependendo da ingestão original; Number()
// cobre os dois casos (mesmo cuidado do valorDe()).
const icmsValorDe = (it: ItemNFFrio): number =>
  Number((it.full_object as { itensICMS?: { nValor?: number | string } } | null)?.itensICMS?.nValor) || 0

export function agregarAuditoriaCfop(itens: ItemNFFrio[]): {
  cfop_doc: string
  cfop_entrada: string | null
  itens: number
  valor: number
  credita_icms: number
  move_estoque: number
  icms_creditado: number
}[] {
  const grupos = new Map<
    string,
    { cfop_doc: string; cfop_entrada: string | null; itens: number; valor: number; credita_icms: number; move_estoque: number; icms_creditado: number }
  >()
  for (const it of itens) {
    const doc = cfopDocDe(it) ?? ''
    const ent = cfopEntradaDe(it)
    const k = `${doc}|${ent ?? ''}`
    const e = grupos.get(k) ?? { cfop_doc: doc, cfop_entrada: ent, itens: 0, valor: 0, credita_icms: 0, move_estoque: 0, icms_creditado: 0 }
    e.itens += 1
    e.valor += valorDe(it)
    const credita = creditaIcmsDe(it)
    if (credita) { e.credita_icms += 1; e.icms_creditado += icmsValorDe(it) }
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
    .filter((it) => {
      if ((cfopDocDe(it) ?? '') !== sel.cfopDoc) return false
      const ent = cfopEntradaDe(it)
      if (sel.cfopEntrada === SEM) return ent === null
      return (ent ?? '') === sel.cfopEntrada
    })
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
