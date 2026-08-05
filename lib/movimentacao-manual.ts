// Fonte "só manual" do relatório de Movimentação (item #10 da reunião
// 2026-08-03 com o Ramon: "o relatório atual mistura vendas (PDV) e compras
// com movimento manual -- quer que mostre SÓ movimento manual de estoque").
//
// Achado real desta task (investigação, ver task-6-report.md): a hipótese do
// plano ("a tabela `movimentos` já é só ajuste manual, sem venda/compra
// misturado") estava PARCIALMENTE certa. `movimentos` nunca recebe compra
// (NF de entrada é outra tabela inteira, nunca grava aqui) -- mas venda de
// PDV SIM aparece aqui, de duas formas: origem='PDV' direto (rara: medido ao
// vivo, loja 2 tem 102.797 linhas/R$4,70M assim) e origem='AJU'/motivo='PDV'
// (a baixa de estoque que o Omie gera pra cada venda, majoritária: loja 2
// tem 14.035 linhas/R$723k assim), vs. só dezenas de linhas/algumas centenas
// de R$ de perda manual "pura", motivo='PER'. A distinção, porém, é POSSÍVEL
// (ao contrário de `movimentos_historico`, que não tem nenhuma coluna de
// origem) porque `motivo`/`origem` sempre vêm preenchidos pelo Omie -- o
// mesmo filtro já usado em `lib/movimentacao-operacao-auto.ts`
// (`gerarMovimentacaoOperacaoAutomatica`, categoria "Movimento Manual de
// Estoque") resolve isso, e é reaproveitado aqui via `ehMovimentoManual`.
//
// `movimentos` também exclui TRF/TPQ (transferência entre locais): não é um
// "entrada/saída" de estoque líquido no sentido que o Ramon pediu -- é
// deslocamento entre locais da mesma loja, e já tem visão própria
// (Transferências). Exclusão checa `tipo` E `motivo` (achado da revisão,
// fix round 1): 2 linhas em toda a base (loja 2, R$61,51) tinham
// `motivo='TRF'` com `tipo='ENT'` -- vazavam pro "manual" porque só o `tipo`
// era checado, igual ao padrão já usado pro PDV (2 campos).
//
// Achado real #3 (fix round 1, revisão independente): `valor` em `movimentos`
// NÃO é o valor total do movimento -- é o CUSTO UNITÁRIO (CMC) usado no
// ajuste, confirmado em 2 lugares: `lib/actions/inventario.ts` e
// `lib/actions/movimentacoes.ts` mandam pro Omie `valor: posicao?.n_cmc ?? 0`
// (unitário) tanto pro ajuste de inventário quanto pro ajuste manual comum --
// nunca `quan * cmc`. Confirmado também estatisticamente: 308 de 331 produtos
// com 5+ linhas de ajuste (loja 3) têm o coeficiente de variação de `valor`
// menor que o de `quan` (valor fica ~estável entre lançamentos do mesmo
// produto mesmo quando a quantidade varia 10-200x -- ex: id_prod 4775275749,
// quan=12 e quan=216, valor=4.95 nas duas linhas). O total em R$ correto é
// `Math.abs(quan) * valor`, não `valor` sozinho. Esse fix continua válido no
// fix round 2 (abaixo) -- só passou a se aplicar SÓ a ENT/SAI, porque SLD
// saiu inteiramente do cálculo de R$ (não é movimento, ver achado #4). Ver
// task-6-report.md, seções "Fix round 1" e "Fix round 2".
//
// Achado real #4 (fix round 2, SUBSTITUI o achado #4 do fix round 1 --
// aquele estava errado): `tipo='SLD'` NÃO é um movimento de estoque -- é uma
// FOTO DO SALDO contado fisicamente no inventário num instante, não uma
// quantidade que entrou/saiu. Confirmado por join independente
// `movimentos`(SLD) × `inventario_items` por `id_ajuste`: 883/883 linhas
// batem exato, `movimentos.quan` = `inventario_items.quan` (a contagem
// digitada pelo operador). Evidência adicional: (1) contagens repetidas do
// mesmo produto traçam um NÍVEL ao longo do tempo (ex.: 34 → 14 → 13 → 13 →
// 21 → 45 → 8 → 3), não uma série de movimentos; (2) `movimentos_historico`
// (feed oficial de movimento da Omie) mostra, no mesmo dia de um SLD, um
// fluxo real de estoque completamente diferente do número do SLD; (3) 1.454
// linhas SLD têm `quan=0` (prateleira contada vazia) -- como delta seria um
// no-op sem sentido repetido 1454 vezes, como saldo contado é rotina normal
// (achar zero é informação real: a prateleira estava vazia).
//
// Por isso SLD NUNCA entra no total de entrada/saída em R$ (`agregarMovimentacaoManual`
// só olha tipo IN ('ENT','SAI'), que são movimento de verdade) -- somar
// `quan` de SLD ao longo do ano é somar "fotos" tiradas em instantes
// diferentes, sem significado de negócio nenhum (achado real de produção:
// um erro de digitação, loja 5, 2026-05-30, quan=2.720.000 × R$24,90 virou
// R$67.728.000 de "entrada manual" com o código do fix round 1 -- rodando
// pra toda a base de uma loja, SLD sozinho já somava R$70.843.233,42,
// 98,4% das linhas, um número sem nenhum sentido de negócio). SLD é
// exposto separadamente por `agregarSaldoContado` abaixo -- contagem de
// eventos (quantas vezes um produto foi contado, quantas fecharam em zero),
// nunca soma de `quan` entre contagens diferentes.
//
// O "delta real" de estoque que uma contagem de inventário efetivamente
// causou (quanto entrou/saiu de fato pra corrigir o saldo) NÃO existe hoje
// em `movimentos` -- precisaria gravar o saldo ANTERIOR no momento do
// ajuste (dado novo, não capturado) ou outro endpoint da Omie que traga
// isso. Fora do escopo desta task -- ver task-6-report.md, "Fix round 2".
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

