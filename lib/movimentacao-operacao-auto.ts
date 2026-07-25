// Modo "Por operação (R$)" automático -- antes só existia via import manual
// do Excel MOV_DRV (tabela movimentacao_operacao), e só a loja 3 tinha isso
// importado. Reconstrói a mesma forma (origem/sentido/local/tipo_sped/
// familia/mes/inventario/qtde/valor) a partir de fontes já sincronizadas
// automaticamente pra TODAS as lojas:
//   - Compra de Produto / Devolução ao Fornecedor: nota_fiscal_items (NF de
//     entrada), classificado por CFOP (mesmo dicionário de lib/cfop.ts).
//   - Movimento Gerado pelo PDV: fat_cupom_itens (fato por cupom, já grava
//     em todas as lojas desde a Onda 2 desta sessão) -- valor real por item,
//     não a aproximação "PDV" de movimentos (essa é reconhecidamente
//     imprecisa pro CMC de saída).
//   - Movimento Manual de Estoque / ajuste de inventário: movimentos
//     (ListarAjusteEstoque, origem='AJU', já sincronizado + dual-write pro
//     Contabo pra todas as lojas).
// Fora do escopo por enquanto (não incluído): Consumo/Entrada de Ordem de
// Produção -- precisa de investigação separada de como derivar R$ da OP
// sem CMC direto na tabela ordens_producao.
import { createServiceClient } from '@/lib/supabase/server'
import { complementarMovimentos, complementarNotasFiscais, complementarNotaFiscalItems } from '@/lib/historico-contabo'
import { buscarFatCupons, buscarFatCupomItens } from '@/lib/faturamento-frio'
import { descreverCFOP } from '@/lib/cfop'
import { labelTipoItem } from '@/lib/constants-omie'
import { statusNF } from '@/lib/nf-status'

export type LinhaOperAuto = {
  origem: string
  sentido: 'E' | 'S'
  local: string
  tipo_sped: string
  familia: string
  mes: string
  inventario: boolean
  qtde: number
  valor: number
}


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

type NFItemRow = {
  id: number
  nota_fiscal_id: number
  n_id_produto: number | null
  c_cfop: string | null
  n_qtde_nfe: number | string | null
  n_preco_unit: number | string | null
  full_object: Record<string, unknown> | null
}
type NFHeaderRow = { id: number; d_emissao_nfe: string; deleted_at: string | null; c_etapa: string | null; full_object: Record<string, unknown> | null }

function localDeNF(it: { full_object: Record<string, unknown> | null }): number | null {
  const ajustes = (it.full_object as { itensAjustes?: { codigo_local_estoque?: number | string } } | null)?.itensAjustes
  const v = ajustes?.codigo_local_estoque
  return v == null ? null : Number(v)
}
function cfopEntradaDeNF(it: { full_object: Record<string, unknown> | null }): string | null {
  const ajustes = (it.full_object as { itensAjustes?: { cCFOPEntrada?: string } } | null)?.itensAjustes
  return ajustes?.cCFOPEntrada ?? null
}

