'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'
import { guardaModulo } from '@/lib/plataforma/guarda'

import { revalidatePath } from 'next/cache'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { carregarBase } from '@/lib/custo-cardapio/carregar'
import { CANAIS, moverNaLista, type CanalCardapio } from '@/lib/custo-cardapio/cardapios-puro'

// Norte Cozinha (só dev): cardápios por canal com preço próprio por prato. Grava só nas tabelas custo_cardapio*
// (nunca no Omie nem no cadastro de produtos). Toda escrita é filtrada pela loja atual.

type Resultado = { ok: true } | { error: string }
type ResultadoId = { ok: true; id: number } | { error: string }

async function contexto(): Promise<{ lojaId: number; ator: string } | { error: string }> {
  const ator = await getAtorGestao()
  if (!ator.podeGerir) return { error: 'Sem permissão' }
  const lojaId = await getCurrentLojaId()
  if (!ator.lojaIds.includes(lojaId)) return { error: 'Sem permissão nesta loja' }
  return { lojaId, ator: ator.id }
}

const idValido = (v: unknown) => Number.isSafeInteger(Number(v)) && Number(v) > 0
const limparNome = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim()

function validarNomeCanal(nome: unknown, canal: unknown): { nome: string; canal: CanalCardapio } | { error: string } {
  const n = limparNome(nome)
  if (n.length < 1 || n.length > 80) return { error: 'O nome deve ter entre 1 e 80 caracteres.' }
  if (!(CANAIS as readonly string[]).includes(String(canal))) return { error: 'Canal inválido.' }
  return { nome: n, canal: canal as CanalCardapio }
}

/** O cardápio existe e é desta loja. */
async function cardapioDaLoja(lojaId: number, cardapioId: number): Promise<boolean> {
  const { data } = await createServiceClient().from('custo_cardapios').select('id').eq('id', cardapioId).eq('loja_id', lojaId).maybeSingle()
  return !!data
}

function revalidar(id?: number) {
  revalidatePath('/cozinha/cardapios')
  if (id) revalidatePath(`/cozinha/cardapios/${id}`)
}

export async function criarCardapio(nome: string, canal: string): Promise<ResultadoId> {
  const __d = viaDesktop('cozinha-cardapios#criarCardapio', criarCardapio, [nome, canal]); if (__d) return __d as never
  await guardaModulo('cozinha-cardapios#criarCardapio')
  const c = await contexto()
  if ('error' in c) return c
  const v = validarNomeCanal(nome, canal)
  if ('error' in v) return v
  const { data, error } = await createServiceClient().from('custo_cardapios')
    .insert({ loja_id: c.lojaId, nome: v.nome, canal: v.canal, criado_por: c.ator }).select('id').single()
  if (error || !data) return { error: error?.message ?? 'Não foi possível criar o cardápio.' }
  revalidar()
  return { ok: true, id: Number(data.id) }
}

export async function editarCardapio(id: number, nome: string, canal: string): Promise<Resultado> {
  const __d = viaDesktop('cozinha-cardapios#editarCardapio', editarCardapio, [id, nome, canal]); if (__d) return __d as never
  await guardaModulo('cozinha-cardapios#editarCardapio')
  const c = await contexto()
  if ('error' in c) return c
  if (!idValido(id)) return { error: 'Cardápio inválido.' }
  const v = validarNomeCanal(nome, canal)
  if ('error' in v) return v
  const { data, error } = await createServiceClient().from('custo_cardapios')
    .update({ nome: v.nome, canal: v.canal, updated_at: new Date().toISOString() }).eq('id', id).eq('loja_id', c.lojaId).select('id')
  if (error) return { error: error.message }
  if (!data?.length) return { error: 'Cardápio não encontrado nesta loja.' }
  revalidar(id)
  return { ok: true }
}

export async function arquivarCardapio(id: number, ativo: boolean): Promise<Resultado> {
  const __d = viaDesktop('cozinha-cardapios#arquivarCardapio', arquivarCardapio, [id, ativo]); if (__d) return __d as never
  await guardaModulo('cozinha-cardapios#arquivarCardapio')
  const c = await contexto()
  if ('error' in c) return c
  if (!idValido(id)) return { error: 'Cardápio inválido.' }
  const { data, error } = await createServiceClient().from('custo_cardapios')
    .update({ ativo: !!ativo, updated_at: new Date().toISOString() }).eq('id', id).eq('loja_id', c.lojaId).select('id')
  if (error) return { error: error.message }
  if (!data?.length) return { error: 'Cardápio não encontrado nesta loja.' }
  revalidar(id)
  return { ok: true }
}

