// Baixa de venda do Norte Vendas em loja de estoque PROPRIO (06/10/2026). Sem Omie: item com ficha técnica gera uma OP
// (marcada com o pedido do Norte Vendas, concluída na hora) e depois sai; item sem ficha vira só uma SAIDA no ledger, no local resolvido por localDaVenda (por_produto > local escolhido no Vendas > setor >
// cozinha/bar > local padrao). Nunca bloqueia por saldo (negativo e permitido e alertado).
//
// Contrato de resposta = o mesmo que o Vendas ja consome (lib/baixaEstoque.ts do Vendas, classificarItemEstoque):
//   ok            -> { ok:true,  op:'sem_estrutura', baixa:'Concluido' }       (so a saida, como produto de revenda)
//   nao gravou    -> { ok:false, op:'pulada', baixa:'pulada', erro }            (retentavel: nada foi gravado)
//   sem local     -> { ok:false, op:'sem_estrutura', baixa:'sem local de estoque', erro }  (retentavel)
//   falha incerta -> { ok:false, op:'erro', baixa:'erro', erro }                (incerto: o gerente confere)
import type { SupabaseClient } from '@supabase/supabase-js'
import { localDaVenda, type LojaLocais } from '@/lib/vendas/local-venda'
import { planejarBaixa, type ItemVendaProprio, type ResultadoItemProprio } from './plano-baixa'
import { estornar, saida } from './ledger'

