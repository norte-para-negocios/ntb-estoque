// Fonte "só manual" do relatório de Movimentação (item #10 da reunião
// 2026-08-03 com o Ramon: "o relatório atual mistura vendas (PDV) e compras
// com movimento manual -- quer que mostre SÓ movimento manual de estoque").
//
// Achado real desta task (investigação, ver task-6-report.md): a hipótese do
// plano ("a tabela `movimentos` já é só ajuste manual, sem venda/compra
// misturado") estava PARCIALMENTE certa. `movimentos` nunca recebe compra
// (NF de entrada é outra tabela inteira, nunca grava aqui) -- mas venda de
// PDV SIM aparece aqui, de duas formas: origem='PDV' direto (raro) e
// origem='AJU'/motivo='PDV' (a baixa de estoque que o Omie gera pra cada
// venda, majoritária -- medido ao vivo: 88-118 mil linhas por loja, R$4-5
// milhões, vs. só dezenas de linhas/algumas centenas de R$ de perda manual
// "pura", motivo='PER'). A distinção, porém, é POSSÍVEL (ao contrário de
// `movimentos_historico`, que não tem nenhuma coluna de origem) porque
// `motivo`/`origem` sempre vêm preenchidos pelo Omie -- o mesmo filtro já
// usado em `lib/movimentacao-operacao-auto.ts` (`gerarMovimentacaoOperacaoAutomatica`,
// categoria "Movimento Manual de Estoque") resolve isso, e é reaproveitado
// aqui via `ehMovimentoManual`.
//
// `movimentos` também exclui TRF/TPQ (transferência entre locais): não é um
// "entrada/saída" de estoque líquido no sentido que o Ramon pediu -- é
// deslocamento entre locais da mesma loja, e já tem visão própria
// (Transferências).
//
// Achado real #2: ao contrário de `notas_fiscais` (Task 1 desta auditoria,
// ver lib/historico-contabo.ts), o lado quente (Supabase self-hosted) de
// `movimentos` NÃO é superset nem cobertura equivalente ao frio (Contabo) --
// medido ao vivo: loja 3 tem 33.849 linhas no Supabase contra 138.284 no
// Contabo (backfill histórico foi escrito direto no Contabo, sem passar pelo
// caminho normal de sync que alimenta o Supabase). Por isso este módulo usa
// `complementarMovimentos` (o mesmo utilitário já usado por
// `gerarMovimentacaoOperacaoAutomatica` pra essa MESMA tabela) em vez de uma
// RPC pura no Postgres do Supabase -- uma RPC só veria o lado quente e
// subcontaria silenciosamente qualquer período que cruze os 90 dias (a
// mesma classe de bug já corrigida váááárias vezes nesta sessão de
// auditoria, ver AGENTS.md).
import { createServiceClient } from '@/lib/supabase/server'
import { complementarMovimentos } from '@/lib/historico-contabo'

export type LinhaMovManualBruta = {
  id: number
  id_ajuste: number | null
  id_prod: number | null
  tipo: string
  quan: number | string | null
  valor: number | string | null
  codigo_local_estoque: number | null
  origem: string | null
  motivo: string | null
  data: string
}

export type MetaProdutoMovManual = { tipo: string | null; familia: string | null; descricao: string | null; codigo: string | null }

export type LinhaMovManualAgregada = { rotulo: string; mes: string; qtde: number; valor: number }

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

// Mesma definição de "manual de verdade" já usada em
// gerarMovimentacaoOperacaoAutomatica (lib/movimentacao-operacao-auto.ts) --
// não inventa um critério novo.
export function ehMovimentoManual(r: { origem: string | null; motivo: string | null; tipo: string }): boolean {
  if (r.origem === 'PDV' || r.motivo === 'PDV') return false
  if (r.tipo === 'TRF' || r.tipo === 'TPQ') return false
  return true
}

// Busca o período inteiro (quente Supabase + frio Contabo via
// complementarMovimentos), já filtrado para só movimento manual de verdade.
// dataInicio/dataFinal em 'YYYY-MM-DD'. Filtro de data feito em JS (não via
// .lte no Postgres) porque `data` é timestamptz -- comparar contra uma data
// pura no servidor cortaria o próprio dia final às 00:00 (mesmo cuidado já
// tomado em gerarMovimentacaoOperacaoAutomatica).
export async function buscarMovimentosManuais(opts: {
  lojaId: number
  dataInicio: string
  dataFinal: string
}): Promise<LinhaMovManualBruta[]> {
  const supabase = createServiceClient()
  const quentes = await paginarTodos<LinhaMovManualBruta>((from, to) =>
    supabase
      .from('movimentos')
      .select('id, id_ajuste, id_prod, tipo, quan, valor, codigo_local_estoque, origem, motivo, data')
      .eq('loja_id', opts.lojaId)
      .gte('data', opts.dataInicio)
      .order('id')
      .range(from, to)
  )
  const todas = await complementarMovimentos(quentes, {
    lojaId: opts.lojaId,
    dataInicio: opts.dataInicio,
    dataFinal: opts.dataFinal,
  })
  return todas.filter((l) => {
    const d = String(l.data).slice(0, 10)
    return d >= opts.dataInicio && d <= opts.dataFinal && ehMovimentoManual(l)
  })
}

