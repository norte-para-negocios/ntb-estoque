import { createClient } from '@/lib/supabase/server'
import { custoEstoqueItemOmie, icmsDoCusto, type FlagsCustoOmie } from '@/lib/compras/custo-estoque-item'
import { buscarTudoPaginado, buscarTodosPorIds, escapeIlike, escapeIlikeOr } from '@/lib/utils-busca'
import { resolverCategoriaOrClause } from '@/lib/nota-fiscal-categoria'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { SEM_FAMILIA, SEM_FORNECEDOR, transportadoraDe, type ItemCompra, type NotaLeve } from '@/lib/notas-compras'

// Leitura do painel de Notas Fiscais (compras recebidas). So o banco principal: ele tem
// todo o historico de NF desde 2025-06 (ver limiteJanelaQuenteNF em lib/historico-contabo.ts;
// conferido 15/10/2026, loja 5: 3393 notas no principal, 0 que existam so no Contabo).
// Filtros que dependem de item (tipo, familia, produto, local) e os de texto da nota
// (natureza, categoria) vao ao banco; fornecedor, situacao e numero sao feitos em memoria
// (lib/notas-compras.ts), pra a lista de fornecedores do filtro sair da mesma leitura.

export type FiltrosBancoNF = {
  tipos: string[]
  familias: string[]
  produto: string
  local: number | null
  natureza: string
  categoria: string
}

type LinhaNF = {
  id: number
  d_emissao_nfe: string | null
  c_numero_nfe: string | null
  c_serie_nfe: string | null
  c_razao_social: string | null
  c_nome: string | null
  n_valor_nfe: number | string | null
  c_etapa: string | null
  c_natureza_operacao: string | null
  cancelada: string | null
  recebido: string | null
  sefaz: string | null
  transp: string | null
  transp_razao: string | null
}

const SELECT_NF =
  'id, d_emissao_nfe, c_numero_nfe, c_serie_nfe, c_razao_social, c_nome, n_valor_nfe, c_etapa, c_natureza_operacao, ' +
  'cancelada:full_object->infoCadastro->>cCancelada, recebido:full_object->infoCadastro->>cRecebido, sefaz:full_object->sefaz->>situacao, ' +
  'transp:full_object->transporte->>cNomeTransp, transp_razao:full_object->transporte->>cRazaoTransp'

type Res<T> = { data: T[] | null; error: { message: string } | null }

// buscarTudoPaginado trata erro como "acabaram as paginas": aqui o erro e anotado pra
// tela avisar em vez de mostrar um total menor calado.
function anotando<T>(erros: string[], onde: string, q: PromiseLike<Res<T>>): PromiseLike<{ data: T[] | null }> {
  return q.then((r) => {
    if (r.error) {
      erros.push(onde)
      console.error(`notas-compras: ${onde}`, r.error.message)
    }
    return r
  })
}

