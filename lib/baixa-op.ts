// Reconstrói a baixa de estoque por CONSUMO DE ORDEM DE PRODUÇÃO -- gap
// documentado desde sempre em lib/movimentacao-operacao-auto.ts ("Consumo/
// Entrada de Ordem de Produção -- precisa de investigação separada...
// Fora do escopo por enquanto"). Cruza OPs concluídas com a ficha técnica
// em cache (estrutura_produto_cache, populada por
// app/api/sync/estrutura-produto/route.ts) e valoriza pelo CMC mais
// recente (posicao_estoques -- só existe o snapshot atual, não há CMC
// histórico por data de OP; consumo de meses passados é valorizado ao
// custo ATUAL, aproximação conhecida, ver plano
// docs/superpowers/plans/2026-08-19-baixa-estoque-ordem-producao.md).
import { createServiceClient } from '@/lib/supabase/server'
import { labelTipoItem } from '@/lib/constants-omie'
import type { LinhaOperAuto } from './movimentacao-operacao-auto'

type OpRow = {
  identificacao_n_cod_produto: number
  identificacao_n_qtde: number
  dt_conclusao_real: string
  produto_descricao: string | null
}
type EstruturaRow = {
  codigo_produto: number
  codigo_produto_insumo: number
  descricao_insumo: string | null
  quantidade: number
  percentual_perda: number
  tipo_insumo: string | null
}
type PosicaoRow = { n_cod_prod: number; n_cmc: number; n_saldo: number }

async function paginarTodos<T>(
  montar: (from: number, to: number) => PromiseLike<{ data: T[] | null }>
): Promise<T[]> {
  const PAGE = 1000
  const todos: T[] = []
  for (let p = 0; ; p++) {
    const { data } = await montar(p * PAGE, p * PAGE + PAGE - 1)
    if (!data?.length) break
    todos.push(...data)
    if (data.length < PAGE) break
  }
  return todos
}

export async function gerarBaixasDeOrdemProducao(
  lojaId: number,
  dataIni: string,
  dataFim: string
): Promise<{ linhas: LinhaOperAuto[]; opsSemEstrutura: number; totalOps: number }> {
  const supabase = createServiceClient()

  const ops = await paginarTodos<OpRow>((from, to) =>
    supabase
      .from('ordens_producao')
      .select('identificacao_n_cod_produto, identificacao_n_qtde, dt_conclusao_real, produto_descricao')
      .eq('loja_id', lojaId)
      .eq('concluida', true)
      .gte('dt_conclusao_real', dataIni)
      .lte('dt_conclusao_real', dataFim)
      .order('id')
      .range(from, to)
  )
  if (!ops.length) return { linhas: [], opsSemEstrutura: 0, totalOps: 0 }

  const codigosProduto = [...new Set(ops.map((o) => Number(o.identificacao_n_cod_produto)))]
  const estrutura = await paginarTodos<EstruturaRow>((from, to) =>
    supabase
      .from('estrutura_produto_cache')
      .select('codigo_produto, codigo_produto_insumo, descricao_insumo, quantidade, percentual_perda, tipo_insumo')
      .eq('loja_id', lojaId)
      .in('codigo_produto', codigosProduto)
      .order('id')
      .range(from, to)
  )
  const estruturaPorProduto = new Map<number, EstruturaRow[]>()
  for (const e of estrutura) {
    const lista = estruturaPorProduto.get(e.codigo_produto) ?? []
    lista.push(e)
    estruturaPorProduto.set(e.codigo_produto, lista)
  }

  // CMC mais recente por insumo -- mesmo padrão ponderado por saldo entre
  // locais já usado em app/(app)/relatorio-margem/page.tsx (evita pegar só
  // o maior valor entre locais, bug já corrigido lá na migration 082).
  const { data: fotoRow } = await supabase
    .from('posicao_estoques')
    .select('data_posicao')
    .eq('loja_id', lojaId)
    .order('data_posicao', { ascending: false })
    .limit(1)
    .single()
  const dataPosicao = (fotoRow as { data_posicao: string } | null)?.data_posicao ?? null
  const cmcPorInsumo = new Map<number, number>()
  if (dataPosicao) {
    const posicoes = await paginarTodos<PosicaoRow>((from, to) =>
      supabase
        .from('posicao_estoques')
        .select('n_cod_prod, n_cmc, n_saldo')
        .eq('loja_id', lojaId)
        .eq('data_posicao', dataPosicao)
        .gt('n_saldo', 0)
        .order('id')
        .range(from, to)
    )
    const acumPorCod = new Map<number, { somaValor: number; somaSaldo: number }>()
    for (const p of posicoes) {
      const acc = acumPorCod.get(p.n_cod_prod) ?? { somaValor: 0, somaSaldo: 0 }
      acc.somaValor += Number(p.n_cmc) * Number(p.n_saldo)
      acc.somaSaldo += Number(p.n_saldo)
      acumPorCod.set(p.n_cod_prod, acc)
    }
    for (const [cod, acc] of acumPorCod) {
      if (acc.somaSaldo > 0) cmcPorInsumo.set(cod, acc.somaValor / acc.somaSaldo)
    }
  }

  const linhas: LinhaOperAuto[] = []
  let opsSemEstrutura = 0
  for (const op of ops) {
    const codigoProduto = Number(op.identificacao_n_cod_produto)
    const itensEstrutura = estruturaPorProduto.get(codigoProduto)
    if (!itensEstrutura?.length) {
      opsSemEstrutura++
      continue
    }
    const qtdeProduzida = Number(op.identificacao_n_qtde)
    const mes = op.dt_conclusao_real.slice(0, 7)
    for (const item of itensEstrutura) {
      const qtdeConsumida = qtdeProduzida * Number(item.quantidade) * (1 + Number(item.percentual_perda) / 100)
      const cmc = cmcPorInsumo.get(item.codigo_produto_insumo) ?? 0
      if (cmc <= 0) continue // sem custo conhecido, não dá pra valorizar -- fica de fora, não vira R$0 enganoso
      linhas.push({
        origem: 'Consumo de Ordem de Produção',
        sentido: 'S',
        local: 'N/D',
        tipo_sped: item.tipo_insumo ? `${item.tipo_insumo}-${labelTipoItem(item.tipo_insumo)}` : 'N/D',
        familia: 'N/D',
        produto: item.descricao_insumo || `Insumo ${item.codigo_produto_insumo}`,
        mes,
        inventario: false,
        qtde: qtdeConsumida,
        valor: qtdeConsumida * cmc,
      })
    }
  }

  return { linhas, opsSemEstrutura, totalOps: ops.length }
}