// Metadado de produto (tipo/família/descrição/código) paginado -- mesmo
// cuidado de sempre (5 das 6 lojas ativas têm >1000 produtos, PostgREST
// corta em silêncio sem paginação, ver AGENTS.md).
export async function buscarMetaProdutosMovManual(lojaId: number): Promise<Map<number, MetaProdutoMovManual>> {
  const supabase = createServiceClient()
  const rows = await paginarTodos<{ codigo_produto: number; tipo_item: string | null; descricao_familia: string | null; descricao: string | null; codigo: string | null }>(
    (from, to) =>
      supabase
        .from('produtos')
        .select('codigo_produto, tipo_item, descricao_familia, descricao, codigo')
        .eq('loja_id', lojaId)
        .order('id')
        .range(from, to)
  )
  return new Map(rows.map((p) => [Number(p.codigo_produto), { tipo: p.tipo_item, familia: p.descricao_familia, descricao: p.descricao, codigo: p.codigo }]))
}

// Agrega linhas já filtradas (buscarMovimentosManuais) por rótulo (conforme
// `dim`) × mês. `opts.filtroExtra` é usado pelo drill-down (lib/drill.ts):
// ao entrar numa dimensão (ex: família = "CARNES"), restringe às linhas cujo
// rótulo daquela dimensão bate, antes de reagregar por produto.
export function agregarMovimentacaoManual(
  linhas: LinhaMovManualBruta[],
  metaPorCodigo: Map<number, MetaProdutoMovManual>,
  locaisPorCodigo: Map<number, string>,
  dim: 'tipo' | 'familia' | 'local' | 'produto',
  sentido: 'entradas' | 'saidas',
  opts: {
    codigosProduto?: Set<number> | null
    locaisCodigos?: Set<number> | null
    filtroExtra?: (l: LinhaMovManualBruta, meta: MetaProdutoMovManual | undefined, localLabel: string) => boolean
  } = {}
): LinhaMovManualAgregada[] {
  const grupos = new Map<string, LinhaMovManualAgregada>()
  for (const l of linhas) {
    // Mesma convenção já usada em gerarMovimentacaoOperacaoAutomatica: `quan`
    // sempre vem positivo do Omie, a direção é o campo `tipo` (ENT = entrada;
    // SAI/SLD = saída -- confirmado ao vivo, nenhuma linha de SAI/SLD tem
    // quan negativo).
    const sentidoLinha: 'entradas' | 'saidas' = l.tipo === 'ENT' ? 'entradas' : 'saidas'
    if (sentidoLinha !== sentido) continue
    if (opts.codigosProduto && (l.id_prod == null || !opts.codigosProduto.has(l.id_prod))) continue
    if (opts.locaisCodigos && (l.codigo_local_estoque == null || !opts.locaisCodigos.has(l.codigo_local_estoque))) continue
    const meta = l.id_prod != null ? metaPorCodigo.get(l.id_prod) : undefined
    const localLabel = l.codigo_local_estoque != null ? (locaisPorCodigo.get(l.codigo_local_estoque) ?? String(l.codigo_local_estoque)) : 'Sem local'
    if (opts.filtroExtra && !opts.filtroExtra(l, meta, localLabel)) continue
    const rotulo =
      dim === 'tipo' ? (meta?.tipo || 'Sem classificação')
      : dim === 'familia' ? (meta?.familia || 'Sem classificação')
      : dim === 'local' ? localLabel
      : (meta?.descricao || (l.id_prod != null ? `Produto ${l.id_prod}` : 'Sem classificação'))
    const mes = String(l.data).slice(0, 7)
    const qtde = Number(l.quan) || 0
    const valor = Number(l.valor) || 0
    if (!qtde && !valor) continue
    // JSON.stringify em vez de "|": rótulo vem de descrição/família sem
    // sanitização (mesmo achado real já corrigido em lib/omie/faturamento.ts
    // e lib/historico-contabo.ts).
    const chave = JSON.stringify([rotulo, mes])
    const acc = grupos.get(chave) ?? { rotulo, mes, qtde: 0, valor: 0 }
    acc.qtde += qtde
    acc.valor += valor
    grupos.set(chave, acc)
  }
  return [...grupos.values()]
}
