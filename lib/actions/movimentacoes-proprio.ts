'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'

import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { ROTULO_ORIGEM } from '@/lib/estoque/kardex'
import { urlVendaNoVendas } from '@/lib/estoque/link-vendas'

export type DetalheKardex =
  | { error: string }
  | {
      ok: true
      movimento: {
        id: number; quando: string; data_ref: string; tipo: string; origem: string; ref: string; quantidade: number; custo: number | null
        saldo_apos: number; saldo_total_apos: number; cmc_apos: number | null; user_id: string | null; user_nome: string | null; obs: string | null
        produto: string; codigo: string | null; unidade: string | null; local: string | null; custo_estimado: boolean
      }
      documento: { rotulo: string; descricao: string; href?: string; externo?: boolean; hrefSecundario?: string; rotuloSecundario?: string; linhas?: { rotulo: string; valor: string }[] } | null
      vinculados: { id: number; rotulo: string; quantidade: number; local: string | null; quando: string; produto: string }[]
    }

/** Detalhe de um movimento: documento de origem (OP, NF/compra, inventário, venda, transferência) e movimentos ligados (estorno, pernas). */
export async function detalheMovimentoProprio(id: number): Promise<DetalheKardex> {
  const __d = viaDesktop('movimentacoes-proprio#detalheMovimentoProprio', detalheMovimentoProprio, [id]); if (__d) return __d as never
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Movimentacoes'))) return { error: 'Sem permissão' }
  if ((await modoDaLoja(lojaId)) !== 'proprio') return { error: 'Esta loja não usa o estoque próprio.' }
  const sb = createServiceClient()
  const { data: m } = await sb.from('estoque_movimentos').select('*').eq('id', id).eq('loja_id', lojaId).maybeSingle()
  if (!m) return { error: 'Movimento não encontrado' }

  const [{ data: pr }, { data: lc }] = await Promise.all([
    sb.from('produtos').select('codigo, descricao, unidade').eq('loja_id', lojaId).eq('codigo_produto', m.codigo_produto).maybeSingle(),
    sb.from('local_estoques').select('descricao').eq('loja_id', lojaId).eq('codigo_local_estoque', m.codigo_local_estoque).maybeSingle(),
  ])
  const nomeLocal = async (cod: number) => (await sb.from('local_estoques').select('descricao').eq('loja_id', lojaId).eq('codigo_local_estoque', cod).maybeSingle()).data?.descricao ?? String(cod)
  const nomeProduto = async (cod: number) => (await sb.from('produtos').select('descricao').eq('loja_id', lojaId).eq('codigo_produto', cod).maybeSingle()).data?.descricao ?? String(cod)

  let documento: { rotulo: string; descricao: string; href?: string; externo?: boolean; hrefSecundario?: string; rotuloSecundario?: string; linhas?: { rotulo: string; valor: string }[] } | null = null
  const ref = String(m.ref)
  try {
    if (m.origem === 'VENDA') {
      const pedido = ref.split('|')[0]
      const filtroKardex = `/movimentacoes?aba=movimentos&og=VENDA&data_inicio=2000-01-01&data_final=2100-12-31&produto=${encodeURIComponent(pedido)}`
      const urlVenda = urlVendaNoVendas(ref)
      documento = {
        rotulo: 'Venda', descricao: `Pedido ${pedido}`,
        // Abre a venda no Norte Vendas (nova aba); o filtro do histórico de movimentos fica como opção secundária.
        href: urlVenda ?? filtroKardex, externo: !!urlVenda,
        hrefSecundario: urlVenda ? filtroKardex : undefined, rotuloSecundario: urlVenda ? 'Ver as baixas desta venda' : undefined,
        linhas: ref.includes('|') ? [{ rotulo: 'Baixa por receita', valor: 'insumo do prato vendido' }] : undefined,
      }
    } else if (m.origem === 'COMPRA') {
      const { data: c } = await sb.from('compras_proprio').select('id, numero, serie, fornecedor_nome, chave_acesso, emissao, origem')
        .eq('loja_id', lojaId).or(`chave_acesso.eq.${ref},id.eq.${ref.startsWith('compra:') ? Number(ref.slice(7)) || 0 : 0}`).maybeSingle()
      if (c) documento = {
        rotulo: c.origem === 'xml' ? 'Nota fiscal de entrada' : 'Compra lançada à mão', descricao: `${c.fornecedor_nome ?? 'Fornecedor'} · nº ${c.numero ?? '-'}${c.serie ? '/' + c.serie : ''}`,
        href: `/compras/${c.id}`, linhas: c.chave_acesso ? [{ rotulo: 'Chave de acesso', valor: c.chave_acesso }] : undefined,
      }
    } else if (m.origem === 'PRODUCAO') {
      const { data: op } = await sb.from('ordens_producao_proprio').select('id, ref, quantidade, custo_total, custo_unitario, status, codigo_produto').eq('loja_id', lojaId).eq('ref', ref).maybeSingle()
      const opId = /^OP:(\d+):/.exec(ref)?.[1]
      // A OP automática de uma venda estornada é excluída (como no Omie): sem link para não abrir uma página inexistente.
      const { data: opViva } = opId
        ? await sb.from('ordens_producao').select('id, identificacao_c_num_op').eq('loja_id', lojaId).eq('id', Number(opId)).maybeSingle()
        : { data: null }
      if (op) documento = {
        rotulo: 'Ordem de produção', descricao: `${await nomeProduto(Number(op.codigo_produto))} · ${op.quantidade}`,
        href: opViva ? `/ordem-producao/${opId}` : undefined,
        linhas: [
          { rotulo: 'Custo do lote', valor: Number(op.custo_total).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) },
          { rotulo: 'Situação', valor: opViva ? String(op.status) : 'OP excluída (venda estornada ou exclusão manual)' },
        ],
      }
    } else if (m.origem === 'INVENTARIO') {
      const itemId = Number(ref.split(':')[1])
      if (itemId) {
        const { data: it } = await sb.from('inventario_items').select('inventario_id, motivo, quan').eq('id', itemId).eq('loja_id', lojaId).maybeSingle()
        if (it) documento = {
          rotulo: 'Inventário', descricao: `Inventário #${it.inventario_id} · contado ${it.quan}`, href: `/inventario/${it.inventario_id}/contagem`,
          linhas: it.motivo ? [{ rotulo: 'Motivo', valor: String(it.motivo) }] : undefined,
        }
      }
    } else if (m.origem === 'TRANSFERENCIA') {
      const movId = Number(/^trf:(\d+):/.exec(String(m.transferencia_ref ?? ref))?.[1] ?? 0)
      const { data: tm } = movId
        ? await sb.from('movimentos').select('transferencia_id').eq('loja_id', lojaId).eq('id', movId).maybeSingle()
        : { data: null }
      const tid = (tm as { transferencia_id?: number | null } | null)?.transferencia_id
      documento = {
        rotulo: 'Transferência entre locais', descricao: tid ? `Transferência #${tid}` : `Transferência ${m.transferencia_ref ?? ref}`,
        href: tid ? `/transferencia/${tid}/contagem` : undefined,
      }
    } else if (m.origem === 'SALDO_INICIAL' || m.origem === 'MANUAL') {
      documento = { rotulo: ROTULO_ORIGEM[m.origem] ?? m.origem, descricao: m.obs ?? ref }
    }
  } catch { /* o detalhe nunca quebra por causa do documento de origem */ }

  // Movimentos ligados: estorno (e o original), pernas da transferência.
  const ids = new Set<number>()
  const vinc: { id: number; rotulo: string }[] = []
  if (m.reverses_id) { ids.add(Number(m.reverses_id)); vinc.push({ id: Number(m.reverses_id), rotulo: 'Movimento estornado por este' }) }
  const { data: est } = await sb.from('estoque_movimentos').select('id').eq('loja_id', lojaId).eq('reverses_id', m.id)
  for (const e of est ?? []) { ids.add(Number(e.id)); vinc.push({ id: Number(e.id), rotulo: 'Estornado por' }) }
  if (m.transferencia_ref) {
    const { data: pernas } = await sb.from('estoque_movimentos').select('id').eq('loja_id', lojaId).eq('transferencia_ref', m.transferencia_ref).neq('id', m.id)
    for (const p of pernas ?? []) if (!ids.has(Number(p.id))) { ids.add(Number(p.id)); vinc.push({ id: Number(p.id), rotulo: 'Outra perna da transferência' }) }
  }
  const vinculados: { id: number; rotulo: string; quantidade: number; local: string | null; quando: string; produto: string }[] = []
  if (ids.size) {
    const { data: rel } = await sb.from('estoque_movimentos').select('id, quantidade, codigo_local_estoque, codigo_produto, created_at').eq('loja_id', lojaId).in('id', [...ids])
    for (const r of rel ?? []) {
      vinculados.push({
        id: Number(r.id), rotulo: vinc.find((v) => v.id === Number(r.id))?.rotulo ?? 'Ligado', quantidade: Number(r.quantidade),
        local: await nomeLocal(Number(r.codigo_local_estoque)), quando: r.created_at, produto: await nomeProduto(Number(r.codigo_produto)),
      })
    }
  }

  // Quem lançou: movimento grava o id do usuário (ou um nome, nas rotinas automáticas como "Norte Vendas").
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  let userNome: string | null = m.user_id && !UUID.test(String(m.user_id)) ? String(m.user_id) : null
  if (m.user_id && UUID.test(String(m.user_id))) {
    const { data: pf } = await sb.from('profiles').select('name').eq('id', m.user_id).maybeSingle()
    userNome = pf?.name ?? 'Usuário removido'
  }

  return {
    ok: true,
    movimento: {
      id: Number(m.id), quando: m.created_at, data_ref: m.data_ref, tipo: m.tipo, origem: m.origem, ref, quantidade: Number(m.quantidade),
      custo: m.custo_unitario == null ? null : Number(m.custo_unitario), saldo_apos: Number(m.saldo_apos), saldo_total_apos: Number(m.saldo_total_apos),
      cmc_apos: m.cmc_apos == null ? null : Number(m.cmc_apos), user_id: m.user_id, user_nome: userNome, obs: m.obs, produto: pr?.descricao ?? String(m.codigo_produto),
      codigo: pr?.codigo ?? null, unidade: pr?.unidade ?? null, local: lc?.descricao ?? null, custo_estimado: !!m.custo_estimado,
    },
    documento,
    vinculados,
  }
}
