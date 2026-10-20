// Movimentações completas (13/10/2026): um loader para a aba Movimentos da loja Omie, a página da OP e a da nota.
// Loja com espelho completo = kardex do próprio Omie (kardex_omie); as demais = RPC movimentacoes_loja (migration 170),
// que reconstrói a lista a partir de ajustes/PDV/contagens, OPs concluídas (ficha gravada) e notas concluídas.
import { createClient } from '@/lib/supabase/server'
import { buscarTudoPaginado, escapeIlikeOr } from '@/lib/utils-busca'
import { buscarKardexLoja, origensKardex, type LinhaKardexLoja } from '@/app/(app)/estoque/dados-kardex'
import { emLotes, historicoKardexDesde, lojaEspelho } from '@/app/(app)/estoque/dados-comum'
import { paginaKardex } from '@/lib/estoque/kardex-loja-puro'
import {
  OPCOES_ORIGEM_MOV, ROTULO_ORIGEM_MOV, casarKardexComOP, escolherFonte, faltaHojeNoKardex, lerFiltrosMovimentacoes, movimentosPrevistosDaOP, numerosCandidatos,
  origemDoKardex, type DocMov, type FiltrosMov, type ItemFichaOP, type OPMin, type OrigemMov,
} from './movimentacoes-puro'

export const MAX_PRODUTOS_BUSCA = 300

export type LinhaMov = {
  chave: string; data: string; n_cod_prod: number; produto: string; codigo: string; unidade: string; local: string
  localDestino: string | null; quantidade: number; contagem: boolean; origem: OrigemMov; origemRotulo: string; doc: DocMov | null
  autor: string | null; obs: string | null; saldoApos: number | null; cmcApos: number | null; valorUnit: number | null
  cancelado: boolean; provavel?: boolean
}

export type ResultadoMov = {
  fonte: 'kardex' | 'reconstruido'; linhas: LinhaMov[]; total: number; entradas: number | null; saidas: number | null
  /** Total oficial do Omie (movimentos_historico) quando há poucos produtos no filtro, para comparar com a reconstrução. */
  totalOmie: { entradas: number; saidas: number } | null
  avisos: string[]; erro: string | null; historicoDesde: string | null
}

type Prod = { codigo_produto: number; codigo: string | null; descricao: string | null; unidade: string | null }

async function nomesProdutos(lojaId: number, ids: number[]): Promise<Map<number, Prod>> {
  const supabase = await createClient()
  const uniq = [...new Set(ids.filter((x) => Number.isFinite(x)))]
  const rows = await emLotes(uniq, 150, async (lote) => {
    const { data } = await supabase.from('produtos').select('codigo_produto, codigo, descricao, unidade').eq('loja_id', lojaId).in('codigo_produto', lote)
    return (data ?? []) as Prod[]
  })
  return new Map(rows.map((p) => [Number(p.codigo_produto), p]))
}

async function nomesLocais(lojaId: number): Promise<Map<number, string>> {
  const supabase = await createClient()
  const { data } = await supabase.from('local_estoques').select('codigo_local_estoque, descricao').eq('loja_id', lojaId)
  return new Map((data ?? []).map((l) => [Number(l.codigo_local_estoque), (l.descricao as string) ?? String(l.codigo_local_estoque)]))
}

