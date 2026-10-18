import { createServiceClient } from '@/lib/supabase/server'
import { buscarTodosPorIds } from '@/lib/utils-busca'
import type { MemoriaItem } from './nf-item-regras'

// Memória da entrada (Fase B, R1/R5/R6): as últimas marcações, CFOP de entrada e local confirmados de cada produto e de cada
// código do fornecedor (RPC memoria_itens_compra, migration 185). Sem resultado ou com erro = mapas vazios: nunca derruba a nota.

export async function carregarMemoria(lojaId: number, cnpj: string | null, produtos: number[], cProds: string[]): Promise<{ porProduto: Map<number, MemoriaItem>; porCodigoFornecedor: Map<string, MemoriaItem> }> {
  const porProduto = new Map<number, MemoriaItem>()
  const porCodigoFornecedor = new Map<string, MemoriaItem>()
  if (!produtos.length && !cProds.length) return { porProduto, porCodigoFornecedor }
  try {
    const { data, error } = await createServiceClient().rpc('memoria_itens_compra', {
      p_loja: lojaId, p_cnpj: cnpj ? cnpj.replace(/\D/g, '') : null, p_produtos: [...new Set(produtos)], p_cprods: [...new Set(cProds.filter(Boolean))],
    })
    if (error) { console.error(`nf-memoria loja ${lojaId}: ${error.message}`); return { porProduto, porCodigoFornecedor } }
    for (const r of (data ?? []) as { tipo: string; chave: string; flags: string | null; cfop_entrada: string | null; codigo_local_estoque: number | string | null }[]) {
      const m: MemoriaItem = { flags: r.flags, cfopEntrada: r.cfop_entrada, codigoLocal: r.codigo_local_estoque != null ? Number(r.codigo_local_estoque) : null }
      if (r.tipo === 'produto') porProduto.set(Number(r.chave), m)
      else if (r.tipo === 'fornecedor') porCodigoFornecedor.set(r.chave, m)
    }
  } catch (e) {
    console.error(`nf-memoria loja ${lojaId}:`, e instanceof Error ? e.message : e)
  }
  return { porProduto, porCodigoFornecedor }
}

/** Custo médio atual de cada produto (estoque_custos), para o aviso "custo fora do normal". */
export async function carregarCmc(lojaId: number, produtos: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>()
  const ids = [...new Set(produtos)]
  if (!ids.length) return out
  try {
    const sb = createServiceClient()
    const linhas = await buscarTodosPorIds<{ codigo_produto: number | string; cmc: number | string }>(ids, (lote, from, to) =>
      sb.from('estoque_custos').select('codigo_produto, cmc').eq('loja_id', lojaId).in('codigo_produto', lote).order('codigo_produto').range(from, to))
    for (const l of linhas) out.set(Number(l.codigo_produto), Number(l.cmc) || 0)
  } catch (e) {
    console.error(`nf-memoria loja ${lojaId}: custo médio`, e instanceof Error ? e.message : e)
  }
  return out
}