// SLD (saldo contado): contagem de EVENTOS, não soma de quantidade -- somar
// `quan` entre contagens diferentes do mesmo produto não tem significado
// (ver achado real #4 no topo do arquivo). `zeradas` é o sinal que interessa
// pro Ramon (produto contado e achado em zero = perda total naquele local).
export type LinhaSaldoContadoAgregada = { rotulo: string; mes: string; contagens: number; zeradas: number }

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
  // Checa tipo E motivo (fix round 1): 2 linhas em produção tinham
  // motivo='TRF' com tipo='ENT' -- só checar `tipo` deixava vazar.
  if (r.tipo === 'TRF' || r.tipo === 'TPQ' || r.motivo === 'TRF' || r.motivo === 'TPQ') return false
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
    // SLD não é movimento (é foto de saldo contado) -- nunca entra no total
    // de entrada/saída em R$. Ver achado real #4 no topo do arquivo e
    // `agregarSaldoContado` pra exibição separada dele.
    if (l.tipo !== 'ENT' && l.tipo !== 'SAI') continue
    const quanNum = Number(l.quan) || 0
    // `quan` sempre vem positivo do Omie pra ENT/SAI, a direção é o campo
    // `tipo` (confirmado ao vivo, nenhuma linha de SAI tem quan negativo).
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
    const qtde = Math.abs(quanNum)
    // `l.valor` é o custo UNITÁRIO (CMC), não o total do movimento -- achado
    // #3 no topo do arquivo. Total em R$ = quantidade x custo unitário.
    // Math.abs em tudo: nunca deixa um valor com sinal inesperado subtrair
    // do total do bucket em vez de somar.
    const unitValor = Number(l.valor) || 0
    const valor = qtde * unitValor
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

// Agrega as linhas SLD (saldo contado no inventário, NÃO movimento -- ver
// achado real #4 no topo do arquivo) por rótulo × mês, em CONTAGEM DE
// EVENTOS -- nunca soma `quan`/`valor` entre contagens diferentes (isso não
// tem significado: cada linha é uma foto de um instante, não um fluxo).
// `zeradas` é o sinal que interessa pro Ramon: quantas vezes um produto foi
// contado e encontrado em ZERO (perda total naquele local) -- por isso
// linhas com quan=0 são contadas normalmente aqui (ao contrário de
// agregarMovimentacaoManual, onde qtde=0 e valor=0 juntos descartam a
// linha).
export function agregarSaldoContado(
  linhas: LinhaMovManualBruta[],
  metaPorCodigo: Map<number, MetaProdutoMovManual>,
  locaisPorCodigo: Map<number, string>,
  dim: 'tipo' | 'familia' | 'local' | 'produto',
  opts: {
    codigosProduto?: Set<number> | null
    locaisCodigos?: Set<number> | null
    filtroExtra?: (l: LinhaMovManualBruta, meta: MetaProdutoMovManual | undefined, localLabel: string) => boolean
  } = {}
): LinhaSaldoContadoAgregada[] {
  const grupos = new Map<string, LinhaSaldoContadoAgregada>()
  for (const l of linhas) {
    if (l.tipo !== 'SLD') continue
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
    const chave = JSON.stringify([rotulo, mes])
    const acc = grupos.get(chave) ?? { rotulo, mes, contagens: 0, zeradas: 0 }
    acc.contagens += 1
    if ((Number(l.quan) || 0) === 0) acc.zeradas += 1
    grupos.set(chave, acc)
  }
  return [...grupos.values()]
}
