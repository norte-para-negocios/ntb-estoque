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
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { complementarOrdensProducao, limiteJanelaQuente } from '@/lib/historico-contabo'
import { labelTipoItem } from '@/lib/constants-omie'
import type { LinhaOperAuto } from './movimentacao-operacao-auto'

type OpRow = {
  // id/identificacao_n_cod_op não são usados no cálculo -- existem porque
  // complementarOrdensProducao (histórico frio no Contabo) exige os dois no
  // type bound e usa identificacao_n_cod_op como chave natural de dedupe.
  id: number
  identificacao_n_cod_op: number
  identificacao_n_cod_produto: number
  identificacao_n_qtde: number
  dt_conclusao_real: string
  produto_descricao: string | null
  concluida?: boolean | null
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

export async function gerarBaixasDeOrdemProducao(
  lojaId: number,
  dataIni: string,
  dataFim: string
): Promise<{ linhas: LinhaOperAuto[]; opsSemEstrutura: number; totalOps: number; insumosSemCusto: number }> {
  const supabase = createServiceClient()

  // buscarTodasLinhas (helper compartilhado) em vez de uma paginação local:
  // a cópia local aqui tratava QUALQUER erro (RLS, timeout, 414) como "acabou
  // a paginação", truncando o resultado em silêncio -- mesma classe de bug já
  // documentada no AGENTS.md ("as 3 cópias locais hand-rolled de
  // buscarTodasLinhas não checavam error"). Todo `.range()` vem com
  // `.order('id')` (tiebreak obrigatório, ver AGENTS.md "A lição do tiebreak
  // de paginação").
  const opsQuentes = await buscarTodasLinhas<OpRow>(
    (from, to) =>
      supabase
        .from('ordens_producao')
        .select('id, identificacao_n_cod_op, identificacao_n_cod_produto, identificacao_n_qtde, dt_conclusao_real, produto_descricao, concluida')
        .eq('loja_id', lojaId)
        .eq('concluida', true)
        .gte('dt_conclusao_real', dataIni)
        .lte('dt_conclusao_real', dataFim)
        .order('id')
        .range(from, to),
    undefined,
    (e) => console.error('baixa-op: falha ao paginar ordens_producao', e.message)
  )

  // Janela quente do Supabase = ~90 dias. O relatório mensal pede o ano
  // inteiro, então quase toda execução cruza esse corte -- sem o complemento
  // frio (Contabo), as OPs mais antigas somem em silêncio e a baixa de
  // estoque fica subestimada (mesmo padrão de lib/resumo-dia.ts e de mais 9
  // call sites deste repo).
  let ops = opsQuentes
  if (dataIni < limiteJanelaQuente()) {
    const completas = await complementarOrdensProducao(opsQuentes, {
      lojaId,
      dataInicio: dataIni,
      dataFinal: dataFim,
    })
    // O espelho frio não filtra `concluida` no servidor (só dt_conclusao_real,
    // que já implica conclusão) -- guard defensivo pra nunca contar uma OP
    // não concluída como consumo real.
    ops = completas.filter((o) => !!o.dt_conclusao_real && o.concluida !== false)
  }
  if (!ops.length) return { linhas: [], opsSemEstrutura: 0, totalOps: 0, insumosSemCusto: 0 }

  const codigosProduto = [...new Set(ops.map((o) => Number(o.identificacao_n_cod_produto)))]
  const estrutura = await buscarTodasLinhas<EstruturaRow>(
    (from, to) =>
      supabase
        .from('estrutura_produto_cache')
        .select('codigo_produto, codigo_produto_insumo, descricao_insumo, quantidade, percentual_perda, tipo_insumo')
        .eq('loja_id', lojaId)
        .in('codigo_produto', codigosProduto)
        .order('id')
        .range(from, to),
    undefined,
    (e) => console.error('baixa-op: falha ao paginar estrutura_produto_cache', e.message)
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
    const posicoes = await buscarTodasLinhas<PosicaoRow>(
      (from, to) =>
        supabase
          .from('posicao_estoques')
          .select('n_cod_prod, n_cmc, n_saldo')
          .eq('loja_id', lojaId)
          .eq('data_posicao', dataPosicao)
          .gt('n_saldo', 0)
          .order('id')
          .range(from, to),
      undefined,
      (e) => console.error('baixa-op: falha ao paginar posicao_estoques', e.message)
    )
    const acumPorCod = new Map<number, { somaValor: number; somaSaldo: number }>()
    for (const p of posicoes) {
      if (!(Number(p.n_cmc) > 0)) continue // sem CMC nesta linha -- exclui do numerador E denominador, mesmo guard de relatorio-margem/page.tsx:303-304
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
  // Insumos consumidos que ficaram FORA do valor por não terem CMC conhecido
  // (estoque zerado na foto atual, produto sem custo cadastrado no Omie...).
  // Sem esse contador, a exclusão era invisível pro usuário de negócio -- o
  // mesmo filtro já removia ~85% das linhas em algumas lojas no relatório de
  // Margem (ver AGENTS.md, "Magnitude subestimada em ~10x"). Contado por
  // insumo DISTINTO (não por evento de consumo): é o número que o leitor do
  // slide consegue acionar ("N insumos precisam de custo no Omie").
  const insumosSemCustoSet = new Set<number>()
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
      if (cmc <= 0) {
        // sem custo conhecido, não dá pra valorizar -- fica de fora (não vira
        // R$0 enganoso), mas agora conta pro aviso do relatório
        insumosSemCustoSet.add(Number(item.codigo_produto_insumo))
        continue
      }
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

  return { linhas, opsSemEstrutura, totalOps: ops.length, insumosSemCusto: insumosSemCustoSet.size }
}