/** Texto de produto → até 300 códigos (busca no cadastro, ordem estável); avisa se cortou. */
async function produtosDaBusca(lojaId: number, f: FiltrosMov): Promise<{ ids: number[] | null; aviso: string | null }> {
  let ids: number[] | null = f.produto != null ? [f.produto] : null
  let aviso: string | null = null
  if (f.q) {
    const supabase = await createClient()
    const t = escapeIlikeOr(f.q)
    const { data, error } = await supabase.from('produtos').select('codigo_produto').eq('loja_id', lojaId)
      .or(`descricao.ilike.%${t}%,codigo.ilike.%${t}%`).order('id').limit(MAX_PRODUTOS_BUSCA + 1)
    if (error) return { ids: [], aviso: `Não foi possível buscar o produto "${f.q}": ${error.message}` }
    let achados = (data ?? []).map((p) => Number(p.codigo_produto))
    if (achados.length > MAX_PRODUTOS_BUSCA) {
      achados = achados.slice(0, MAX_PRODUTOS_BUSCA)
      aviso = `A busca "${f.q}" achou muitos produtos: mostrando só os ${MAX_PRODUTOS_BUSCA} primeiros. Refine a busca.`
    }
    ids = ids ? ids.filter((p) => achados.includes(p)) : achados
  }
  const fam = await produtosDaFamilia(lojaId, f.familia)
  if (fam.aviso) return { ids: [], aviso: fam.aviso }
  if (fam.ids) { const s = new Set(fam.ids); ids = ids ? ids.filter((p) => s.has(p)) : fam.ids }
  return { ids, aviso }
}

/** Produtos de uma família (todos, paginado com ordem total). null = sem filtro de família. */
async function produtosDaFamilia(lojaId: number, familia: string): Promise<{ ids: number[] | null; aviso: string | null }> {
  if (!familia) return { ids: null, aviso: null }
  const supabase = await createClient()
  let erro: string | null = null
  const rows = await buscarTudoPaginado<{ codigo_produto: number }>(async (from, to) => {
    const r = await supabase.from('produtos').select('codigo_produto').eq('loja_id', lojaId).eq('descricao_familia', familia).order('id').range(from, to)
    if (r.error) erro = r.error.message
    return r
  })
  if (erro) return { ids: null, aviso: `Não foi possível ler a família "${familia}": ${erro}` }
  return { ids: rows.map((p) => Number(p.codigo_produto)), aviso: null }
}

/** Total oficial do Omie no período (movimentos_historico) para até 20 produtos. */
async function totalOficialOmie(lojaId: number, ids: number[], ini: string, fim: string): Promise<{ entradas: number; saidas: number } | null> {
  if (!ids.length || ids.length > 20) return null
  const supabase = await createClient()
  let entradas = 0
  let saidas = 0
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('movimentos_historico').select('cod_prod, data, entradas, saidas').eq('loja_id', lojaId)
      .in('cod_prod', ids).gte('data', ini).lte('data', fim).order('cod_prod').order('data').range(from, from + 999)
    if (error) return null
    for (const r of data ?? []) { entradas += Number(r.entradas) || 0; saidas += Number(r.saidas) || 0 }
    if ((data?.length ?? 0) < 1000) break
  }
  return { entradas, saidas }
}

type LinhaRPC = {
  chave: string; data: string; momento: string | null; n_cod_prod: number; codigo_local_estoque: number | null; local_destino: number | null
  quantidade: number; contagem: boolean; origem: OrigemMov; doc_tipo: DocMov['tipo'] | null; doc_id: number | null; doc_rotulo: string | null
  autor: string | null; obs: string | null; total: number; entradas: number; saidas: number
}

