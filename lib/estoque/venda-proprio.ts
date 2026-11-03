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
import { exigirLeitura, todosPulados } from './venda-proprio-leituras'

/** Executa o plano: saidas em ORDEM de codigo_produto (evita deadlock entre vendas simultaneas) e devolve na ordem original dos itens. */
export async function baixarVendaProprio(
  supabase: SupabaseClient,
  loja: { id: number } & LojaLocais,
  itens: Partial<ItemVendaProprio>[],
  pedidoRef: string | null,
  obs: string
): Promise<ResultadoItemProprio[]> {
  // Sem referência do pedido não há idempotência: um retry baixaria de novo. O Norte Vendas sempre manda pedidoRef
  // (lib/baixaEstoqueServidor.ts, pedidoRef = id do pedido); sem ele, nada é gravado e a venda volta retentável.
  if (!pedidoRef) return todosPulados(itens, 'Venda sem referência do pedido')

  // As 3 leituras decidem o caminho (sem cadastro / local / receita): erro em qualquer uma devolve a venda INTEIRA
  // retentável, sem gravar nada (antes, erro virava lista vazia e o prato saía sem consumir os insumos).
  const codigos = Array.from(new Set(itens.map((i) => i?.codigo).filter((c): c is string => !!c)))
  const produtoPorCodigo = new Map<string, number>()
  const servicos = new Set<string>()
  let plano: ReturnType<typeof planejarBaixa>
  const comReceita = new Set<number>()
  try {
    if (codigos.length) {
      const prods = exigirLeitura(
        await supabase.from('produtos').select('codigo, codigo_produto, tipo_item').eq('loja_id', loja.id).in('codigo', codigos),
        'produtos'
      ) as { codigo: string; codigo_produto: number; tipo_item: string | null }[]
      for (const p of prods) {
        produtoPorCodigo.set(p.codigo, Number(p.codigo_produto))
        if (p.tipo_item === '09') servicos.add(p.codigo)
      }
    }
    const locais = exigirLeitura(
      await supabase.from('local_estoques').select('codigo_local_estoque, padrao, inativo').eq('loja_id', loja.id),
      'locais de estoque'
    ) as { codigo_local_estoque: number; padrao: string | null }[]
    const locaisDaLoja = new Set<number>(locais.map((l) => Number(l.codigo_local_estoque)))
    const padrao = locais.find((l) => l.padrao === 'S')
    plano = planejarBaixa(itens, loja, localDaVenda, produtoPorCodigo, padrao ? Number(padrao.codigo_local_estoque) : null, locaisDaLoja, servicos)

    // Produto com ficha técnica ativa baixa os INSUMOS pela receita; sem ficha, baixa o próprio produto (como antes).
    const produtosPlano = Array.from(new Set(plano.filter((p) => !p.pulo && !p.servico).map((p) => p.produto!)))
    if (produtosPlano.length) {
      const fichas = exigirLeitura(
        await supabase.from('fichas_tecnicas').select('codigo_produto').eq('loja_id', loja.id).eq('ativa', true).in('codigo_produto', produtosPlano),
        'fichas técnicas'
      ) as { codigo_produto: number }[]
      for (const f of fichas) comReceita.add(Number(f.codigo_produto))
    }
  } catch (e) {
    return todosPulados(itens, e instanceof Error ? e.message : 'Falha ao ler o cadastro')
  }

  const ref = pedidoRef
  const resultados = new Array<ResultadoItemProprio>(plano.length)

  for (const p of plano) {
    if (p.pulo) resultados[p.indice] = { codigo: p.codigo, ok: false, op: p.pulo.op, baixa: p.pulo.baixa, erro: p.pulo.erro }
    // Taxa de serviço e outros serviços: ok sem tocar no estoque.
    else if (p.servico) resultados[p.indice] = { codigo: p.codigo, ok: true, op: 'sem_estrutura', baixa: 'Concluido' }
  }

  const executaveis = plano
    .filter((p) => !p.pulo && !p.servico)
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
      // Com pedidoRef (sempre, ver acima) a saida e idempotente: reenviar e seguro, entao conta como "nada gravado" (retentavel).
      resultados[p.indice] = { codigo: p.codigo, ok: false, op: 'pulada', baixa: 'pulada', erro }
    }
  }
  return resultados
}

/** OP automática da venda, idempotente pela referência (pedido|produto|linha): reenviar a venda nunca cria outra OP. */
async function opDaVenda(
  supabase: SupabaseClient, lojaId: number, produto: number, quantidade: number, local: number, vendaRef: string, obs: string
): Promise<{ nCodOP: number; numero: string; existente: boolean }> {
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const { data: existente, error: erroExistente } = await supabase.from('ordens_producao')
    .select('id, identificacao_n_cod_op, identificacao_c_num_op, concluida').eq('loja_id', lojaId).eq('venda_ref', vendaRef).maybeSingle()
  // Sem saber se a OP já existe, criar outra seria arriscar OP dupla: falha alto (o item volta retentável).
  if (erroExistente) throw new Error(`Falha ao ler a OP da venda: ${erroExistente.message}`)
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
    // Só o número de exibição: se a leitura falhar, fica o n_cod_op devolvido pela RPC.
    const { data: lida, error: erroLida } = await supabase.from('ordens_producao').select('identificacao_c_num_op').eq('id', id).maybeSingle()
    if (!erroLida && lida?.identificacao_c_num_op) numero = String(lida.identificacao_c_num_op)
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
  // OPs automáticas da venda: como no Omie, o estorno EXCLUI a OP (op_proprio_excluir reverte a conclusão,
  // devolvendo os insumos e tirando o item produzido, e apaga a OP; a trilha fica em op_historico). Reverter
  // sem excluir deixava a OP "Pendente" na lista, como se ainda houvesse algo a produzir.
  const { data: ops, error: erroOps } = await supabase.from('ordens_producao').select('id, identificacao_c_num_op').eq('loja_id', lojaId).like('venda_ref', `${pedidoRef}|%`)
  if (erroOps) { r.falhas++; r.detalhes.push(`OPs da venda: Falha ao ler: ${erroOps.message}`) }
  for (const o of (ops ?? []) as { id: number; identificacao_c_num_op: string | null }[]) {
    const { error: e } = await supabase.rpc('op_proprio_excluir', { p_loja: lojaId, p_op: o.id, p_user: 'Norte Vendas (estorno)' })
    if (e) { r.falhas++; r.detalhes.push(`OP ${o.identificacao_c_num_op ?? o.id}: ${e.message}`) } else r.opsExcluidas++
  }
  return r
}
