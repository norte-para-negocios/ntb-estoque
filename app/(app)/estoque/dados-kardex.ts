// Kardex da loja inteira (kardex_omie), com filtros e paginação no servidor (tela /estoque/kardex e CSV).
import { createClient } from '@/lib/supabase/server'
import { escapeIlike, escapeIlikeOr } from '@/lib/utils-busca'
import { addDias } from '@/lib/estoque/espelho-lojas'
import type { FiltrosKardexLoja } from '@/lib/estoque/kardex-loja-puro'
import { emLotes } from './dados-comum'

export type LinhaKardexLoja = {
  id: number; id_mov: number; n_cod_prod: number; codigo_local_estoque: number; data_mov: string; cod_origem: string
  des_origem: string | null; quantidade: number; valor_unit: number | null; cmc_apos: number | null; saldo_apos: number | null
  num_doc: string | null; num_pedido: string | null; id_ajuste: number | null; id_cupom: number | null; cancelado: boolean
  produto: string; codigo: string; unidade: string; local: string; autor: string | null
}

const COLS = 'id, id_mov, n_cod_prod, codigo_local_estoque, data_mov, cod_origem, des_origem, quantidade, valor_unit, cmc_apos, saldo_apos, num_doc, num_pedido, id_ajuste, id_cupom, cancelado'
export const MAX_IDS_FILTRO = 300

type Resolvidos = { produtos: number[] | null; ajustes: number[] | null; truncado: string | null; vazio: boolean }

/** Busca por texto (produto) e por autor (ajustes) viram listas de ids; listas grandes são cortadas (URL curta). */
async function resolver(lojaId: number, f: FiltrosKardexLoja): Promise<Resolvidos> {
  const supabase = await createClient()
  let produtos: number[] | null = f.produto != null ? [f.produto] : null
  let truncado: string | null = null
  if (f.q) {
    const t = escapeIlikeOr(f.q)
    const { data } = await supabase.from('produtos').select('codigo_produto').eq('loja_id', lojaId)
      .or(`descricao.ilike.%${t}%,codigo.ilike.%${t}%`).order('id').limit(MAX_IDS_FILTRO + 1)
    let ids = (data ?? []).map((p) => Number(p.codigo_produto))
    if (ids.length > MAX_IDS_FILTRO) { ids = ids.slice(0, MAX_IDS_FILTRO); truncado = `A busca "${f.q}" achou muitos produtos: mostrando só os ${MAX_IDS_FILTRO} primeiros. Refine a busca.` }
    produtos = produtos ? produtos.filter((p) => ids.includes(p)) : ids
  }
  let ajustes: number[] | null = null
  if (f.autor) {
    const { data } = await supabase.from('movimentos').select('id_ajuste').eq('loja_id', lojaId)
      .ilike('autor', `%${escapeIlike(f.autor)}%`).not('id_ajuste', 'is', null)
      .gte('data', `${f.ini}T00:00:00-03:00`).lt('data', `${addDias(f.fim, 1)}T00:00:00-03:00`)
      .order('id').limit(MAX_IDS_FILTRO + 1)
    let ids = [...new Set((data ?? []).map((m) => Number(m.id_ajuste)))]
    if (ids.length > MAX_IDS_FILTRO) { ids = ids.slice(0, MAX_IDS_FILTRO); truncado = `Muitos ajustes de "${f.autor}" no período: mostrando só parte. Diminua o período.` }
    ajustes = ids
  }
  return { produtos, ajustes, truncado, vazio: (produtos != null && !produtos.length) || (ajustes != null && !ajustes.length) }
}

/** Uma página do kardex (from..to), na ordem total data_mov, id_mov, id (decrescente), com nomes e autor. */
export async function buscarKardexLoja(lojaId: number, f: FiltrosKardexLoja, faixa: { from: number; to: number }, contar = true): Promise<{ linhas: LinhaKardexLoja[]; total: number; aviso: string | null; erro: string | null }> {
  const r = await resolver(lojaId, f)
  if (r.vazio) return { linhas: [], total: 0, aviso: r.truncado, erro: null }
  const supabase = await createClient()
  let q = supabase.from('kardex_omie').select(COLS, contar ? { count: 'exact' } : undefined)
    .eq('loja_id', lojaId).gte('data_mov', f.ini).lte('data_mov', f.fim)
  if (r.produtos) q = q.in('n_cod_prod', r.produtos)
  if (r.ajustes) q = q.in('id_ajuste', r.ajustes)
  if (f.local != null) q = q.eq('codigo_local_estoque', f.local)
  if (f.origem) q = q.eq('cod_origem', f.origem)
  const { data, count, error } = await q.order('data_mov', { ascending: false }).order('id_mov', { ascending: false })
    .order('id', { ascending: false }).range(faixa.from, faixa.to)
  if (error) return { linhas: [], total: 0, aviso: r.truncado, erro: error.message }
  const rows = (data ?? []) as unknown as Omit<LinhaKardexLoja, 'produto' | 'codigo' | 'unidade' | 'local' | 'autor'>[]
  return { linhas: await enriquecer(lojaId, rows), total: count ?? rows.length, aviso: r.truncado, erro: null }
}

