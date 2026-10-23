import { createServiceClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { rpcTodos } from '@/lib/supabase/rpc-todos'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { labelTipoItem } from '@/lib/constants-omie'
import { coberturaKardex } from '@/lib/relatorios/cmv-loader'
import { avisoCoberturaKardex } from '@/lib/estoque/espelho-frentes'
import { periodoValorMovimento } from '@/lib/relatorios/cmv-puro'
import type { LinhaOperAuto } from '@/lib/movimentacao-operacao-auto'

type LinhaRpc = { origem: string; sentido: 'E' | 'S'; codigo_local_estoque: number; n_cod_prod: number; mes: string; inventario: boolean; qtde: number; valor: number; sem_custo: number; valor_omie?: number; ajustados?: number }

/** Custo fora do normal no Omie (migration 290): movimentos com o custo trocado pelo custo normal do produto. */
export type ForaDoNormalMov = { movimentos: number; valorOmie: number; valor: number; produtos: { produto: string; valorOmie: number; valor: number }[] }
export type ValorMovimento = { linhas: LinhaOperAuto[]; periodo: { ini: string; fim: string; cortado: boolean } | null; semCusto: number; erro: string | null; aviso: string | null; foraDoNormal: ForaDoNormalMov }

// Opção "valor do movimento" do modo Por operação (matriz N13): mesma forma de linha do modo automático
// (lib/movimentacao-operacao-auto.ts, que não muda), mas cada movimento pelo seu próprio valor (RPC 188).
export async function gerarMovimentacaoValorMovimento(lojaId: number, ini: string, fim: string, produtoBusca?: string): Promise<ValorMovimento> {
  const [modo, cobertura] = await Promise.all([modoDaLoja(lojaId), coberturaKardex(lojaId)])
  const periodo = periodoValorMovimento({ modo, kardexDesde: cobertura?.desde ?? null, kardexAte: cobertura?.ate ?? null, ini, fim })
  // D5: por que o kardex não chega ao fim pedido (espelho desligado, leitura parada) ou trecho ainda não relido.
  const aviso = modo === 'omie' ? avisoCoberturaKardex(cobertura, fim, ini) : null
  const vazio: ForaDoNormalMov = { movimentos: 0, valorOmie: 0, valor: 0, produtos: [] }
  if (!periodo) return { linhas: [], periodo: null, semCusto: 0, erro: null, aviso, foraDoNormal: vazio }
  const supabase = createServiceClient()
  let erro: string | null = null
  const [rows, prods, locs] = await Promise.all([
    // uma chamada só (migration 290); sem ela, a RPC em páginas (como antes)
    (async () => {
      const args = { p_loja_id: lojaId, p_ini: periodo.ini, p_fim: periodo.fim }
      const j = await supabase.rpc('relatorio_movimentacao_valor_mov_json', args)
      if (!j.error) return (j.data ?? []) as LinhaRpc[]
      if ((j.error as { code?: string }).code !== 'PGRST202' && !/relatorio_movimentacao_valor_mov_json/.test(j.error.message)) { erro = j.error.message; return [] as LinhaRpc[] }
      return rpcTodos<LinhaRpc>(supabase, 'relatorio_movimentacao_valor_mov', args, (e) => { erro = e.message })
    })(),
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
  const fora = { movimentos: 0, valorOmie: 0, valor: 0, porProduto: new Map<string, { produto: string; valorOmie: number; valor: number }>() }
  for (const r of rows) {
    const m = meta.get(Number(r.n_cod_prod))
    const produto = m?.descricao || m?.codigo || String(r.n_cod_prod)
    if (termo && !`${produto} ${m?.codigo ?? ''}`.toLowerCase().includes(termo)) continue
    semCusto += Number(r.sem_custo) || 0
    const aj = Number(r.ajustados) || 0
    if (aj > 0) {
      const vo = Number(r.valor_omie) || 0, v = Number(r.valor) || 0
      fora.movimentos += aj; fora.valorOmie += vo; fora.valor += v
      const p = fora.porProduto.get(produto) ?? { produto, valorOmie: 0, valor: 0 }
      p.valorOmie += vo; p.valor += v
      fora.porProduto.set(produto, p)
    }
    linhas.push({
      origem: r.origem, sentido: r.sentido, local: local.get(Number(r.codigo_local_estoque)) ?? String(r.codigo_local_estoque),
      tipo_sped: m?.tipo_item ? `${m.tipo_item}-${labelTipoItem(m.tipo_item)}` : 'N/D', familia: m?.descricao_familia || 'N/D', produto,
      mes: r.mes, inventario: r.inventario, qtde: Number(r.qtde) || 0, valor: Number(r.valor) || 0,
    })
  }
  const r2 = (n: number) => Math.round(n * 100) / 100
  const produtos = [...fora.porProduto.values()].map((p) => ({ ...p, valorOmie: r2(p.valorOmie), valor: r2(p.valor) }))
    .sort((a, b) => Math.abs(b.valorOmie - b.valor) - Math.abs(a.valorOmie - a.valor) || a.produto.localeCompare(b.produto, 'pt-BR'))
  return { linhas, periodo, semCusto, erro, aviso, foraDoNormal: { movimentos: fora.movimentos, valorOmie: r2(fora.valorOmie), valor: r2(fora.valor), produtos } }
}