export async function adicionarPratoCardapio(cardapioId: number, codigo: number): Promise<Resultado> {
  const __d = viaDesktop('cozinha-cardapios#adicionarPratoCardapio', adicionarPratoCardapio, [cardapioId, codigo]); if (__d) return __d as never
  await guardaModulo('cozinha-cardapios#adicionarPratoCardapio')
  const c = await contexto()
  if ('error' in c) return c
  if (!idValido(cardapioId) || !idValido(codigo)) return { error: 'Pedido inválido.' }
  if (!(await cardapioDaLoja(c.lojaId, cardapioId))) return { error: 'Cardápio não encontrado nesta loja.' }
  const base = await carregarBase(c.lojaId)
  if (!base) return { error: 'Esta loja não controla estoque.' }
  const p = base.produtos.get(Number(codigo))
  if (!p || p.inativo || !base.fichas.has(Number(codigo))) return { error: 'Este produto não tem ficha técnica nesta loja.' }
  const sb = createServiceClient()
  const { data: ultimo } = await sb.from('custo_cardapio_itens').select('ordem').eq('cardapio_id', cardapioId).eq('loja_id', c.lojaId)
    .order('ordem', { ascending: false }).limit(1).maybeSingle()
  const { error } = await sb.from('custo_cardapio_itens')
    .insert({ cardapio_id: cardapioId, loja_id: c.lojaId, codigo_produto: Number(codigo), ordem: Number(ultimo?.ordem ?? -1) + 1 })
  if (error) return { error: /duplicate|unique/i.test(error.message) ? 'Este prato já está no cardápio.' : error.message }
  await sb.from('custo_cardapios').update({ updated_at: new Date().toISOString() }).eq('id', cardapioId).eq('loja_id', c.lojaId)
  revalidar(cardapioId)
  return { ok: true }
}

export async function removerItemCardapio(itemId: number): Promise<Resultado> {
  const __d = viaDesktop('cozinha-cardapios#removerItemCardapio', removerItemCardapio, [itemId]); if (__d) return __d as never
  await guardaModulo('cozinha-cardapios#removerItemCardapio')
  const c = await contexto()
  if ('error' in c) return c
  if (!idValido(itemId)) return { error: 'Item inválido.' }
  const { data, error } = await createServiceClient().from('custo_cardapio_itens').delete().eq('id', itemId).eq('loja_id', c.lojaId).select('cardapio_id')
  if (error) return { error: error.message }
  if (!data?.length) return { error: 'Item não encontrado nesta loja.' }
  revalidar(Number(data[0].cardapio_id))
  return { ok: true }
}

/** Sobe ou desce o prato uma posição (renumera a ordem do cardápio inteiro). */
export async function moverItemCardapio(itemId: number, direcao: string): Promise<Resultado> {
  const __d = viaDesktop('cozinha-cardapios#moverItemCardapio', moverItemCardapio, [itemId, direcao]); if (__d) return __d as never
  await guardaModulo('cozinha-cardapios#moverItemCardapio')
  const c = await contexto()
  if ('error' in c) return c
  if (!idValido(itemId) || (direcao !== 'cima' && direcao !== 'baixo')) return { error: 'Pedido inválido.' }
  const sb = createServiceClient()
  const { data: item } = await sb.from('custo_cardapio_itens').select('cardapio_id').eq('id', itemId).eq('loja_id', c.lojaId).maybeSingle()
  if (!item) return { error: 'Item não encontrado nesta loja.' }
  const cardapioId = Number(item.cardapio_id)
  const { data: todos, error } = await sb.from('custo_cardapio_itens').select('id, ordem').eq('cardapio_id', cardapioId).eq('loja_id', c.lojaId)
    .order('ordem').order('id')
  if (error) return { error: error.message }
  const nova = moverNaLista((todos ?? []).map((t) => Number(t.id)), Number(itemId), direcao)
  if (!nova) return { ok: true }
  const atual = new Map((todos ?? []).map((t) => [Number(t.id), Number(t.ordem)]))
  for (const [ordem, id] of nova.entries()) {
    if (atual.get(id) === ordem) continue
    const { error: e } = await sb.from('custo_cardapio_itens').update({ ordem }).eq('id', id).eq('loja_id', c.lojaId)
    if (e) return { error: e.message }
  }
  revalidar(cardapioId)
  return { ok: true }
}

/** Preço só deste cardápio (null = volta a usar o preço do cadastro). Não mexe no Omie nem no produto. */
export async function definirPrecoItemCardapio(itemId: number, preco: number | null): Promise<Resultado> {
  const __d = viaDesktop('cozinha-cardapios#definirPrecoItemCardapio', definirPrecoItemCardapio, [itemId, preco]); if (__d) return __d as never
  await guardaModulo('cozinha-cardapios#definirPrecoItemCardapio')
  const c = await contexto()
  if ('error' in c) return c
  if (!idValido(itemId)) return { error: 'Item inválido.' }
  let valor: number | null = null
  if (preco != null) {
    const n = Number(preco)
    if (!Number.isFinite(n) || n < 0.1 || n > 100000) return { error: 'Preço inválido (entre R$ 0,10 e R$ 100.000).' }
    valor = Math.round(n * 100) / 100
  }
  const { data, error } = await createServiceClient().from('custo_cardapio_itens').update({ preco: valor }).eq('id', itemId).eq('loja_id', c.lojaId).select('cardapio_id')
  if (error) return { error: error.message }
  if (!data?.length) return { error: 'Item não encontrado nesta loja.' }
  revalidar(Number(data[0].cardapio_id))
  return { ok: true }
}