async function reconstruir(lojaId: number, f: FiltrosMov, porPagina: number, avisosAntes: string[] = []): Promise<ResultadoMov> {
  const avisos: string[] = [...avisosAntes]
  const busca = await produtosDaBusca(lojaId, f)
  if (busca.aviso) avisos.push(busca.aviso)
  const vazio: ResultadoMov = { fonte: 'reconstruido', linhas: [], total: 0, entradas: 0, saidas: 0, totalOmie: null, avisos, erro: null, historicoDesde: null }
  if (busca.ids && !busca.ids.length) return vazio
  const supabase = await createClient()
  const { from } = paginaKardex(f.page, porPagina)
  const [{ data, error }, totalOmie] = await Promise.all([
    supabase.rpc('movimentacoes_loja', {
      p_loja_id: lojaId, p_ini: f.ini, p_fim: f.fim, p_produtos: busca.ids, p_local: f.local, p_origem: f.origem || null,
      p_doc: f.doc || null, p_autor: f.autor || null, p_limit: porPagina, p_offset: from,
    }),
    busca.ids ? totalOficialOmie(lojaId, busca.ids, f.ini, f.fim) : Promise.resolve(null),
  ])
  if (error) return { ...vazio, erro: error.message }
  const rows = (data ?? []) as LinhaRPC[]
  const [prods, locais] = await Promise.all([nomesProdutos(lojaId, rows.map((r) => Number(r.n_cod_prod))), nomesLocais(lojaId)])
  const linhas: LinhaMov[] = rows.map((r) => {
    const p = prods.get(Number(r.n_cod_prod))
    const codigo = p?.codigo ?? String(r.n_cod_prod)
    const doc: DocMov | null = r.doc_tipo
      ? { tipo: r.doc_tipo, id: r.doc_id != null ? Number(r.doc_id) : null, rotulo: r.doc_rotulo ?? '', dia: r.data, produto: codigo }
      : null
    return {
      chave: r.chave, data: r.data, n_cod_prod: Number(r.n_cod_prod), produto: p?.descricao ?? `Produto ${r.n_cod_prod}`, codigo,
      unidade: p?.unidade ?? '', local: r.codigo_local_estoque != null ? (locais.get(Number(r.codigo_local_estoque)) ?? String(r.codigo_local_estoque)) : '-',
      localDestino: r.local_destino != null ? (locais.get(Number(r.local_destino)) ?? String(r.local_destino)) : null,
      quantidade: Number(r.quantidade), contagem: !!r.contagem, origem: r.origem,
      // Consumo reconstruído = ficha gravada na OP (estimativa; o kardex do Omie é o número oficial).
      origemRotulo: r.origem === 'op_consumo' ? 'Consumo em OP (pela ficha)' : (ROTULO_ORIGEM_MOV[r.origem] ?? r.origem),
      doc, autor: r.autor, obs: r.doc_tipo == null ? (r.doc_rotulo ?? r.obs) : r.obs, saldoApos: null, cmcApos: null, valorUnit: null, cancelado: false,
    }
  })
  const primeira = rows[0]
  return {
    fonte: 'reconstruido', linhas, total: primeira ? Number(primeira.total) : 0,
    entradas: primeira ? Number(primeira.entradas) : 0, saidas: primeira ? Number(primeira.saidas) : 0, totalOmie, avisos, erro: null, historicoDesde: null,
  }
}

const aspas = (v: string) => `"${v.replace(/["\\]/g, '')}"`