/** Executa o plano: saidas em ORDEM de codigo_produto (evita deadlock entre vendas simultaneas) e devolve na ordem original dos itens. */
export async function baixarVendaProprio(
  supabase: SupabaseClient,
  loja: { id: number } & LojaLocais,
  itens: Partial<ItemVendaProprio>[],
  pedidoRef: string | null,
  obs: string
): Promise<ResultadoItemProprio[]> {
  const codigos = Array.from(new Set(itens.map((i) => i?.codigo).filter((c): c is string => !!c)))
  const produtoPorCodigo = new Map<string, number>()
  if (codigos.length) {
    const { data } = await supabase.from('produtos').select('codigo, codigo_produto').eq('loja_id', loja.id).in('codigo', codigos)
    for (const p of (data ?? []) as { codigo: string; codigo_produto: number }[]) produtoPorCodigo.set(p.codigo, Number(p.codigo_produto))
  }
  const { data: locais } = await supabase.from('local_estoques').select('codigo_local_estoque, padrao, inativo').eq('loja_id', loja.id)
  const locaisDaLoja = new Set<number>(((locais ?? []) as { codigo_local_estoque: number }[]).map((l) => Number(l.codigo_local_estoque)))
  const padrao = ((locais ?? []) as { codigo_local_estoque: number; padrao: string | null }[]).find((l) => l.padrao === 'S')
  const plano = planejarBaixa(itens, loja, localDaVenda, produtoPorCodigo, padrao ? Number(padrao.codigo_local_estoque) : null, locaisDaLoja)

  const ref = pedidoRef ?? `sem-ref:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
  const resultados = new Array<ResultadoItemProprio>(plano.length)

  for (const p of plano) {
    if (p.pulo) resultados[p.indice] = { codigo: p.codigo, ok: false, op: p.pulo.op, baixa: p.pulo.baixa, erro: p.pulo.erro }
  }

  // Produto com ficha técnica ativa baixa os INSUMOS pela receita; sem ficha, baixa o próprio produto (como antes).
  const comReceita = new Set<number>()
  const produtosPlano = Array.from(new Set(plano.filter((p) => !p.pulo).map((p) => p.produto!)))
  if (produtosPlano.length) {
    const { data: fichas } = await supabase.from('fichas_tecnicas').select('codigo_produto').eq('loja_id', loja.id).eq('ativa', true).in('codigo_produto', produtosPlano)
    for (const f of (fichas ?? []) as { codigo_produto: number }[]) comReceita.add(Number(f.codigo_produto))
  }

  const executaveis = plano
    .filter((p) => !p.pulo)
    .sort((a, b) => (a.produto! - b.produto!) || (a.local! - b.local!) || (a.indice - b.indice))
  for (const p of executaveis) {
    try {
      if (comReceita.has(p.produto!)) {
        // Como no Omie: a venda gera uma ORDEM DE PRODUÇÃO marcada com o pedido do Norte Vendas, que é concluída na hora
        // (consome os insumos da ficha e produz o item no local da venda); depois o item vendido sai do estoque.
        const op = await opDaVenda(supabase, loja.id, p.produto!, p.quantidade, p.local!, `${ref}|${p.produto}|${p.linha}`, obs)
        const r = await saida({ lojaId: loja.id, local: p.local!, produto: p.produto!, quantidade: p.quantidade, origem: 'VENDA', ref, linha: p.linha, obs: `${obs} · OP ${op.numero}` })
        resultados[p.indice] = { codigo: p.codigo, ok: true, op: 'criada', baixa: 'Concluido', nCodOP: op.nCodOP, saldo: r.saldo, negativo: r.saldo < 0, duplicado: r.duplicado && op.existente }
        continue
      }
      const r = await saida({ lojaId: loja.id, local: p.local!, produto: p.produto!, quantidade: p.quantidade, origem: 'VENDA', ref, linha: p.linha, obs })
      resultados[p.indice] = { codigo: p.codigo, ok: true, op: 'sem_estrutura', baixa: 'Concluido', saldo: r.saldo, negativo: r.saldo < 0, duplicado: r.duplicado }
    } catch (e) {
      const erro = e instanceof Error ? e.message : 'Falha ao baixar o estoque'
      // Com pedidoRef a saida e idempotente: reenviar e seguro, entao conta como "nada gravado" (retentavel).
      resultados[p.indice] = pedidoRef
        ? { codigo: p.codigo, ok: false, op: 'pulada', baixa: 'pulada', erro }
        : { codigo: p.codigo, ok: false, op: 'erro', baixa: 'erro', erro }
    }
  }
  return resultados
}

/** OP automática da venda, idempotente pela referência (pedido|produto|linha): reenviar a venda nunca cria outra OP. */
async function opDaVenda(
  supabase: SupabaseClient, lojaId: number, produto: number, quantidade: number, local: number, vendaRef: string, obs: string
): Promise<{ nCodOP: number; numero: string; existente: boolean }> {
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const { data: existente } = await supabase.from('ordens_producao')
    .select('id, identificacao_n_cod_op, identificacao_c_num_op, concluida').eq('loja_id', lojaId).eq('venda_ref', vendaRef).maybeSingle()
  let id: number, nCodOP: number, numero: string, jaConcluida = false
  if (existente) {
    id = Number(existente.id); nCodOP = Number(existente.identificacao_n_cod_op); numero = String(existente.identificacao_c_num_op ?? nCodOP)
    jaConcluida = existente.concluida === true || existente.concluida === 'S'
  } else {
    const { data, error } = await supabase.rpc('op_proprio_criar', {
      p_loja: lojaId, p_produto: produto, p_data: hoje, p_qtde: quantidade, p_local: local, p_local_destino: local,
      p_validade: null, p_obs: `Norte Vendas · ${obs}`, p_user: 'Norte Vendas', p_venda_ref: vendaRef,
    })
    if (error) throw new Error(`OP da venda: ${error.message}`)
    const r = data as { id: number; n_cod_op: number; numero?: string }
    id = Number(r.id); nCodOP = Number(r.n_cod_op); numero = String(r.numero ?? r.n_cod_op)
    const { data: lida } = await supabase.from('ordens_producao').select('identificacao_c_num_op').eq('id', id).maybeSingle()
    if (lida?.identificacao_c_num_op) numero = String(lida.identificacao_c_num_op)
  }
  if (!jaConcluida) {
    const { error } = await supabase.rpc('op_proprio_concluir', { p_loja: lojaId, p_op: id, p_data: hoje, p_qtde: quantidade, p_user: 'Norte Vendas', p_user_uuid: null })
    if (error) throw new Error(`Conclusão da OP ${numero}: ${error.message}`)
  }
  return { nCodOP, numero, existente: !!existente }
}

export type ResultadoEstornoProprio = { ajustesExcluidos: number; opsExcluidas: number; filaCancelada: number; falhas: number; detalhes: string[] }

/** Estorno da venda inteira: devolve ao ledger cada saida VENDA do pedido (idempotente: estornar duas vezes nao devolve duas). */
export async function estornarVendaProprio(supabase: SupabaseClient, lojaId: number, pedidoRef: string): Promise<ResultadoEstornoProprio> {
  const r: ResultadoEstornoProprio = { ajustesExcluidos: 0, opsExcluidas: 0, filaCancelada: 0, falhas: 0, detalhes: [] }
  // Venda direta: ref = pedido. Venda por receita: ref = "pedido|produto|linha" (um movimento por insumo).
  const { data, error } = await supabase.from('estoque_movimentos').select('id').eq('loja_id', lojaId).eq('origem', 'VENDA').or(`ref.eq.${pedidoRef},ref.like.${pedidoRef}|*`)
  if (error) throw new Error(error.message)
  for (const m of (data ?? []) as { id: number }[]) {
    try {
      await estornar(m.id, null, `Estorno da venda ${pedidoRef}`)
      r.ajustesExcluidos++
    } catch (e) {
      r.falhas++
      r.detalhes.push(`movimento ${m.id}: ${e instanceof Error ? e.message : 'falha ao estornar'}`)
    }
  }
  // OPs automáticas da venda: reverte (devolve os insumos e tira o item produzido).
  const { data: ops } = await supabase.from('ordens_producao').select('id, identificacao_c_num_op, concluida').eq('loja_id', lojaId).like('venda_ref', `${pedidoRef}|%`)
  for (const o of (ops ?? []) as { id: number; identificacao_c_num_op: string | null; concluida: unknown }[]) {
    if (!(o.concluida === true || o.concluida === 'S')) continue
    const { error: e } = await supabase.rpc('op_proprio_reverter', { p_loja: lojaId, p_op: o.id, p_user: 'Norte Vendas (estorno)' })
    if (e) { r.falhas++; r.detalhes.push(`OP ${o.identificacao_c_num_op ?? o.id}: ${e.message}`) } else r.opsExcluidas++
  }
  return r
}