/** Grava vários preços do cardápio de uma vez (ex.: "usar os preços sugeridos"). Só itens deste cardápio e desta loja. */
export async function definirPrecosCardapio(cardapioId: number, precos: { itemId: number; preco: number }[]): Promise<Resultado> {
  const __d = viaDesktop('cozinha-cardapios#definirPrecosCardapio', definirPrecosCardapio, [cardapioId, precos]); if (__d) return __d as never
  await guardaModulo('cozinha-cardapios#definirPrecosCardapio')
  const c = await contexto()
  if ('error' in c) return c
  if (!idValido(cardapioId) || !Array.isArray(precos) || precos.length === 0 || precos.length > 500) return { error: 'Pedido inválido.' }
  for (const p of precos) {
    if (!idValido(p?.itemId) || !Number.isFinite(Number(p?.preco)) || Number(p.preco) < 0.1 || Number(p.preco) > 100000) return { error: 'Preço inválido.' }
  }
  if (!(await cardapioDaLoja(c.lojaId, cardapioId))) return { error: 'Cardápio não encontrado nesta loja.' }
  const sb = createServiceClient()
  for (const p of precos) {
    const { error } = await sb.from('custo_cardapio_itens').update({ preco: Math.round(Number(p.preco) * 100) / 100 })
      .eq('id', p.itemId).eq('cardapio_id', cardapioId).eq('loja_id', c.lojaId)
    if (error) return { error: error.message }
  }
  revalidar(cardapioId)
  return { ok: true }
}

/** Porções deste prato no conjunto (ex.: 2 porções no rodízio). Entre 0,001 e 1000, 3 casas. */
export async function definirPorcoesItemCardapio(itemId: number, porcoes: number): Promise<Resultado> {
  const __d = viaDesktop('cozinha-cardapios#definirPorcoesItemCardapio', definirPorcoesItemCardapio, [itemId, porcoes]); if (__d) return __d as never
  await guardaModulo('cozinha-cardapios#definirPorcoesItemCardapio')
  const c = await contexto()
  if ('error' in c) return c
  if (!idValido(itemId)) return { error: 'Item inválido.' }
  const n = Math.round(Number(porcoes) * 1000) / 1000
  if (!Number.isFinite(n) || n <= 0 || n > 1000) return { error: 'Porções inválidas (mais que 0 e até 1000).' }
  const { data, error } = await createServiceClient().from('custo_cardapio_itens').update({ porcoes: n }).eq('id', itemId).eq('loja_id', c.lojaId).select('cardapio_id')
  if (error) return { error: /porcoes/.test(error.message) ? 'As porções ainda não existem nesta base (migration 474 pendente).' : error.message }
  if (!data?.length) return { error: 'Item não encontrado nesta loja.' }
  revalidar(Number(data[0].cardapio_id))
  return { ok: true }
}

/** Copia o cardápio (nome "(cópia)", mesmo canal, mesmos pratos, preços próprios, porções e ordem). Nasce ativo. */
export async function duplicarCardapio(id: number): Promise<ResultadoId> {
  const __d = viaDesktop('cozinha-cardapios#duplicarCardapio', duplicarCardapio, [id]); if (__d) return __d as never
  await guardaModulo('cozinha-cardapios#duplicarCardapio')
  const c = await contexto()
  if ('error' in c) return c
  if (!idValido(id)) return { error: 'Cardápio inválido.' }
  const sb = createServiceClient()
  const { data: orig } = await sb.from('custo_cardapios').select('id, nome, canal').eq('id', id).eq('loja_id', c.lojaId).maybeSingle()
  if (!orig) return { error: 'Cardápio não encontrado nesta loja.' }
  const { data: itens, error: eItens } = await sb.from('custo_cardapio_itens').select('codigo_produto, preco, ordem, porcoes')
    .eq('cardapio_id', id).eq('loja_id', c.lojaId).order('ordem').order('id')
  if (eItens) return { error: eItens.message }
  const sufixo = ' (cópia)'
  const nome = `${limparNome(orig.nome).slice(0, 80 - sufixo.length).trimEnd()}${sufixo}`
  const { data: novo, error } = await sb.from('custo_cardapios')
    .insert({ loja_id: c.lojaId, nome, canal: orig.canal, criado_por: c.ator }).select('id').single()
  if (error || !novo) return { error: error?.message ?? 'Não foi possível duplicar o cardápio.' }
  const novoId = Number(novo.id)
  if (itens?.length) {
    const { error: e2 } = await sb.from('custo_cardapio_itens').insert(itens.map((i) => ({
      cardapio_id: novoId, loja_id: c.lojaId, codigo_produto: i.codigo_produto, preco: i.preco, ordem: i.ordem, porcoes: i.porcoes ?? 1,
    })))
    if (e2) {
      // Sem os itens a cópia não serve: desfaz o cabeçalho.
      await sb.from('custo_cardapios').delete().eq('id', novoId).eq('loja_id', c.lojaId)
      return { error: e2.message }
    }
  }
  revalidar(novoId)
  return { ok: true, id: novoId }
}