/** Documento de origem de cada linha do kardex (OP, nota, cupom, transferência, inventário ou ajuste), em poucas consultas. */
export async function resolverDocumentosKardex(lojaId: number, linhas: LinhaKardexLoja[]): Promise<Map<number, DocMov>> {
  const supabase = await createClient()
  const r = new Map<number, DocMov>()
  const origem = new Map(linhas.map((l) => [l.id, origemDoKardex(l)]))
  const docDe = (l: LinhaKardexLoja) => l.num_pedido ?? l.num_doc ?? null

  // OP: número da OP (como veio) ou código do Omie (só dígitos)
  const ops = linhas.filter((l) => { const o = origem.get(l.id); return (o === 'op_producao' || o === 'op_consumo') && docDe(l) })
  const brutosOP = [...new Set(ops.flatMap((l) => [l.num_doc, l.num_pedido]).filter((x): x is string => !!x))]
  const mapaOP = new Map<string, number>()
  await emLotes(brutosOP, 80, async (lote) => {
    const nums = lote.filter((x) => /^\d+$/.test(x))
    const ors = [`identificacao_c_num_op.in.(${lote.map(aspas).join(',')})`]
    if (nums.length) ors.push(`identificacao_n_cod_op.in.(${nums.join(',')})`)
    const { data } = await supabase.from('ordens_producao').select('id, identificacao_c_num_op, identificacao_n_cod_op, identificacao_c_cod_int_op')
      .eq('loja_id', lojaId).or(ors.join(',')).limit(1000)
    for (const o of data ?? []) for (const c of numerosCandidatos(o.identificacao_c_num_op, o.identificacao_n_cod_op)) if (!mapaOP.has(c)) mapaOP.set(c, Number(o.id))
    return []
  })
  for (const l of ops) {
    const id = numerosCandidatos(l.num_doc, l.num_pedido).map((c) => mapaOP.get(c)).find((x) => x != null) ?? null
    r.set(l.id, { tipo: 'op', id, rotulo: `OP ${docDe(l)}` })
  }

  // Nota fiscal: número da nota (com ou sem zeros) e que tenha item do produto da linha
  const nfs = linhas.filter((l) => origem.get(l.id) === 'nf' && docDe(l))
  const numsNF = [...new Set(nfs.flatMap((l) => numerosCandidatos(l.num_doc, l.num_pedido)))]
  const notas = await emLotes(numsNF, 80, async (lote) => {
    const { data } = await supabase.from('notas_fiscais').select('id, c_numero_nfe').eq('loja_id', lojaId).is('deleted_at', null)
      .in('c_numero_nfe', lote.flatMap((n) => [n, n.padStart(9, '0')])).limit(1000)
    return (data ?? []) as { id: number; c_numero_nfe: string | null }[]
  })
  const itensNF = await emLotes(notas.map((n) => Number(n.id)), 100, async (lote) => {
    const { data } = await supabase.from('nota_fiscal_items').select('nota_fiscal_id, n_id_produto').eq('loja_id', lojaId).in('nota_fiscal_id', lote).limit(5000)
    return (data ?? []) as { nota_fiscal_id: number; n_id_produto: number | null }[]
  })
  const prodsDaNota = new Map<number, Set<number>>()
  for (const i of itensNF) {
    const s = prodsDaNota.get(Number(i.nota_fiscal_id)) ?? new Set<number>()
    if (i.n_id_produto != null) s.add(Number(i.n_id_produto))
    prodsDaNota.set(Number(i.nota_fiscal_id), s)
  }
  for (const l of nfs) {
    const cands = new Set(numerosCandidatos(l.num_doc, l.num_pedido))
    const mesmas = notas.filter((n) => numerosCandidatos(n.c_numero_nfe).some((c) => cands.has(c)))
    const nota = mesmas.find((n) => prodsDaNota.get(Number(n.id))?.has(l.n_cod_prod)) ?? (mesmas.length === 1 ? mesmas[0] : null)
    r.set(l.id, { tipo: 'nf', id: nota ? Number(nota.id) : null, rotulo: `NF ${docDe(l)}` })
  }

  // Cupom do PDV
  for (const l of linhas) {
    if (l.id_cupom != null && !r.has(l.id)) r.set(l.id, { tipo: 'cupom', id: Number(l.id_cupom), rotulo: `Cupom ${l.num_doc ?? l.id_cupom}` })
  }

  // Ajuste: transferência do app, inventário do app ou o ajuste em si
  const ajustes = [...new Set(linhas.filter((l) => l.id_ajuste != null && !r.has(l.id)).map((l) => Number(l.id_ajuste)))]
  const [movs, invs] = await Promise.all([
    emLotes(ajustes, 150, async (lote) => {
      const { data } = await supabase.from('movimentos').select('id_ajuste, transferencia_id').eq('loja_id', lojaId).in('id_ajuste', lote)
      return (data ?? []) as { id_ajuste: number; transferencia_id: number | null }[]
    }),
    emLotes(ajustes, 150, async (lote) => {
      const { data } = await supabase.from('inventario_items').select('id_ajuste, inventario_id').eq('loja_id', lojaId).in('id_ajuste', lote)
      return (data ?? []) as { id_ajuste: number; inventario_id: number }[]
    }),
  ])
  const trf = new Map(movs.filter((m) => m.transferencia_id != null).map((m) => [Number(m.id_ajuste), Number(m.transferencia_id)]))
  const inv = new Map(invs.map((i) => [Number(i.id_ajuste), Number(i.inventario_id)]))
  for (const l of linhas) {
    if (l.id_ajuste == null || r.has(l.id)) continue
    const a = Number(l.id_ajuste)
    if (trf.has(a)) r.set(l.id, { tipo: 'transferencia', id: trf.get(a)!, rotulo: `Transferência ${trf.get(a)}` })
    else if (inv.has(a)) r.set(l.id, { tipo: 'inventario', id: inv.get(a)!, rotulo: `Inventário ${inv.get(a)}` })
    else r.set(l.id, { tipo: 'ajuste', id: a, rotulo: `Ajuste ${a}`, dia: l.data_mov, produto: l.codigo })
  }
  return r
}

