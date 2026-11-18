// F-04 (ODARA): venda fechada (vendas_proprio) sem a baixa do estoque. Causa lida na cópia local: a chamada de baixa do Norte
// Vendas (POST /api/integracao/ordem-producao) nunca chegou ao ERP nessas vendas (nenhuma linha em venda_integracao_pedidos e nenhuma
// saída VENDA no ledger), mas o fechamento (POST /api/integracao/venda/fechamento) chegou. Resultado: custo zero, CMV menor e lucro
// maior que o real. Aqui o ERP completa a baixa a partir dos itens do próprio fechamento, pelo mesmo caminho da baixa normal
// (baixarVendaProprio: idempotente por pedido+linha, nunca bloqueia por saldo). Só mexe em venda com mais de 10 minutos (o Vendas
// desiste de esperar a baixa em 150 s; uma baixa em andamento já tem a linha de registro, que esta rotina respeita).
import type { SupabaseClient } from '@supabase/supabase-js'
import type { LojaLocais } from '@/lib/vendas/local-venda'
import { baixarVendaProprio } from './venda-proprio'
import { exigirLeitura } from './venda-proprio-leituras'
import { itensDaBaixaDoFechamento, localMaisUsado, emLotes, inicioDaJanela, JANELA_DIAS, type ItemFechado } from './baixa-do-fechamento-puro'

export type ResumoBaixasPerdidas = { vendasSemBaixa: number; completadas: number; falhas: number; itensSemCodigo: number; detalhes: string[]; janelaDias: number; examinadas: number }

const IDADE_MIN_MS = 10 * 60 * 1000
const PAGINA = 300
// A janela (JANELA_DIAS, 30) e o lote de consulta (LOTE_MAX_REFS, 50) vêm do módulo puro. Venda sem registro e sem saída é baixada UMA vez
// (o registro em venda_integracao_pedidos é inserido antes e barra a segunda); `examinadas` e `vendasSemBaixa` vão para o cron, para
// ver na resposta se a janela maior pegou muita venda de uma vez.