// Notas que tem pelo menos um item que bate com tipo/familia/produto/local (todo o
// historico da loja; o periodo e aplicado depois). null = sem esse filtro.
async function notaIdsPorItem(lojaId: number, f: FiltrosBancoNF, erros: string[]): Promise<number[] | null> {
  if (!f.tipos.length && !f.familias.length && !f.produto && f.local === null) return null
  const supabase = await createClient()
  let codigos: string[] | null = null
  if (f.tipos.length || f.familias.length) {
    const prods = await buscarTudoPaginado<{ codigo_produto: string | number }>((from, to) => {
      let q = supabase.from('produtos').select('codigo_produto').eq('loja_id', lojaId).order('id', { ascending: true }).range(from, to)
      if (f.tipos.length) q = q.in('tipo_item', f.tipos)
      if (f.familias.length) q = q.in('descricao_familia', f.familias)
      return anotando(erros, 'produtos do filtro', q)
    })
    codigos = prods.map((p) => String(p.codigo_produto))
    if (!codigos.length) return []
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- builder do supabase-js muda de tipo a cada filtro
  const filtrarItem = (q: any) => {
    let r = q
    if (f.produto) {
      const p = escapeIlikeOr(f.produto)
      r = r.or(`c_descricao_produto.ilike.%${p}%,c_codigo_produto.ilike.%${p}%`)
    }
    if (f.local !== null) r = r.eq('full_object->itensAjustes->>codigo_local_estoque', String(f.local))
    return r
  }
  const linhas = codigos
    ? await buscarTodosPorIds<{ nota_fiscal_id: number | null }>(codigos, (lote, from, to) =>
        anotando(erros, 'itens do filtro', filtrarItem(supabase.from('nota_fiscal_items').select('nota_fiscal_id').eq('loja_id', lojaId).in('produto_codigo', lote).order('id', { ascending: true }).range(from, to))))
    : await buscarTudoPaginado<{ nota_fiscal_id: number | null }>((from, to) =>
        anotando(erros, 'itens do filtro', filtrarItem(supabase.from('nota_fiscal_items').select('nota_fiscal_id').eq('loja_id', lojaId).order('id', { ascending: true }).range(from, to))))
  return [...new Set(linhas.map((l) => l.nota_fiscal_id).filter((v): v is number => v != null))]
}

function paraNota(r: LinhaNF): NotaLeve {
  return {
    id: r.id,
    dia: (r.d_emissao_nfe ?? '').slice(0, 10),
    numero: r.c_numero_nfe,
    serie: r.c_serie_nfe,
    fornecedor: (r.c_razao_social || r.c_nome || '').trim() || SEM_FORNECEDOR,
    natureza: r.c_natureza_operacao,
    valor: Number(r.n_valor_nfe) || 0,
    etapa: r.c_etapa,
    cancelada: r.cancelada === 'S',
    manifestada: r.recebido === 'S',
    sefazSituacao: r.sefaz,
    transportadora: transportadoraDe(r.transp, r.transp_razao),
  }
}

export async function carregarNotasCompra(lojaId: number, ini: string, fim: string, f: FiltrosBancoNF): Promise<{ notas: NotaLeve[]; erros: string[] }> {
  const erros: string[] = []
  const supabase = await createClient()
  const categoriaOr = resolverCategoriaOrClause(f.categoria)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- builder do supabase-js muda de tipo a cada filtro
  const base = (q: any) => {
    let r = q.eq('loja_id', lojaId).gte('d_emissao_nfe', ini).lte('d_emissao_nfe', fim).is('deleted_at', null)
    if (f.natureza) r = r.ilike('c_natureza_operacao', `%${escapeIlike(f.natureza)}%`)
    if (categoriaOr) r = r.or(categoriaOr)
    return r
  }
  const ids = await notaIdsPorItem(lojaId, f, erros)
  let linhas: LinhaNF[]
  if (ids === null) {
    linhas = await buscarTudoPaginado<LinhaNF>(
      (from, to) => anotando(erros, 'notas fiscais', base(supabase.from('notas_fiscais').select(SELECT_NF)).order('id', { ascending: true }).range(from, to)),
      () => base(supabase.from('notas_fiscais').select('id', { count: 'exact', head: true })),
    )
  } else if (!ids.length) {
    linhas = []
  } else {
    // ids cobre todo o historico: em lotes (um .in() unico com milhares de ids da 414).
    linhas = await buscarTodosPorIds<LinhaNF>(ids, (lote, from, to) =>
      anotando(erros, 'notas fiscais', base(supabase.from('notas_fiscais').select(SELECT_NF)).in('id', lote).order('id', { ascending: true }).range(from, to)))
  }
  return { notas: linhas.map(paraNota), erros: [...new Set(erros)] }
}

type LinhaItemNF = {
  nota_fiscal_id: number
  n_id_produto: number | string | null
  c_codigo_produto: string | null
  c_descricao_produto: string | null
  n_qtde_nfe: number | string | null
  n_preco_unit: number | string | null
  c_unidade_nfe: string | null
  local: string | null
  vtot: string | null
  vdesc: string | null
  ipi: string | null
  st: string | null
  icms: string | null
  csosn: string | null
  credsn: string | null
  custo: unknown
  naomov: string | null
  ignorar: string | null
}

const TIPO_LABEL = new Map(PRODUTO_TIPO_ITEM.map((t) => [t.value, t.label]))
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// Itens das notas (valor = quantidade x preco unitario; valorEstoque = regra do Omie, igual as RPCs de Compras), com
// nome, tipo e familia do cadastro. Produto e local filtram o proprio item.
export async function carregarItensCompra(lojaId: number, notas: NotaLeve[], f: Pick<FiltrosBancoNF, 'produto' | 'local'>): Promise<{ itens: ItemCompra[]; erros: string[] }> {
  const erros: string[] = []
  if (!notas.length) return { itens: [], erros }
  const supabase = await createClient()
  const diaDe = new Map(notas.map((n) => [n.id, n.dia]))
  const brutos = await buscarTodosPorIds<LinhaItemNF>(notas.map((n) => n.id), (lote, from, to) =>
    anotando(erros, 'itens das notas', supabase
      .from('nota_fiscal_items')
      .select('nota_fiscal_id, n_id_produto, c_codigo_produto, c_descricao_produto, n_qtde_nfe, n_preco_unit, c_unidade_nfe, local:full_object->itensAjustes->>codigo_local_estoque, vtot:full_object->itensCabec->>vTotalItem, vdesc:full_object->itensCabec->>vDesconto, ipi:full_object->itensIPI->>nValIPI, st:full_object->itensICMSST->>nValorST, icms:full_object->itensICMS->>nValor, csosn:full_object->itensICMSSN->>cSitTribSN, credsn:full_object->itensICMSSN->>nCredSN, custo:full_object->itensCustoEstoque, naomov:full_object->itensAjustes->>cNaoGerarMovEstoque, ignorar:full_object->itensCabec->>cIgnorarItem')
      .eq('loja_id', lojaId)
      .in('nota_fiscal_id', lote)
      .order('id', { ascending: true })
      .range(from, to)))
  const busca = semAcento(f.produto.trim())
  const filtrados = brutos.filter((i) =>
    i.naomov !== 'S' && i.ignorar !== 'S' && // o Omie não lança no estoque (mesma regra das RPCs de Compras, migration 176)
    (!busca || semAcento(`${i.c_descricao_produto ?? ''} ${i.c_codigo_produto ?? ''}`).includes(busca)) &&
    (f.local === null || i.local === String(f.local)))
  const codigos = [...new Set(filtrados.map((i) => (i.n_id_produto == null ? null : String(i.n_id_produto))).filter((c): c is string => !!c))]
  const prods = await buscarTodosPorIds<{ codigo_produto: number | string; descricao: string | null; descricao_familia: string | null; tipo_item: string | null }>(codigos, (lote, from, to) =>
    anotando(erros, 'cadastro de produtos', supabase.from('produtos').select('codigo_produto, descricao, descricao_familia, tipo_item').eq('loja_id', lojaId).in('codigo_produto', lote).order('id', { ascending: true }).range(from, to)))
  const meta = new Map(prods.map((p) => [String(p.codigo_produto), p]))
  const itens = filtrados.map((i): ItemCompra => {
    const id = i.n_id_produto == null ? null : Number(i.n_id_produto)
    const m = id == null ? undefined : meta.get(String(id))
    const tipoCod = m?.tipo_item ?? ''
    const quant = Number(i.n_qtde_nfe) || 0
    return {
      notaId: i.nota_fiscal_id,
      dia: diaDe.get(i.nota_fiscal_id) ?? '',
      idProduto: id,
      produto: formatarNomeProduto(m?.descricao || i.c_descricao_produto) || 'Sem descrição',
      tipoCod,
      tipo: TIPO_LABEL.get(tipoCod) ?? (tipoCod || 'Sem tipo'),
      familia: m?.descricao_familia?.trim() || SEM_FAMILIA,
      unidade: (i.c_unidade_nfe ?? '').trim().toUpperCase(),
      quant,
      valor: Math.round(quant * (Number(i.n_preco_unit) || 0) * 100) / 100,
      valorEstoque: custoEstoqueItemOmie({
        qtde: quant, precoUnit: Number(i.n_preco_unit) || 0,
        vTotalItem: i.vtot == null || i.vtot === '' ? null : Number(i.vtot),
        vDesconto: Number(i.vdesc) || 0, vIPI: Number(i.ipi) || 0, vST: Number(i.st) || 0, vICMS: icmsDoCusto(Number(i.icms) || 0, i.csosn, Number(i.credsn) || 0),
        flags: i.custo && typeof i.custo === 'object' ? (i.custo as FlagsCustoOmie) : null,
      }).valorEstoque,
    }
  })
  return { itens, erros: [...new Set(erros)] }
}