function linhaDoKardex(l: LinhaKardexLoja, doc: DocMov | null): LinhaMov {
  const origem = origemDoKardex(l)
  return {
    chave: `k${l.id}`, data: l.data_mov, n_cod_prod: l.n_cod_prod, produto: l.produto, codigo: l.codigo, unidade: l.unidade, local: l.local,
    localDestino: null, quantidade: l.quantidade, contagem: false, origem,
    origemRotulo: (l.des_origem && l.des_origem.trim()) || ROTULO_ORIGEM_MOV[origem], doc, autor: l.autor, obs: null,
    saldoApos: l.saldo_apos, cmcApos: l.cmc_apos, valorUnit: l.valor_unit, cancelado: l.cancelado,
  }
}

async function doKardex(lojaId: number, f: FiltrosMov, porPagina: number, desde: string | null): Promise<ResultadoMov> {
  const avisos: string[] = []
  const fam = await produtosDaFamilia(lojaId, f.familia)
  if (fam.aviso) return { fonte: 'kardex', linhas: [], total: 0, entradas: null, saidas: null, totalOmie: null, avisos: [fam.aviso], erro: null, historicoDesde: desde }
  const res = await buscarKardexLoja(lojaId, { ...f, somenteProdutos: fam.ids }, paginaKardex(f.page, porPagina))
  if (res.aviso) avisos.push(res.aviso)
  const cobertura = { desde }
  const docs = await resolverDocumentosKardex(lojaId, res.linhas)
  const linhas = res.linhas.map((l) => linhaDoKardex(l, docs.get(l.id) ?? null))
  return { fonte: 'kardex', linhas, total: res.total, entradas: null, saidas: null, totalOmie: null, avisos, erro: res.erro, historicoDesde: cobertura.desde }
}

/** Aba Movimentos da loja Omie: filtros da URL → uma página de movimentos, com total e documento de origem. */
export async function carregarMovimentacoes(lojaId: number, sp: Record<string, string | undefined>, hoje: string, porPagina: number): Promise<{ filtros: FiltrosMov; res: ResultadoMov; origens: { value: string; label: string }[] }> {
  const [{ espelhoCompleto }, cobertura] = await Promise.all([lojaEspelho(lojaId), historicoKardexDesde(lojaId)])
  const comoKardex = lerFiltrosMovimentacoes(sp, hoje, !espelhoCompleto)
  // Loja com espelho, mas o kardex ainda não cobre o período (backfill de dias depois de ligar a flag): a lista
  // reconstruída é completa; o kardex nesse período mostraria só os produtos já abertos na tela do produto.
  if (escolherFonte({ espelho: espelhoCompleto, desde: cobertura.desde, ini: comoKardex.ini, ate: cobertura.ate, fim: comoKardex.fim, hoje }) === 'kardex') {
    const [res, origens] = await Promise.all([doKardex(lojaId, comoKardex, porPagina, cobertura.desde), origensKardex(lojaId, hoje)])
    if (faltaHojeNoKardex({ ate: cobertura.ate, fim: comoKardex.fim, hoje })) {
      res.avisos.push('Os movimentos de hoje ainda não foram lidos do Omie (a leitura do dia começa às 07:00): a lista abaixo vai até ontem.')
    }
    return { filtros: comoKardex, res, origens }
  }
  const filtros = espelhoCompleto ? lerFiltrosMovimentacoes(sp, hoje, true) : comoKardex
  const avisos = espelhoCompleto
    ? [cobertura.desde && cobertura.desde <= comoKardex.ini
        ? `O kardex do Omie desta loja está lido até ${(cobertura.ate ?? '').split('-').reverse().join('/') || 'uma data anterior'}: para um período que passa disso, a lista abaixo é montada a partir de ajustes, vendas, OPs e notas.`
        : cobertura.desde
        ? `O kardex completo do Omie começa em ${cobertura.desde.split('-').reverse().join('/')}: para um período que começa antes disso, a lista abaixo é montada a partir de ajustes, vendas, OPs e notas.`
        : 'O kardex da loja inteira ainda está sendo lido do Omie: enquanto isso, a lista abaixo é montada a partir de ajustes, vendas, OPs e notas.']
    : []
  return { filtros, res: await reconstruir(lojaId, filtros, porPagina, avisos), origens: OPCOES_ORIGEM_MOV }
}