export async function completarBaixasPerdidas(supabase: SupabaseClient, lojaId: number, opts: { agora?: Date; limite?: number } = {}): Promise<ResumoBaixasPerdidas> {
  const r: ResumoBaixasPerdidas = { vendasSemBaixa: 0, completadas: 0, falhas: 0, itensSemCodigo: 0, detalhes: [], janelaDias: JANELA_DIAS, examinadas: 0 }
  const agora = opts.agora ?? new Date()
  const { data: loja } = await supabase.from('lojas')
    .select('id, modo_estoque, local_estoque_cozinha_codigo, local_estoque_bar_codigo, local_estoque_por_setor, local_estoque_por_produto')
    .eq('id', lojaId).maybeSingle<{ id: number; modo_estoque: string | null } & LojaLocais>()
  if (!loja || loja.modo_estoque !== 'proprio') return r

  // Lê a janela inteira em páginas de 300 (mais novas primeiro), até o teto `limite`. Antes lia só as 300 mais novas e as
  // mais antigas da janela nunca eram examinadas (o aviso dizia "próximo disparo", mas o próximo pegava as mesmas 300).
  const teto = opts.limite ?? 3000
  const vendas: { id: number; pedido_ref: string }[] = []
  for (let de = 0; de < teto; de += PAGINA) {
    const pagina = exigirLeitura(
      await supabase.from('vendas_proprio').select('id, pedido_ref').eq('loja_id', lojaId).eq('cancelado', false).eq('devolvido', false)
        .lte('created_at', new Date(agora.getTime() - IDADE_MIN_MS).toISOString()).gte('created_at', inicioDaJanela(agora).toISOString())
        .order('id', { ascending: false }).range(de, Math.min(de + PAGINA, teto) - 1),
      'vendas fechadas') as { id: number; pedido_ref: string }[]
    vendas.push(...pagina)
    if (pagina.length < PAGINA) break
  }
  if (!vendas.length) return r
  r.examinadas = vendas.length
  if (vendas.length >= teto) r.detalhes.push(`atenção: ${vendas.length} vendas na janela de ${JANELA_DIAS} dias bateram o teto; as mais antigas não foram examinadas`)
  const refs = vendas.map((v) => v.pedido_ref)

  const comRegistro = new Set<string>()
  const comMovimento = new Set<string>()
  for (const lote of emLotes(refs)) {
    const [reg, movs] = await Promise.all([
      supabase.from('venda_integracao_pedidos').select('pedido_ref').eq('loja_id', lojaId).in('pedido_ref', lote.map((x) => x.toLowerCase())),
      supabase.from('estoque_movimentos').select('ref').eq('loja_id', lojaId).eq('origem', 'VENDA').in('ref', lote),
    ])
    for (const x of exigirLeitura(reg, 'registro dos pedidos') as { pedido_ref: string }[]) comRegistro.add(x.pedido_ref)
    for (const x of exigirLeitura(movs, 'saídas de venda') as { ref: string }[]) comMovimento.add(x.ref)
  }
  const faltando = vendas.filter((v) => !comRegistro.has(v.pedido_ref.toLowerCase()) && !comMovimento.has(v.pedido_ref))
  if (!faltando.length) return r

  for (const v of faltando) {
    try {
      const itens = exigirLeitura(
        await supabase.from('vendas_proprio_itens').select('codigo, codigo_produto, componentes, quantidade').eq('venda_id', v.id).order('linha'),
        'itens da venda') as ItemFechado[]
      if (!itens.length) continue
      r.vendasSemBaixa++
      const comps = Array.from(new Set(itens.flatMap((i) => (i.componentes ?? []).map(Number))))
      const prodIds = Array.from(new Set([...comps, ...itens.map((i) => Number(i.codigo_produto)).filter(Number.isFinite)]))
      const prods: { codigo: string; codigo_produto: number }[] = []
      for (const lote of emLotes(prodIds)) {
        prods.push(...exigirLeitura(await supabase.from('produtos').select('codigo, codigo_produto').eq('loja_id', lojaId).in('codigo_produto', lote), 'produtos') as { codigo: string; codigo_produto: number }[])
      }
      const codigoDoProduto = new Map(prods.map((p) => [Number(p.codigo_produto), p.codigo]))
      const hist: { codigo_produto: number; codigo_local_estoque: number }[] = []
      for (const lote of emLotes(prodIds)) {
        hist.push(...exigirLeitura(await supabase.from('estoque_movimentos').select('codigo_produto, codigo_local_estoque').eq('loja_id', lojaId).eq('origem', 'VENDA')
          .in('codigo_produto', lote).order('id', { ascending: false }).limit(3000), 'locais de saída') as { codigo_produto: number; codigo_local_estoque: number }[])
      }
      const plano = itensDaBaixaDoFechamento(itens, codigoDoProduto, localMaisUsado(hist))
      r.itensSemCodigo += plano.semCodigo
      if (!plano.itens.length) { r.detalhes.push(`venda ${v.id}: nenhum item com código para baixar`); continue }

      const { data: regRow, error: regErr } = await supabase.from('venda_integracao_pedidos')
        .insert({ loja_id: lojaId, pedido_ref: v.pedido_ref.toLowerCase(), itens: plano.itens.map((i) => i.codigo), modo: 'proprio' }).select('id').single<{ id: number }>()
      if (regErr || !regRow) { r.falhas++; r.detalhes.push(`venda ${v.id}: não registrou o pedido (${regErr?.message ?? 'sem retorno'})`); continue }
      const resultados = await baixarVendaProprio(supabase, loja, plano.itens, v.pedido_ref, `Venda ntb-vendas #${v.pedido_ref} (baixa completada pelo fechamento)`)
      await supabase.from('venda_integracao_pedidos').update({ concluido_em: new Date().toISOString(), resultados }).eq('id', regRow.id)
      const ruins = resultados.filter((x) => !x.ok).length
      if (ruins) { r.falhas++; r.detalhes.push(`venda ${v.id}: ${ruins} item(ns) não baixaram (${resultados.find((x) => !x.ok)?.erro ?? ''})`) } else r.completadas++
    } catch (e) {
      r.falhas++
      r.detalhes.push(`venda ${v.id}: ${e instanceof Error ? e.message : 'falha'}`)
    }
  }
  return r
}
