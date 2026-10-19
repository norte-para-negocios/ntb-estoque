import { createServiceClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { rpcTodos } from '@/lib/supabase/rpc-todos'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { labelTipoItem } from '@/lib/constants-omie'
import { coberturaKardex } from '@/lib/relatorios/cmv-loader'
import { periodoValorMovimento } from '@/lib/relatorios/cmv-puro'
import type { LinhaOperAuto } from '@/lib/movimentacao-operacao-auto'

type LinhaRpc = { origem: string; sentido: 'E' | 'S'; codigo_local_estoque: number; n_cod_prod: number; mes: string; inventario: boolean; qtde: number; valor: number; sem_custo: number }

export type ValorMovimento = { linhas: LinhaOperAuto[]; periodo: { ini: string; fim: string; cortado: boolean } | null; semCusto: number; erro: string | null }

// Opção "valor do movimento" do modo Por operação (matriz N13): mesma forma de linha do modo automático
// (lib/movimentacao-operacao-auto.ts, que não muda), mas cada movimento pelo seu próprio valor (RPC 188).
export async function gerarMovimentacaoValorMovimento(lojaId: number, ini: string, fim: string, produtoBusca?: string): Promise<ValorMovimento> {
  const [modo, cobertura] = await Promise.all([modoDaLoja(lojaId), coberturaKardex(lojaId)])
  const periodo = periodoValorMovimento({ modo, kardexDesde: cobertura?.desde ?? null, kardexAte: cobertura?.ate ?? null, ini, fim })
  if (!periodo) return { linhas: [], periodo: null, semCusto: 0, erro: null }
  const supabase = createServiceClient()
  let erro: string | null = null
  const [rows, prods, locs] = await Promise.all([
    rpcTodos<LinhaRpc>(supabase, 'relatorio_movimentacao_valor_mov', { p_loja_id: lojaId, p_ini: periodo.ini, p_fim: periodo.fim }, (e) => { erro = e.message }),
    buscarTodasLinhas<{ codigo_produto: number; codigo: string | null; descricao: string | null; tipo_item: string | null; descricao_familia: string | null }>(
      (from, to) => supabase.from('produtos').select('codigo_produto, codigo, descricao, tipo_item, descricao_familia').eq('loja_id', lojaId).order('id').range(from, to)),
    buscarTodasLinhas<{ codigo_local_estoque: number; descricao: string | null }>(
      (from, to) => supabase.from('local_estoques').select('codigo_local_estoque, descricao').eq('loja_id', lojaId).order('id').range(from, to)),
  ])
  const meta = new Map(prods.map((p) => [Number(p.codigo_produto), p]))
  const local = new Map(locs.map((l) => [Number(l.codigo_local_estoque), l.descricao ?? String(l.codigo_local_estoque)]))
  const termo = (produtoBusca ?? '').trim().toLowerCase()
  let semCusto = 0
  const linhas: LinhaOperAuto[] = []
  for (const r of rows) {
    const m = meta.get(Number(r.n_cod_prod))
    const produto = m?.descricao || m?.codigo || String(r.n_cod_prod)
    if (termo && !`${produto} ${m?.codigo ?? ''}`.toLowerCase().includes(termo)) continue
    semCusto += Number(r.sem_custo) || 0
    linhas.push({
      origem: r.origem, sentido: r.sentido, local: local.get(Number(r.codigo_local_estoque)) ?? String(r.codigo_local_estoque),
      tipo_sped: m?.tipo_item ? `${m.tipo_item}-${labelTipoItem(m.tipo_item)}` : 'N/D', familia: m?.descricao_familia || 'N/D', produto,
      mes: r.mes, inventario: r.inventario, qtde: Number(r.qtde) || 0, valor: Number(r.valor) || 0,
    })
  }
  return { linhas, periodo, semCusto, erro }
}
