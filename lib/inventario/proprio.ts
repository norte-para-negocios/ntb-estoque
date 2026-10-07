// Inventário em loja de estoque PRÓPRIO: o "envio" do item lança um ajuste (AJU) no ledger em vez de chamar o Omie.
// A tela, a lista, o PDF e o Excel continuam lendo inventarios / inventario_items (mesmos campos de sempre).
import { createServiceClient } from '@/lib/supabase/server'
import { ajuste, estornar } from '@/lib/estoque/ledger'
import { exigeMotivo } from './proprio-regras'

const r6 = (n: number) => Math.round(n * 1e6) / 1e6

export type ResultadoItem = {
  status: string
  descricao_status: string | null
  valor: number | null
  id_ajuste: number | null
  diferenca: number | null
}

export const STATUS_AGUARDANDO_MOTIVO = 'Aguardando motivo'

function fmt(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
}

function dataBahia(iso: string | null): string | null {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
}

/** Limite de valor (R$) a partir do qual a diferença exige motivo. */
export async function limiteMotivo(lojaId: number): Promise<number> {
  const { data } = await createServiceClient().from('estoque_config').select('limite_motivo_inventario').eq('loja_id', lojaId).maybeSingle()
  const v = Number((data as { limite_motivo_inventario?: number } | null)?.limite_motivo_inventario)
  return Number.isFinite(v) && v >= 0 ? v : 50
}

export async function saldoECusto(lojaId: number, local: number, produto: number): Promise<{ saldo: number; cmc: number }> {
  const sb = createServiceClient()
  const [{ data: s }, { data: c }] = await Promise.all([
    sb.from('estoque_saldos').select('saldo').eq('loja_id', lojaId).eq('codigo_local_estoque', local).eq('codigo_produto', produto).maybeSingle(),
    sb.from('estoque_custos').select('cmc').eq('loja_id', lojaId).eq('codigo_produto', produto).maybeSingle(),
  ])
  return { saldo: Number((s as { saldo?: number } | null)?.saldo ?? 0), cmc: Number((c as { cmc?: number } | null)?.cmc ?? 0) }
}

/**
 * Lança (ou refaz) o ajuste de UM item contado. `quan` é a quantidade contada; a diferença é calculada contra o saldo
 * do local NO MOMENTO do envio. Não bloqueia por falta de custo (custo zero é aceito; só não há valor da diferença).
 */
export async function lancarItem(p: {
  lojaId: number
  itemId: number
  inventarioId: number
  local: number
  dataIso: string | null
  produto: number
  quan: number
  motivo: string | null
  usuario: string
}): Promise<ResultadoItem> {
  const sb = createServiceClient()
  const { saldo, cmc } = await saldoECusto(p.lojaId, p.local, p.produto)
  const delta = r6(p.quan - saldo)
  const limite = await limiteMotivo(p.lojaId)
  const agora = new Date().toISOString()

  if (exigeMotivo(delta, cmc, limite, p.motivo)) {
    const desc = `Diferença de ${delta > 0 ? '+' : ''}${fmt(delta)} (R$ ${fmt(Math.abs(delta * cmc))}) passa do limite de R$ ${fmt(limite)}: informe o motivo.`
    await sb.from('inventario_items').update({ quan: p.quan, status: STATUS_AGUARDANDO_MOTIVO, descricao_status: desc, valor: cmc, diferenca: delta, updated_at: agora }).eq('id', p.itemId)
    return { status: STATUS_AGUARDANDO_MOTIVO, descricao_status: desc, valor: cmc, id_ajuste: null, diferenca: delta }
  }

  let idMov: number | null = null
  if (delta !== 0) {
    const { count } = await sb.from('estoque_movimentos').select('id', { count: 'exact', head: true }).eq('loja_id', p.lojaId).eq('origem', 'INVENTARIO').like('ref', `inv:${p.itemId}:%`)
    const ref = `inv:${p.itemId}:r${(count ?? 0) + 1}`
    const r = await ajuste({
      lojaId: p.lojaId, local: p.local, produto: p.produto, origem: 'INVENTARIO', ref, quantidade: delta,
      user: p.usuario, obs: `Inventário #${p.inventarioId}${p.motivo ? ' — ' + p.motivo.trim() : ''}`, data: dataBahia(p.dataIso),
    })
    idMov = r.id
  }
  const desc = delta === 0 ? 'Sem diferença' : `Ajuste de ${delta > 0 ? '+' : ''}${fmt(delta)} lançado no estoque`
  await sb.from('inventario_items').update({
    quan: p.quan, status: 'Concluido', valor: cmc, diferenca: delta, id_ajuste: idMov, id_movest: null, codigo_status: null,
    descricao_status: desc, motivo: p.motivo?.trim() || null, tentativas: 0, ultima_tentativa_em: agora, updated_at: agora,
  }).eq('id', p.itemId)
  return { status: 'Concluido', descricao_status: desc, valor: cmc, id_ajuste: idMov, diferenca: delta }
}

/** Desfaz o ajuste de um item (refazer, editar, excluir). Falha real aborta: nada é apagado com o ajuste vivo. */
export async function desfazerAjuste(idMov: number, usuario: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  try {
    await estornar(idMov, usuario, 'Inventário refeito ou excluído')
    return { ok: true }
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : 'Falha ao desfazer o ajuste' }
  }
}

/** Itens do local que pertencem às curvas pedidas (A/B/C), pela rotação de saída dos últimos dias configurados. */
export async function produtosDasCurvas(lojaId: number, curvas: string[]): Promise<Set<number>> {
  const { data, error } = await createServiceClient().rpc('curva_abc', { p_loja: lojaId, p_dias: null })
  if (error) throw new Error(error.message)
  const permitidas = new Set(curvas.map((c) => c.toUpperCase()))
  return new Set(((data ?? []) as { codigo_produto: number; classe: string }[]).filter((r) => permitidas.has(r.classe)).map((r) => Number(r.codigo_produto)))
}
