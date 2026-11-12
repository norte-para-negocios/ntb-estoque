import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { linhasDoCardapio, type BaseCusto, type LinhaPrato } from './carregar'
import { CANAIS, contaDoItem, resumoDoCardapio, type CanalCardapio, type ContaItem, type ResumoDoCardapio } from './cardapios-puro'

// Norte Cozinha, Cardápios: leitura (RLS) e a conta de cada prato do cardápio. Gravação só em lib/actions/cozinha-cardapios.ts.

export type CardapioRow = { id: number; nome: string; canal: CanalCardapio; ativo: boolean; created_at: string; updated_at: string }
type ItemRow = { id: number; cardapio_id: number; codigo_produto: number; preco: number | string | null; ordem: number }

export type ItemCardapioTela = {
  itemId: number
  codigo: number
  codigoTexto: string
  descricao: string
  familia: string | null
  custo: number
  semCusto: number
  suspeitos: number
  ciclo: boolean
  precoCadastro: number | null
  precoProprio: number | null
  /** O prato saiu do cadastro, ficou inativo ou perdeu a ficha: não entra na conta. */
  semFicha: boolean
  conta: ContaItem
}

export type CardapioComConta = CardapioRow & { itens: ItemCardapioTela[]; resumo: ResumoDoCardapio }

const canalValido = (c: string): CanalCardapio => ((CANAIS as readonly string[]).includes(c) ? (c as CanalCardapio) : 'salao')
const numOuNull = (v: number | string | null) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)

function montarItens(base: BaseCusto, porCodigo: Map<number, LinhaPrato>, canal: CanalCardapio, rows: ItemRow[]): ItemCardapioTela[] {
  return [...rows].sort((a, b) => a.ordem - b.ordem || a.id - b.id).map((r) => {
    const cod = Number(r.codigo_produto)
    const l = porCodigo.get(cod)
    const p = base.produtos.get(cod)
    const precoProprio = numOuNull(r.preco)
    const custo = l?.custo ?? 0
    const semCusto = l?.semCusto ?? 0
    const suspeitos = l?.suspeitos ?? 0
    const precoCadastro = l?.preco ?? null
    return {
      itemId: Number(r.id), codigo: cod, codigoTexto: l?.codigoTexto ?? p?.codigoTexto ?? String(cod),
      descricao: l?.descricao ?? p?.descricao ?? `Produto ${cod}`, familia: l?.familia ?? p?.familia ?? null,
      custo, semCusto, suspeitos, ciclo: l?.ciclo ?? false, precoCadastro, precoProprio, semFicha: !l,
      conta: contaDoItem({ custo, semCusto: l ? semCusto : 1, suspeitos, precoCadastro, precoProprio }, canal, base.taxas),
    }
  })
}

const comResumo = (c: CardapioRow, itens: ItemCardapioTela[], base: BaseCusto): CardapioComConta => ({
  ...c, itens, resumo: resumoDoCardapio(itens.map((i) => ({ conta: i.conta, custo: i.custo })), c.canal, base.taxas),
})

/** Pratos (com ficha) que podem entrar num cardápio, já com custo e preço. */
export function pratosDisponiveis(base: BaseCusto): LinhaPrato[] {
  return linhasDoCardapio(base).filter((l) => l.tipo === 'prato')
}

export async function listarCardapios(base: BaseCusto): Promise<{ cardapios: CardapioComConta[]; erro: string | null }> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('custo_cardapios').select('id, nome, canal, ativo, created_at, updated_at')
    .eq('loja_id', base.lojaId).order('ativo', { ascending: false }).order('nome')
  if (error) return { cardapios: [], erro: error.message }
  let erroItens: string | null = null
  const itens = await buscarTodasLinhas<ItemRow>((from, to) =>
    supabase.from('custo_cardapio_itens').select('id, cardapio_id, codigo_produto, preco, ordem').eq('loja_id', base.lojaId)
      .order('id').range(from, to) as unknown as PromiseLike<{ data: ItemRow[] | null; error: { message: string } | null }>,
  undefined, (e) => { erroItens = e.message })
  const porCodigo = new Map(linhasDoCardapio(base).map((l) => [l.codigo, l]))
  const porCardapio = new Map<number, ItemRow[]>()
  for (const i of itens) porCardapio.set(Number(i.cardapio_id), [...(porCardapio.get(Number(i.cardapio_id)) ?? []), i])
  const cardapios = (data ?? []).map((r) => {
    const c: CardapioRow = { ...r, id: Number(r.id), canal: canalValido(r.canal) }
    return comResumo(c, montarItens(base, porCodigo, c.canal, porCardapio.get(c.id) ?? []), base)
  })
  return { cardapios, erro: erroItens }
}

export async function carregarCardapio(base: BaseCusto, id: number): Promise<CardapioComConta | null> {
  const supabase = await createClient()
  const { data } = await supabase.from('custo_cardapios').select('id, nome, canal, ativo, created_at, updated_at')
    .eq('loja_id', base.lojaId).eq('id', id).maybeSingle()
  if (!data) return null
  const { data: itens } = await supabase.from('custo_cardapio_itens').select('id, cardapio_id, codigo_produto, preco, ordem')
    .eq('loja_id', base.lojaId).eq('cardapio_id', id).order('ordem').order('id')
  const c: CardapioRow = { ...data, id: Number(data.id), canal: canalValido(data.canal) }
  const porCodigo = new Map(linhasDoCardapio(base).map((l) => [l.codigo, l]))
  return comResumo(c, montarItens(base, porCodigo, c.canal, (itens ?? []) as ItemRow[]), base)
}