/** Movimentos que uma OP gerou: kardex do Omie (loja com espelho) ou, sem ele, o previsto pela ficha gravada na OP. */
export async function movimentosDaOP(lojaId: number, op: OPMin, itens: ItemFichaOP[]): Promise<{ fonte: 'kardex' | 'ficha'; linhas: LinhaMov[]; criterio: 'documento' | 'data' | 'nenhum' | 'ficha'; aviso: string | null }> {
  const previstos = movimentosPrevistosDaOP(op, itens)
  const produtos = [...new Set([op.identificacao_n_cod_produto, ...itens.map((i) => i.nIdProdutoMalha)].filter((x): x is number => x != null).map(Number))]
  const [{ espelhoCompleto }, cobertura, locais, prods] = await Promise.all([lojaEspelho(lojaId), historicoKardexDesde(lojaId), nomesLocais(lojaId), nomesProdutos(lojaId, produtos)])
  const diaOP = op.dt_conclusao_real?.slice(0, 10) ?? null
  if (espelhoCompleto && op.concluida && diaOP && cobertura.desde && cobertura.desde <= diaOP) {
    const supabase = await createClient()
    const dia = diaOP
    const somar = (n: number) => { const d = new Date(`${dia}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
    const COLS_K = 'id, id_mov, n_cod_prod, codigo_local_estoque, data_mov, cod_origem, des_origem, quantidade, valor_unit, cmc_apos, saldo_apos, num_doc, num_pedido, id_ajuste, id_cupom, cancelado'
    type LinhaK = Omit<LinhaKardexLoja, 'produto' | 'codigo' | 'unidade' | 'local' | 'autor'>
    // 1º pelo número da OP (filtro no banco: poucas linhas); senão, para cada movimento esperado, só as linhas do
    // mesmo produto com a mesma quantidade (a loja faz centenas de OPs por dia: ler tudo cortaria em 1000 linhas).
    const chaves = numerosCandidatos(op.identificacao_c_num_op, op.identificacao_n_cod_op, op.identificacao_c_cod_int_op).map(aspas).join(',')
    const { data: porDoc } = chaves
      ? await supabase.from('kardex_omie').select(COLS_K).eq('loja_id', lojaId).in('n_cod_prod', produtos)
          .gte('data_mov', somar(-1)).lte('data_mov', somar(1)).or(`num_doc.in.(${chaves}),num_pedido.in.(${chaves})`).order('id').limit(1000)
      : { data: [] }
    let linhasK = (porDoc ?? []) as unknown as LinhaK[]
    if (!linhasK.length) {
      const porEsperado = await Promise.all(previstos.map(async (e) => {
        const tol = Math.max(1e-6, Math.abs(e.quantidade) * 1e-4)
        const { data } = await supabase.from('kardex_omie').select(COLS_K).eq('loja_id', lojaId).eq('n_cod_prod', e.n_cod_prod)
          .gte('data_mov', somar(-1)).lte('data_mov', somar(1)).gte('quantidade', e.quantidade - tol).lte('quantidade', e.quantidade + tol)
          .order('data_mov').order('id').limit(200)
        return (data ?? []) as unknown as LinhaK[]
      }))
      const vistos = new Set<number>()
      linhasK = porEsperado.flat().filter((k) => (vistos.has(Number(k.id)) ? false : (vistos.add(Number(k.id)), true)))
    }
    const casado = casarKardexComOP(linhasK.map((k) => ({ ...k, n_cod_prod: Number(k.n_cod_prod), quantidade: Number(k.quantidade) })), op, previstos)
    if (casado.linhas.length) {
      const linhas = casado.linhas.map((k) => {
        const p = prods.get(Number(k.n_cod_prod))
        const base: LinhaKardexLoja = {
          ...k, id: Number(k.id), id_mov: Number(k.id_mov), codigo_local_estoque: Number(k.codigo_local_estoque),
          valor_unit: k.valor_unit == null ? null : Number(k.valor_unit), cmc_apos: k.cmc_apos == null ? null : Number(k.cmc_apos),
          saldo_apos: k.saldo_apos == null ? null : Number(k.saldo_apos), produto: p?.descricao ?? `Produto ${k.n_cod_prod}`, codigo: p?.codigo ?? String(k.n_cod_prod),
          unidade: p?.unidade ?? '', local: locais.get(Number(k.codigo_local_estoque)) ?? String(k.codigo_local_estoque), autor: null,
        }
        return { ...linhaDoKardex(base, { tipo: 'op', id: op.id, rotulo: `OP ${op.identificacao_c_num_op ?? op.id}` }), provavel: k.provavel }
      })
      return {
        fonte: 'kardex', linhas, criterio: casado.criterio,
        aviso: casado.criterio === 'data'
          ? `O kardex do Omie não trouxe o número da OP: para cada item da ficha, o movimento de OP do mesmo produto, com a mesma quantidade, no dia da conclusão (provável).${casado.empates ? ` Em ${casado.empates} item(ns) havia mais de uma OP igual no mesmo dia: confira no kardex.` : ''}${casado.linhas.length < previstos.length ? ` ${previstos.length - casado.linhas.length} movimento(s) da ficha não foram achados no kardex.` : ''}`
          : null,
      }
    }
  }
  const linhas: LinhaMov[] = previstos.map((m, i) => {
    const p = prods.get(m.n_cod_prod)
    return {
      chave: `prev${i}`, data: op.dt_conclusao_real ?? '', n_cod_prod: m.n_cod_prod, produto: p?.descricao ?? `Produto ${m.n_cod_prod}`, codigo: p?.codigo ?? String(m.n_cod_prod),
      unidade: p?.unidade ?? '', local: m.local != null ? (locais.get(m.local) ?? String(m.local)) : '-', localDestino: null, quantidade: m.quantidade,
      contagem: false, origem: m.origem, origemRotulo: ROTULO_ORIGEM_MOV[m.origem], doc: null, autor: null, obs: null,
      saldoApos: null, cmcApos: null, valorUnit: null, cancelado: false,
    }
  })
  return {
    fonte: 'ficha', linhas, criterio: 'ficha',
    aviso: !op.concluida ? 'OP ainda não concluída: o estoque ainda não foi movimentado. Abaixo, o que ela vai movimentar pela ficha.'
      : !itens.length ? 'Esta OP não tem a ficha gravada (itens): só a entrada do produto aparece.'
      : espelhoCompleto ? 'O kardex do Omie não tem movimentos desta OP na data da conclusão: abaixo, o que ela movimentou pela ficha gravada.'
      : 'Movimentos pela ficha gravada na OP (o kardex completo do Omie chega quando o espelho completo for ligado nesta loja).',
  }
}

/** Movimentos que uma nota gerou: kardex do Omie (origem nota, mesmo número, produtos da nota) ou a entrada pela própria nota. */
export async function movimentosDaNota(lojaId: number, nota: { numero: string | null; emissao: string | null }, itens: { n_id_produto: number; codigo_local_estoque: number | null; quantidade: number }[]): Promise<{ fonte: 'kardex' | 'nota'; linhas: LinhaMov[] }> {
  const produtos = [...new Set(itens.map((i) => Number(i.n_id_produto)))]
  const [{ espelhoCompleto }, locais, prods] = await Promise.all([lojaEspelho(lojaId), nomesLocais(lojaId), nomesProdutos(lojaId, produtos)])
  if (espelhoCompleto && nota.numero && nota.emissao && produtos.length) {
    const supabase = await createClient()
    const d = new Date(`${nota.emissao.slice(0, 10)}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + 30)
    const candsLista = numerosCandidatos(nota.numero)
    const cands = new Set(candsLista)
    // Número da nota filtrado no banco (antes do limite): o insumo comprado tem milhares de linhas de PDV/OP no mês.
    const emLista = candsLista.flatMap((n) => [n, n.padStart(9, '0')]).map(aspas).join(',')
    const linhasK = await emLotes(produtos, 150, async (lote) => {
      const { data } = await supabase.from('kardex_omie')
        .select('id, id_mov, n_cod_prod, codigo_local_estoque, data_mov, cod_origem, des_origem, quantidade, valor_unit, cmc_apos, saldo_apos, num_doc, num_pedido, id_ajuste, id_cupom, cancelado')
        .eq('loja_id', lojaId).in('n_cod_prod', lote).gte('data_mov', nota.emissao!.slice(0, 10)).lte('data_mov', d.toISOString().slice(0, 10))
        .or(`num_doc.in.(${emLista}),num_pedido.in.(${emLista})`).order('id').limit(1000)
      return (data ?? []) as unknown as Omit<LinhaKardexLoja, 'produto' | 'codigo' | 'unidade' | 'local' | 'autor'>[]
    })
    const daNota = linhasK.filter((k) => origemDoKardex({ ...k, quantidade: Number(k.quantidade) }) === 'nf' && numerosCandidatos(k.num_doc, k.num_pedido).some((c) => cands.has(c)))
    if (daNota.length) {
      return {
        fonte: 'kardex',
        linhas: daNota.map((k) => {
          const p = prods.get(Number(k.n_cod_prod))
          return linhaDoKardex({
            ...k, id: Number(k.id), id_mov: Number(k.id_mov), n_cod_prod: Number(k.n_cod_prod), codigo_local_estoque: Number(k.codigo_local_estoque),
            quantidade: Number(k.quantidade), valor_unit: k.valor_unit == null ? null : Number(k.valor_unit), cmc_apos: k.cmc_apos == null ? null : Number(k.cmc_apos),
            saldo_apos: k.saldo_apos == null ? null : Number(k.saldo_apos), produto: p?.descricao ?? `Produto ${k.n_cod_prod}`, codigo: p?.codigo ?? String(k.n_cod_prod),
            unidade: p?.unidade ?? '', local: locais.get(Number(k.codigo_local_estoque)) ?? String(k.codigo_local_estoque), autor: null,
          }, null)
        }),
      }
    }
  }
  return {
    fonte: 'nota',
    linhas: itens.map((i, n) => {
      const p = prods.get(Number(i.n_id_produto))
      return {
        chave: `nfi${n}`, data: nota.emissao?.slice(0, 10) ?? '', n_cod_prod: Number(i.n_id_produto), produto: p?.descricao ?? `Produto ${i.n_id_produto}`,
        codigo: p?.codigo ?? String(i.n_id_produto), unidade: p?.unidade ?? '', local: i.codigo_local_estoque != null ? (locais.get(i.codigo_local_estoque) ?? String(i.codigo_local_estoque)) : '-',
        localDestino: null, quantidade: Math.abs(i.quantidade), contagem: false, origem: 'nf', origemRotulo: ROTULO_ORIGEM_MOV.nf, doc: null, autor: null, obs: null,
        saldoApos: null, cmcApos: null, valorUnit: null, cancelado: false,
      }
    }),
  }
}

