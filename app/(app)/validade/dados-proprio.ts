// Dados da tela Validade no estoque próprio: lotes com saldo (estoque_lotes, migration 145) + cadastro.
import { createServiceClient } from '@/lib/supabase/server'
import { escapeIlikeOr } from '@/lib/utils-busca'
import { alertaDiasDaLoja } from '@/lib/estoque/lotes'
import { lerFiltroValidade, passaFiltro, somarDias, type FiltroValidade } from '@/lib/estoque/validade-regras'

export type ParamsValidade = { modo?: string; dias?: string; tipo?: string; familia?: string; produto?: string; local?: string; grupo?: string; ord?: string; dir?: string }

export type LinhaLote = {
  id: number
  codigoProduto: number
  produto: string
  codigo: string | null
  unidade: string | null
  familia: string | null
  grupo: string | null
  codigoLocal: number
  local: string
  lote: string | null
  validade: string | null
  saldo: number
  cmc: number
  valor: number
  origem: string | null
}

export type DadosValidade = {
  linhas: LinhaLote[]
  filtro: FiltroValidade
  alertaDias: number
  contagens: { vencidos: number; hoje: number; ate: Record<number, number>; semValidade: number }
  totais: { lotes: number; quantidade: number; valor: number }
  locais: { codigo: number; descricao: string }[]
  grupos: { id: number; nome: string }[]
  divergencias: number
  limitado: boolean
}

const LIMITE = 2000
export const PERIODOS_PROPRIO = [0, 7, 15, 30, 60] as const

/** Ids do grupo e de todos os descendentes (a árvore é pequena; resolvida em memória). */
function grupoEDescendentes(grupos: { id: number; pai_id: number | null }[], raiz: number): Set<number> {
  const out = new Set<number>([raiz])
  let mudou = true
  while (mudou) {
    mudou = false
    for (const g of grupos) if (g.pai_id != null && out.has(Number(g.pai_id)) && !out.has(Number(g.id))) { out.add(Number(g.id)); mudou = true }
  }
  return out
}