// Achado real (usuário 2026-07-19, "sistema no geral tá muito lento"): essa
// função busca e reagrega NF + fato de cupom + ajustes do zero em TODO
// carregamento da página (~40-50s pras lojas mais pesadas, medido nesta
// sessão) -- sem cache nenhum, cada F5/troca de filtro refaz tudo.
// TENTATIVA REVERTIDA: `unstable_cache` do Next.js tem teto de 2MB por
// entrada -- o resultado agregado de uma loja pesada chega a 14,6MB, o que
// quebrava a página inteira (erro "items over 2MB can not be cached") em vez
// de acelerar. Cache real (ex: Redis, já rodando no mesmo servidor Contabo
// pra outro fim, ou uma tabela de materialização) precisaria de mais desenho
// antes de implementar -- não é troca de uma linha.
export async function gerarMovimentacaoOperacaoAutomatica(lojaId: number, produtoBusca?: string): Promise<LinhaOperAuto[]> {
  const supabase = createServiceClient()
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  // Escopo pedido pelo usuário 2026-07-19: só ano corrente, não precisa de
  // histórico do ano passado — reduz volume buscado (mais rápido) e mantém
  // a matriz focada no que importa pra operação do dia a dia.
  const DESDE = `${hoje.slice(0, 4)}-01-01`

  const [metaRows, locaisRes] = await Promise.all([
    paginarTodos<{ codigo_produto: number; tipo_item: string | null; descricao_familia: string | null; codigo: string | null; descricao: string | null }>((from, to) =>
      supabase.from('produtos').select('codigo_produto, tipo_item, descricao_familia, codigo, descricao').eq('loja_id', lojaId).order('id').range(from, to)
    ),
    supabase.from('local_estoques').select('codigo_local_estoque, descricao').eq('loja_id', lojaId),
  ])
  const metaPorCodigo = new Map(metaRows.map((p) => [Number(p.codigo_produto), { tipo: p.tipo_item, familia: p.descricao_familia, codigo: p.codigo, descricao: p.descricao }]))
  const locaisPorCodigo = new Map(
    (locaisRes.data ?? []).map((l: { codigo_local_estoque: number; descricao: string | null }) => [
      Number(l.codigo_local_estoque),
      l.descricao ?? String(l.codigo_local_estoque),
    ])
  )
  const nomeLocal = (cod: number | null) => (cod == null ? 'N/D' : locaisPorCodigo.get(cod) ?? String(cod))
  const tipoSpedLabel = (tipo: string | null) => (tipo ? `${tipo}-${labelTipoItem(tipo)}` : 'N/D')

  // Filtro de produto (busca por nome ou código) -- pedido do usuário
  // 2026-07-19: faltava na aba "Por operação", só existia em "Em quantidade".
  // Aplicado ANTES de agregar (a matriz final some com o grão de produto ao
  // juntar por família/local/tipo), então precisa checar aqui, item a item.
  const termoBusca = produtoBusca?.trim().toLowerCase() || null
  const produtoCasa = (idProduto: number | null): boolean => {
    if (!termoBusca) return true
    if (idProduto == null) return false
    const meta = metaPorCodigo.get(Number(idProduto))
    if (!meta) return false
    return (meta.descricao ?? '').toLowerCase().includes(termoBusca) || (meta.codigo ?? '').toLowerCase().includes(termoBusca)
  }

  const linhas: LinhaOperAuto[] = []
  const add = (l: LinhaOperAuto) => {
    if (!l.valor && !l.qtde) return
    linhas.push(l)
  }

  // ---------- 1) NF de entrada: Compra de Produto / Devolução ao Fornecedor ----------
  const [nfItensHot, nfHeadersHot] = await Promise.all([
    paginarTodos<NFItemRow>((from, to) =>
      supabase
        .from('nota_fiscal_items')
        .select('id, nota_fiscal_id, n_id_produto, c_cfop, n_qtde_nfe, n_preco_unit, full_object')
        .eq('loja_id', lojaId)
        .order('id')
        .range(from, to)
    ),
    paginarTodos<NFHeaderRow>((from, to) =>
      supabase.from('notas_fiscais').select('id, d_emissao_nfe, deleted_at, c_etapa, full_object').eq('loja_id', lojaId).order('id').range(from, to)
    ),
  ])
  const [nfItens, nfHeaders] = await Promise.all([
    complementarNotaFiscalItems(nfItensHot, { lojaId, dataInicio: DESDE, dataFinal: hoje }),
    complementarNotasFiscais(nfHeadersHot, { lojaId, dataInicio: DESDE, dataFinal: hoje }),
  ])
  // Achado real (pattern 1, mesma classe do fix em migrations/083 e
  // lib/relatorio-frio-nf.ts): filtrar só por `deleted_at` não basta -- NF
  // pendente (c_etapa != '60') ou cancelada (cCancelada = 'S', flag
  // independente da etapa) continuavam entrando na matriz de "Compra de
  // Produto"/"Devolução ao Fornecedor". Usa statusNF (fonte única de
  // verdade) pra só contar NF de fato concluída e não cancelada.
  const headerPorId = new Map(
    nfHeaders.filter((h) => !h.deleted_at && statusNF(h.c_etapa, h.full_object).label === 'Concluída').map((h) => [h.id, h])
  )
  for (const it of nfItens) {
    const header = headerPorId.get(it.nota_fiscal_id)
    if (!header) continue
    const data = header.d_emissao_nfe.slice(0, 10)
    if (data < DESDE || data > hoje) continue
    if (!produtoCasa(it.n_id_produto)) continue
    const cfop = cfopEntradaDeNF(it) ?? it.c_cfop
    const cat = descreverCFOP(cfop).cat
    const meta = it.n_id_produto != null ? metaPorCodigo.get(Number(it.n_id_produto)) : undefined
    const valor = (Number(it.n_qtde_nfe) || 0) * (Number(it.n_preco_unit) || 0)
    const origem = cat === 'Devolução' ? 'Devolução ao Fornecedor' : 'Compra de Produto'
    const sentido: 'E' | 'S' = cat === 'Devolução' ? 'S' : 'E'
    add({
      origem, sentido, local: nomeLocal(localDeNF(it)), tipo_sped: tipoSpedLabel(meta?.tipo ?? null),
      familia: meta?.familia || 'N/D', mes: data.slice(0, 7), inventario: false,
      qtde: Number(it.n_qtde_nfe) || 0, valor,
    })
  }

  // ---------- Ajustes manuais / inventário (+ mapa de local por produto p/ PDV) ----------
  const ajustesHot = await paginarTodos<{
    id: number; id_prod: number | null; tipo: string; quan: number | string | null
    valor: number | string | null; codigo_local_estoque: number | null; origem: string
    motivo: string | null; data: string; id_ajuste: number | null
  }>((from, to) =>
    supabase
      .from('movimentos')
      .select('id, id_prod, tipo, quan, valor, codigo_local_estoque, origem, motivo, data, id_ajuste')
      .eq('loja_id', lojaId)
      .gte('data', DESDE)
      .order('id')
      .range(from, to)
  )
  const ajustes = await complementarMovimentos(ajustesHot, { lojaId, dataInicio: DESDE })

  // O fato de cupom (fat_cupom_itens) não guarda local de estoque -- mas toda
  // venda de PDV também gera uma baixa em `movimentos` (origem='AJU',
  // motivo='PDV') com `codigo_local_estoque` preenchido pelo Omie. Usa isso
  // só pra saber DE ONDE cada produto costuma sair no PDV (não pro valor,
  // que continua vindo do fato de cupom -- ver comentário abaixo). Achado
  // real: o local de baixa por PDV varia por produto dentro da mesma loja
  // (ex: loja 2 tem 3 locais distintos usados), não é 1 valor fixo por loja.
  const localPdvPorProduto = new Map<number, Map<number, number>>()
  for (const a of ajustes) {
    if (a.motivo !== 'PDV' || a.id_prod == null || a.codigo_local_estoque == null) continue
    const contagem = localPdvPorProduto.get(a.id_prod) ?? new Map<number, number>()
    contagem.set(a.codigo_local_estoque, (contagem.get(a.codigo_local_estoque) ?? 0) + 1)
    localPdvPorProduto.set(a.id_prod, contagem)
  }
  const localMaisComumPdv = (idProd: number | null): number | null => {
    if (idProd == null) return null
    const contagem = localPdvPorProduto.get(idProd)
    if (!contagem) return null
    return [...contagem.entries()].sort((a, b) => b[1] - a[1])[0][0]
  }

  // ---------- PDV: Movimento Gerado pelo PDV ----------
  const cuponsFato = await buscarFatCupons({ lojaId, dataInicio: DESDE, dataFinal: hoje })
  const cuponsValidos = new Map(cuponsFato.filter((c) => !c.cancelado).map((c) => [c.n_id_cupom, c]))
  const itensFato = await buscarFatCupomItens({ lojaId, dataInicio: DESDE, dataFinal: hoje })
  for (const it of itensFato) {
    const cupom = cuponsValidos.get(it.n_id_cupom)
    if (!cupom) continue
    if (!produtoCasa(it.id_produto)) continue
    const meta = it.id_produto != null ? metaPorCodigo.get(Number(it.id_produto)) : undefined
    add({
      origem: 'Movimento Gerado pelo PDV', sentido: 'S', local: nomeLocal(localMaisComumPdv(it.id_produto)),
      tipo_sped: tipoSpedLabel(meta?.tipo ?? null), familia: meta?.familia || 'N/D',
      mes: cupom.data.slice(0, 7), inventario: false,
      qtde: Number(it.quant) || 0, valor: Number(it.v_item) || 0,
    })
  }

  // ---------- Ajustes manuais / inventário (linhas de fato) ----------
  for (const a of ajustes) {
    // Achado real (loja 5: 50739 linhas / R$2.309.414,19): a baixa de estoque
    // gerada por venda no PDV chega aqui como origem='AJU'/motivo='PDV' (não
    // origem='PDV' -- esse é outro caso, bem mais raro, 381 linhas). Sem
    // checar motivo, essas linhas duplicavam o valor já coberto com precisão
    // pelo fato de cupom (acima) -- só usamos essas linhas pro mapa de local.
    if (a.origem === 'PDV' || a.motivo === 'PDV') continue
    if (a.tipo === 'TRF' || a.tipo === 'TPQ') continue // transferência, fora do escopo desta matriz
    const data = String(a.data).slice(0, 10)
    if (data < DESDE || data > hoje) continue
    if (!produtoCasa(a.id_prod)) continue
    const meta = a.id_prod != null ? metaPorCodigo.get(Number(a.id_prod)) : undefined
    const sentido: 'E' | 'S' = a.tipo === 'ENT' ? 'E' : 'S'
    add({
      origem: 'Movimento Manual de Estoque', sentido, local: nomeLocal(a.codigo_local_estoque),
      tipo_sped: tipoSpedLabel(meta?.tipo ?? null), familia: meta?.familia || 'N/D',
      mes: data.slice(0, 7), inventario: a.motivo === 'INV',
      qtde: Number(a.quan) || 0, valor: Number(a.valor) || 0,
    })
  }

  return linhas
}