async function enriquecer(lojaId: number, rows: Omit<LinhaKardexLoja, 'produto' | 'codigo' | 'unidade' | 'local' | 'autor'>[]): Promise<LinhaKardexLoja[]> {
  if (!rows.length) return []
  const supabase = await createClient()
  const prodIds = [...new Set(rows.map((r) => Number(r.n_cod_prod)))]
  const ajIds = [...new Set(rows.map((r) => r.id_ajuste).filter((x): x is number => x != null).map(Number))]
  const [prods, ajustes, { data: locais }] = await Promise.all([
    emLotes(prodIds, 150, async (lote) => {
      const { data } = await supabase.from('produtos').select('codigo_produto, codigo, descricao, unidade').eq('loja_id', lojaId).in('codigo_produto', lote)
      return (data ?? []) as { codigo_produto: number; codigo: string | null; descricao: string | null; unidade: string | null }[]
    }),
    emLotes(ajIds, 150, async (lote) => {
      const { data } = await supabase.from('movimentos').select('id_ajuste, autor').eq('loja_id', lojaId).in('id_ajuste', lote)
      return (data ?? []) as { id_ajuste: number; autor: string | null }[]
    }),
    supabase.from('local_estoques').select('codigo_local_estoque, descricao').eq('loja_id', lojaId),
  ])
  const prod = new Map(prods.map((p) => [Number(p.codigo_produto), p]))
  const autor = new Map(ajustes.map((a) => [Number(a.id_ajuste), a.autor]))
  const local = new Map((locais ?? []).map((l) => [Number(l.codigo_local_estoque), l.descricao as string]))
  return rows.map((r) => {
    const p = prod.get(Number(r.n_cod_prod))
    return {
      ...r, id: Number(r.id), id_mov: Number(r.id_mov), n_cod_prod: Number(r.n_cod_prod), codigo_local_estoque: Number(r.codigo_local_estoque),
      quantidade: Number(r.quantidade), valor_unit: r.valor_unit == null ? null : Number(r.valor_unit), cmc_apos: r.cmc_apos == null ? null : Number(r.cmc_apos),
      saldo_apos: r.saldo_apos == null ? null : Number(r.saldo_apos),
      produto: p?.descricao ?? `Produto ${r.n_cod_prod}`, codigo: p?.codigo ?? String(r.n_cod_prod), unidade: p?.unidade ?? '',
      local: local.get(Number(r.codigo_local_estoque)) ?? String(r.codigo_local_estoque),
      autor: r.id_ajuste != null ? (autor.get(Number(r.id_ajuste)) ?? null) : null,
    }
  })
}

/** Origens que aparecem no kardex da loja nos últimos 90 dias (opções do filtro). */
export async function origensKardex(lojaId: number, hoje: string): Promise<{ value: string; label: string }[]> {
  const supabase = await createClient()
  // Amostra das entradas e das saídas recentes (as vendas sozinhas encheriam uma amostra única).
  const base = () => supabase.from('kardex_omie').select('cod_origem, des_origem').eq('loja_id', lojaId).gte('data_mov', addDias(hoje, -90))
  const [ent, sai] = await Promise.all([
    base().gt('quantidade', 0).order('id', { ascending: false }).limit(1000),
    base().lt('quantidade', 0).order('id', { ascending: false }).limit(1000),
  ])
  const m = new Map<string, string>()
  for (const r of [...(ent.data ?? []), ...(sai.data ?? [])]) if (r.cod_origem && !m.has(r.cod_origem)) m.set(r.cod_origem, r.des_origem || r.cod_origem)
  return [...m.entries()].map(([value, label]) => ({ value, label: label === value ? value : `${label} (${value})` })).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
}