export async function carregarValidadeProprio(lojaId: number, sp: ParamsValidade, hoje: string): Promise<DadosValidade> {
  const sb = createServiceClient()
  const alertaDias = await alertaDiasDaLoja(lojaId)
  const filtro = lerFiltroValidade(sp, alertaDias)

  const [{ data: locaisRaw }, { data: gruposRaw }, { count: divergencias }] = await Promise.all([
    sb.from('local_estoques').select('codigo_local_estoque, descricao').eq('loja_id', lojaId).order('descricao'),
    sb.from('grupos_produto').select('id, nome, pai_id').eq('loja_id', lojaId).eq('ativo', true).order('nome'),
    sb.from('estoque_lotes_divergencia').select('codigo_produto', { count: 'exact', head: true }).eq('loja_id', lojaId),
  ])
  const locais = (locaisRaw ?? []).map((l) => ({ codigo: Number(l.codigo_local_estoque), descricao: String(l.descricao ?? l.codigo_local_estoque) }))
  const nomeLocal = new Map(locais.map((l) => [l.codigo, l.descricao]))
  const grupos = ((gruposRaw ?? []) as { id: number; nome: string; pai_id: number | null }[])
  const nomeGrupo = new Map(grupos.map((g) => [Number(g.id), g.nome]))

  // Filtro de cadastro (produto, tipo, família, grupo) resolvido em códigos de produto.
  let codigosFiltro: Set<number> | null = null
  if (sp.produto || sp.tipo || sp.familia || sp.grupo) {
    let q = sb.from('produtos').select('codigo_produto, grupo_id').eq('loja_id', lojaId)
    if (sp.tipo) q = q.eq('tipo_item', sp.tipo)
    if (sp.familia) q = q.eq('descricao_familia', sp.familia)
    if (sp.produto) {
      const e = escapeIlikeOr(sp.produto)
      q = q.or(`descricao.ilike.%${e}%,codigo.ilike.%${e}%`)
    }
    const { data } = await q.limit(5000)
    let lista = (data ?? []) as { codigo_produto: number; grupo_id: number | null }[]
    if (sp.grupo && Number(sp.grupo)) {
      const ids = grupoEDescendentes(grupos, Number(sp.grupo))
      lista = lista.filter((p) => p.grupo_id != null && ids.has(Number(p.grupo_id)))
    }
    codigosFiltro = new Set(lista.map((p) => Number(p.codigo_produto)))
  }
  const localCod = sp.local && Number(sp.local) ? Number(sp.local) : null

  // Todos os lotes com saldo da loja (respeitando local); as contagens das pílulas saem do mesmo conjunto.
  let lq = sb.from('estoque_lotes').select('id, codigo_local_estoque, codigo_produto, lote, validade, saldo, origem')
    .eq('loja_id', lojaId).gt('saldo', 0).order('validade', { ascending: true, nullsFirst: false }).order('id').limit(LIMITE)
  if (localCod) lq = lq.eq('codigo_local_estoque', localCod)
  const { data: lotesRaw } = await lq
  let lotes = (lotesRaw ?? []) as { id: number; codigo_local_estoque: number; codigo_produto: number; lote: string | null; validade: string | null; saldo: number; origem: string | null }[]
  const limitado = lotes.length >= LIMITE
  if (codigosFiltro) lotes = lotes.filter((l) => codigosFiltro!.has(Number(l.codigo_produto)))

  const ate: Record<number, number> = {}
  for (const p of PERIODOS_PROPRIO) ate[p] = 0
  let vencidos = 0, hojeN = 0, semValidade = 0
  for (const l of lotes) {
    if (!l.validade) { semValidade++; continue }
    if (l.validade < hoje) { vencidos++; continue }
    if (l.validade === hoje) hojeN++
    for (const p of PERIODOS_PROPRIO) if (l.validade <= somarDias(hoje, p)) ate[p]++
  }
  if (!PERIODOS_PROPRIO.includes(filtro.dias as (typeof PERIODOS_PROPRIO)[number])) {
    ate[filtro.dias] = lotes.filter((l) => l.validade && l.validade >= hoje && l.validade <= somarDias(hoje, filtro.dias)).length
  }

  const visiveis = lotes.filter((l) => passaFiltro(l.validade, hoje, filtro))
  const cods = [...new Set(visiveis.map((l) => Number(l.codigo_produto)))]
  const [{ data: prods }, { data: custos }] = cods.length
    ? await Promise.all([
        sb.from('produtos').select('codigo_produto, codigo, descricao, unidade, descricao_familia, grupo_id').eq('loja_id', lojaId).in('codigo_produto', cods),
        sb.from('estoque_custos').select('codigo_produto, cmc').eq('loja_id', lojaId).in('codigo_produto', cods),
      ])
    : [{ data: [] }, { data: [] }]
  const prodMap = new Map(((prods ?? []) as { codigo_produto: number; codigo: string | null; descricao: string | null; unidade: string | null; descricao_familia: string | null; grupo_id: number | null }[]).map((p) => [Number(p.codigo_produto), p]))
  const cmcMap = new Map(((custos ?? []) as { codigo_produto: number; cmc: number }[]).map((c) => [Number(c.codigo_produto), Number(c.cmc) || 0]))

  let linhas: LinhaLote[] = visiveis.map((l) => {
    const p = prodMap.get(Number(l.codigo_produto))
    const cmc = cmcMap.get(Number(l.codigo_produto)) ?? 0
    const saldo = Number(l.saldo)
    return {
      id: Number(l.id), codigoProduto: Number(l.codigo_produto), produto: p?.descricao ?? `Produto ${l.codigo_produto}`, codigo: p?.codigo ?? null,
      unidade: p?.unidade ?? null, familia: p?.descricao_familia ?? null, grupo: p?.grupo_id != null ? nomeGrupo.get(Number(p.grupo_id)) ?? null : null,
      codigoLocal: Number(l.codigo_local_estoque), local: nomeLocal.get(Number(l.codigo_local_estoque)) ?? String(l.codigo_local_estoque),
      lote: l.lote, validade: l.validade, saldo, cmc, valor: Math.round(saldo * cmc * 100) / 100, origem: l.origem,
    }
  })

  // Ordenação pelo cabeçalho. Padrão: validade crescente (nos vencidos, o mais vencido aparece primeiro).
  const dir = sp.dir === 'desc' ? -1 : 1
  const ord = sp.ord
  const cmp = (a: LinhaLote, b: LinhaLote): number => {
    if (ord === 'produto') return a.produto.localeCompare(b.produto, 'pt-BR') * dir
    if (ord === 'qtd') return (a.saldo - b.saldo) * dir
    if (ord === 'valor') return (a.valor - b.valor) * dir
    if (ord === 'local') return a.local.localeCompare(b.local, 'pt-BR') * dir
    const va = a.validade ?? '9999-12-31', vb = b.validade ?? '9999-12-31'
    return (va < vb ? -1 : va > vb ? 1 : a.id - b.id) * dir
  }
  linhas = linhas.sort(cmp)

  const totais = linhas.reduce((t, l) => ({ lotes: t.lotes + 1, quantidade: t.quantidade + l.saldo, valor: t.valor + l.valor }), { lotes: 0, quantidade: 0, valor: 0 })
  totais.valor = Math.round(totais.valor * 100) / 100

  return {
    linhas, filtro, alertaDias, contagens: { vencidos, hoje: hojeN, ate, semValidade }, totais, locais,
    grupos: grupos.map((g) => ({ id: Number(g.id), nome: g.nome })), divergencias: divergencias ?? 0, limitado,
  }
}
