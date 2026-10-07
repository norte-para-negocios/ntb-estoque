// Baixa de venda do Norte Vendas em loja de estoque PROPRIO (06/10/2026). Sem OP e sem Omie: cada item vendido
// vira uma SAIDA no ledger, no local resolvido por localDaVenda (por_produto > local escolhido no Vendas > setor >
// cozinha/bar > local padrao). Nunca bloqueia por saldo (negativo e permitido e alertado).
//
// Contrato de resposta = o mesmo que o Vendas ja consome (lib/baixaEstoque.ts do Vendas, classificarItemEstoque):
//   ok            -> { ok:true,  op:'sem_estrutura', baixa:'Concluido' }       (so a saida, como produto de revenda)
//   nao gravou    -> { ok:false, op:'pulada', baixa:'pulada', erro }            (retentavel: nada foi gravado)
//   sem local     -> { ok:false, op:'sem_estrutura', baixa:'sem local de estoque', erro }  (retentavel)
//   falha incerta -> { ok:false, op:'erro', baixa:'erro', erro }                (incerto: o gerente confere)
import type { SupabaseClient } from '@supabase/supabase-js'
import { localDaVenda, type ItemLocal, type LojaLocais } from '@/lib/vendas/local-venda'
import { estornar, saida } from './ledger'

export type ItemVendaProprio = ItemLocal & { codigo: string; quantidade: number }

export type PlanoItem = {
  indice: number
  codigo: string
  quantidade: number
  produto?: number
  local?: number
  /** n-esima ocorrencia do mesmo (produto, local) no pedido: parte da chave de idempotencia. */
  linha: number
  pulo?: { op: 'pulada' | 'sem_estrutura'; baixa: string; erro: string }
}

export type ResultadoItemProprio = {
  codigo: string
  ok: boolean
  op: 'sem_estrutura' | 'pulada' | 'erro'
  baixa: string
  erro?: string
  saldo?: number
  negativo?: boolean
  duplicado?: boolean
}

/** Decide, sem tocar no banco, o que cada item vira. Pura: testada em scripts/testes/vendaProprio.test.ts. */
export function planejarBaixa(
  itens: Partial<ItemVendaProprio>[],
  loja: LojaLocais,
  produtoPorCodigo: Map<string, number>,
  localPadrao: number | null,
  locaisDaLoja: Set<number>
): PlanoItem[] {
  const ocorrencias = new Map<string, number>()
  return itens.map((item, indice) => {
    const codigo = item?.codigo ?? '?'
    const base = { indice, codigo, quantidade: Number(item?.quantidade) || 0, linha: 0 }
    if (!item?.codigo || !item.quantidade || item.quantidade <= 0) {
      return { ...base, pulo: { op: 'pulada', baixa: 'pulada', erro: 'Item inválido' } }
    }
    const produto = produtoPorCodigo.get(item.codigo)
    if (!produto) {
      return { ...base, pulo: { op: 'pulada', baixa: 'pulada', erro: 'Produto sem cadastro correspondente no ntb-estoque' } }
    }
    const local = localDaVenda(loja, item as ItemLocal) ?? localPadrao
    if (!local) {
      return { ...base, produto, pulo: { op: 'sem_estrutura', baixa: 'sem local de estoque', erro: 'Sem local de estoque para a saída' } }
    }
    if (!locaisDaLoja.has(Number(local))) {
      return { ...base, produto, pulo: { op: 'pulada', baixa: 'pulada', erro: `O local de estoque ${local} não existe nesta loja` } }
    }
    const chave = `${produto}|${local}`
    const n = ocorrencias.get(chave) ?? 0
    ocorrencias.set(chave, n + 1)
    return { ...base, produto, local: Number(local), linha: n }
  })
}

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
  const plano = planejarBaixa(itens, loja, produtoPorCodigo, padrao ? Number(padrao.codigo_local_estoque) : null, locaisDaLoja)

  const ref = pedidoRef ?? `sem-ref:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
  const resultados = new Array<ResultadoItemProprio>(plano.length)

  for (const p of plano) {
    if (p.pulo) resultados[p.indice] = { codigo: p.codigo, ok: false, op: p.pulo.op, baixa: p.pulo.baixa, erro: p.pulo.erro }
  }

  const executaveis = plano
    .filter((p) => !p.pulo)
    .sort((a, b) => (a.produto! - b.produto!) || (a.local! - b.local!) || (a.indice - b.indice))
  for (const p of executaveis) {
    try {
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

export type ResultadoEstornoProprio = { ajustesExcluidos: number; opsExcluidas: number; filaCancelada: number; falhas: number; detalhes: string[] }

/** Estorno da venda inteira: devolve ao ledger cada saida VENDA do pedido (idempotente: estornar duas vezes nao devolve duas). */
export async function estornarVendaProprio(supabase: SupabaseClient, lojaId: number, pedidoRef: string): Promise<ResultadoEstornoProprio> {
  const r: ResultadoEstornoProprio = { ajustesExcluidos: 0, opsExcluidas: 0, filaCancelada: 0, falhas: 0, detalhes: [] }
  const { data, error } = await supabase.from('estoque_movimentos').select('id').eq('loja_id', lojaId).eq('origem', 'VENDA').eq('ref', pedidoRef)
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
  return r
}
