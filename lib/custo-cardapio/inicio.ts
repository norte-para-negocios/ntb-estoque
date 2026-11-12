import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { hojeBahiaISO } from '@/lib/data-bahia'
import type { BaseCusto } from './carregar'
import { saldosDaLoja } from './saldos'
import { reservasDeEventos } from './reservas'
import { explodirEvento, porcoesNoEvento } from './eventos-puro'
import { compraDoEvento, inicioDaSemana, type ResumoCompraEvento } from './inicio-puro'

// Norte Cozinha, Início: próximo evento (com o que falta comprar) e a contagem da semana. Só leitura.
// Inventários lidos do ERP: Omie = inventarios (data) + inventario_items (produto_codigo_produto, status 'Concluido' =
// ajuste aplicado no Omie); estoque próprio = inventarios_proprio (status 'fechado', fechado_em) + inventario_proprio_itens
// (codigo_produto, contado não nulo).

type Pg<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

export type ProximoEvento = {
  id: number; nome: string; data: string | null; convidados: number; status: string
  /** Eventos (orçamento ou confirmado) de hoje até 7 dias, contando este. */
  naSemana: number
  compra: ResumoCompraEvento
}

export async function proximoEvento(base: BaseCusto): Promise<ProximoEvento | null> {
  const supabase = await createClient()
  const hoje = hojeBahiaISO()
  const { data, error } = await supabase.from('custo_eventos').select('id, nome, data_evento, convidados, status, folga_pct')
    .eq('loja_id', base.lojaId).in('status', ['orcamento', 'confirmado']).is('finalizado_em', null)
    .gte('data_evento', hoje).order('data_evento').order('id').limit(20)
  if (error || !data?.length) return null
  const e = data[0]
  const limite = new Date(Date.parse(`${hoje}T12:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10)
  const naSemana = data.filter((x) => x.data_evento && String(x.data_evento).slice(0, 10) <= limite).length
  const { data: its } = await supabase.from('custo_evento_itens').select('codigo_produto, porcoes_por_convidado')
    .eq('loja_id', base.lojaId).eq('evento_id', e.id).order('id').limit(500)
  const folga = 1 + Number(e.folga_pct ?? 0) / 100
  const ex = explodirEvento(base.fichas, base.cmc, (its ?? []).map((i) => ({
    codigo: Number(i.codigo_produto), porcoes: porcoesNoEvento(Number(e.convidados), Number(i.porcoes_por_convidado)) * folga,
  })))
  const [saldos, outros] = await Promise.all([saldosDaLoja(base.lojaId, base.modo), reservasDeEventos(base, Number(e.id))])
  const saldo = (cod: number) => {
    const naFicha = base.unidadeNaFicha.get(cod)
    const doEstoque = base.produtos.get(cod)?.unidade?.toUpperCase()
    if (naFicha && doEstoque && naFicha !== doEstoque) return undefined
    return saldos.porProduto.get(cod)?.saldo ?? 0
  }
  return {
    id: Number(e.id), nome: e.nome, data: e.data_evento ? String(e.data_evento).slice(0, 10) : null, convidados: Number(e.convidados), status: e.status,
    naSemana, compra: compraDoEvento(ex.insumos, saldo, (cod) => outros.total.get(cod) ?? 0),
  }
}

export type ContagemSemana = { contados: Set<number>; ultima: string | null; erro: boolean }

/** Produtos contados desde a segunda-feira desta semana e a data da última contagem (qualquer semana). */
export async function contagemDaSemana(lojaId: number, modo: 'omie' | 'proprio'): Promise<ContagemSemana> {
  const supabase = await createClient()
  const desde = inicioDaSemana(hojeBahiaISO())
  // Segunda 00:00 na Bahia (UTC−3).
  const desdeTs = `${desde}T03:00:00Z`
  const contados = new Set<number>()
  if (modo === 'proprio') {
    const [{ data: ult }, { data: semana, error }] = await Promise.all([
      supabase.from('inventarios_proprio').select('fechado_em').eq('loja_id', lojaId).eq('status', 'fechado')
        .order('fechado_em', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('inventarios_proprio').select('id').eq('loja_id', lojaId).eq('status', 'fechado').gte('fechado_em', desdeTs).limit(200),
    ])
    if (error) return { contados, ultima: null, erro: true }
    for (const inv of semana ?? []) {
      type R = { codigo_produto: number }
      const rows = await buscarTodasLinhas<R>((from, to) =>
        supabase.from('inventario_proprio_itens').select('id, codigo_produto').eq('loja_id', lojaId).eq('inventario_id', inv.id)
          .not('contado', 'is', null).order('id').range(from, to) as unknown as Pg<R>)
      for (const r of rows) contados.add(Number(r.codigo_produto))
    }
    return { contados, ultima: ult?.fechado_em ? String(ult.fechado_em) : null, erro: false }
  }
  const [{ data: ult }, { data: semana, error }] = await Promise.all([
    supabase.from('inventarios').select('data').eq('loja_id', lojaId).order('data', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('inventarios').select('id').eq('loja_id', lojaId).gte('data', desdeTs).limit(200),
  ])
  if (error) return { contados, ultima: null, erro: true }
  for (const inv of semana ?? []) {
    type R = { produto_codigo_produto: number | null }
    const rows = await buscarTodasLinhas<R>((from, to) =>
      supabase.from('inventario_items').select('id, produto_codigo_produto').eq('loja_id', lojaId).eq('inventario_id', inv.id)
        .eq('status', 'Concluido').order('id').range(from, to) as unknown as Pg<R>)
    for (const r of rows) if (r.produto_codigo_produto != null) contados.add(Number(r.produto_codigo_produto))
  }
  return { contados, ultima: ult?.data ? String(ult.data) : null, erro: false }
}
