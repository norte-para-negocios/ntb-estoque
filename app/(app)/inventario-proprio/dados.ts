import { createClient, createServiceClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'

export type ClasseAbc = 'A' | 'B' | 'C'

export type ResumoInventario = {
  id: number
  codigoLocal: number
  local: string
  status: 'aberto' | 'fechado' | 'cancelado'
  tipo: 'geral' | 'ciclica'
  classe: ClasseAbc | null
  descricao: string | null
  abertoEm: string
  fechadoEm: string | null
  totalItens: number
  contados: number
  valorAjustes: number | null
}

type InvRow = {
  id: number; codigo_local_estoque: number; status: string; tipo: string; classe: string | null; descricao: string | null
  aberto_em: string; fechado_em: string | null; total_itens: number | null; total_contados: number | null; total_ajustes_valor: number | null
}

export async function carregarLocais(lojaId: number) {
  const supabase = await createClient()
  const { data } = await supabase.from('local_estoques').select('codigo_local_estoque, descricao, inativo').eq('loja_id', lojaId).order('descricao')
  return (data ?? []).filter((l) => l.inativo !== 'S').map((l) => ({ codigoLocal: Number(l.codigo_local_estoque), descricao: l.descricao ?? String(l.codigo_local_estoque) }))
}

export async function listarInventarios(lojaId: number): Promise<ResumoInventario[]> {
  const supabase = await createClient()
  const [{ data: invs }, locais] = await Promise.all([
    supabase.from('inventarios_proprio')
      .select('id, codigo_local_estoque, status, tipo, classe, descricao, aberto_em, fechado_em, total_itens, total_contados, total_ajustes_valor')
      .eq('loja_id', lojaId).order('id', { ascending: false }).limit(60),
    carregarLocais(lojaId),
  ])
  const rows = (invs ?? []) as InvRow[]
  const abertos = rows.filter((r) => r.status === 'aberto').map((r) => r.id)
  // Progresso só dos abertos (o resto já guarda o total fechado).
  const contadosPorInv = new Map<number, { total: number; contados: number }>()
  if (abertos.length) {
    const itens = await buscarTodasLinhas<{ inventario_id: number; contado: number | null }>((from, to) =>
      supabase.from('inventario_proprio_itens').select('inventario_id, contado').in('inventario_id', abertos).order('id').range(from, to))
    for (const i of itens) {
      const c = contadosPorInv.get(Number(i.inventario_id)) ?? { total: 0, contados: 0 }
      c.total += 1
      if (i.contado != null) c.contados += 1
      contadosPorInv.set(Number(i.inventario_id), c)
    }
  }
  const nomeLocal = new Map(locais.map((l) => [l.codigoLocal, l.descricao]))
  return rows.map((r) => {
    const prog = contadosPorInv.get(Number(r.id))
    return {
      id: Number(r.id), codigoLocal: Number(r.codigo_local_estoque), local: nomeLocal.get(Number(r.codigo_local_estoque)) ?? String(r.codigo_local_estoque),
      status: r.status as ResumoInventario['status'], tipo: r.tipo as ResumoInventario['tipo'], classe: (r.classe as ClasseAbc | null) ?? null,
      descricao: r.descricao, abertoEm: r.aberto_em, fechadoEm: r.fechado_em,
      totalItens: prog?.total ?? Number(r.total_itens ?? 0), contados: prog?.contados ?? Number(r.total_contados ?? 0),
      valorAjustes: r.total_ajustes_valor == null ? null : Number(r.total_ajustes_valor),
    }
  })
}

/** Quantos itens cada curva teria (para o aviso do modal de contagem cíclica). */
export async function contarPorClasse(lojaId: number): Promise<Record<ClasseAbc, number>> {
  const { data } = await createServiceClient().rpc('curva_abc', { p_loja: lojaId, p_dias: null })
  const r: Record<ClasseAbc, number> = { A: 0, B: 0, C: 0 }
  for (const x of (data ?? []) as { classe: ClasseAbc }[]) r[x.classe] = (r[x.classe] ?? 0) + 1
  return r
}

export type ItemContagem = {
  codigoProduto: number
  codigo: string
  descricao: string
  unidade: string
  contado: number | null
  contadoEm: string | null
}

type ProdutoMin = { codigo_produto: number; codigo: string | null; descricao: string | null; unidade: string | null }

async function mapaProdutos(lojaId: number): Promise<Map<number, ProdutoMin>> {
  const supabase = await createClient()
  const produtos = await buscarTodasLinhas<ProdutoMin>((from, to) =>
    supabase.from('produtos').select('codigo_produto, codigo, descricao, unidade').eq('loja_id', lojaId).order('id').range(from, to))
  return new Map(produtos.map((p) => [Number(p.codigo_produto), p]))
}

export async function carregarInventario(lojaId: number, id: number): Promise<ResumoInventario | null> {
  return (await listarInventarios(lojaId)).find((i) => i.id === id) ?? (await buscarUm(lojaId, id))
}

async function buscarUm(lojaId: number, id: number): Promise<ResumoInventario | null> {
  const supabase = await createClient()
  const { data } = await supabase.from('inventarios_proprio')
    .select('id, codigo_local_estoque, status, tipo, classe, descricao, aberto_em, fechado_em, total_itens, total_contados, total_ajustes_valor')
    .eq('loja_id', lojaId).eq('id', id).maybeSingle()
  if (!data) return null
  const locais = await carregarLocais(lojaId)
  const r = data as InvRow
  return {
    id: Number(r.id), codigoLocal: Number(r.codigo_local_estoque), local: locais.find((l) => l.codigoLocal === Number(r.codigo_local_estoque))?.descricao ?? String(r.codigo_local_estoque),
    status: r.status as ResumoInventario['status'], tipo: r.tipo as ResumoInventario['tipo'], classe: (r.classe as ClasseAbc | null) ?? null,
    descricao: r.descricao, abertoEm: r.aberto_em, fechadoEm: r.fechado_em, totalItens: Number(r.total_itens ?? 0), contados: Number(r.total_contados ?? 0),
    valorAjustes: r.total_ajustes_valor == null ? null : Number(r.total_ajustes_valor),
  }
}

/** Itens da contagem SEM o saldo do sistema: a coluna saldo_snapshot não é legível pela sessão (contagem cega). */
export async function carregarItensContagem(lojaId: number, id: number): Promise<ItemContagem[]> {
  const supabase = await createClient()
  const [itens, produtos] = await Promise.all([
    buscarTodasLinhas<{ codigo_produto: number; contado: number | null; contado_em: string | null }>((from, to) =>
      supabase.from('inventario_proprio_itens').select('codigo_produto, contado, contado_em').eq('inventario_id', id).eq('loja_id', lojaId).order('id').range(from, to)),
    mapaProdutos(lojaId),
  ])
  return itens
    .map((i) => {
      const p = produtos.get(Number(i.codigo_produto))
      return {
        codigoProduto: Number(i.codigo_produto), codigo: p?.codigo ?? String(i.codigo_produto), descricao: p?.descricao ?? '(sem descrição)',
        unidade: p?.unidade ?? 'UN', contado: i.contado == null ? null : Number(i.contado), contadoEm: i.contado_em,
      }
    })
    .sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'))
}

export type LinhaVarianciaTela = {
  codigoProduto: number; codigo: string; descricao: string; unidade: string
  esperado: number; contado: number; delta: number; cmc: number; valorDelta: number; motivo: string | null; exigeMotivo: boolean
  aplicado: number | null
}

/** Revisão do gerente (mostra o esperado do sistema). Só para quem tem permissão; a página confere antes de chamar. */
export async function carregarVariancia(lojaId: number, id: number): Promise<LinhaVarianciaTela[]> {
  const svc = createServiceClient()
  const { data } = await svc.rpc('inventario_variancia', { p_inventario: id })
  const produtos = await mapaProdutos(lojaId)
  const { data: aplicados } = await svc.from('inventario_proprio_itens').select('codigo_produto, delta_aplicado').eq('inventario_id', id).eq('loja_id', lojaId)
  const aplic = new Map((aplicados ?? []).map((a) => [Number(a.codigo_produto), a.delta_aplicado == null ? null : Number(a.delta_aplicado)]))
  type V = { codigo_produto: number; esperado: number; contado: number; delta: number; cmc: number; valor_delta: number; motivo: string | null; exige_motivo: boolean }
  return ((data ?? []) as V[])
    .map((v) => {
      const p = produtos.get(Number(v.codigo_produto))
      return {
        codigoProduto: Number(v.codigo_produto), codigo: p?.codigo ?? String(v.codigo_produto), descricao: p?.descricao ?? '(sem descrição)', unidade: p?.unidade ?? 'UN',
        esperado: Number(v.esperado), contado: Number(v.contado), delta: Number(v.delta), cmc: Number(v.cmc), valorDelta: Number(v.valor_delta),
        motivo: v.motivo, exigeMotivo: !!v.exige_motivo, aplicado: aplic.get(Number(v.codigo_produto)) ?? null,
      }
    })
    .sort((a, b) => Math.abs(b.valorDelta) - Math.abs(a.valorDelta) || a.descricao.localeCompare(b.descricao, 'pt-BR'))
}

export async function limiteMotivo(lojaId: number): Promise<number> {
  const { data } = await createServiceClient().from('estoque_config').select('limite_motivo_inventario').eq('loja_id', lojaId).maybeSingle()
  return Number(data?.limite_motivo_inventario ?? 50)
}
