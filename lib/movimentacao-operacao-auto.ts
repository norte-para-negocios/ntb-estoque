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

const DESDE = '2025-07-01'

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
type NFHeaderRow = { id: number; d_emissao_nfe: string; deleted_at: string | null }

function localDeNF(it: { full_object: Record<string, unknown> | null }): number | null {
  const ajustes = (it.full_object as { itensAjustes?: { codigo_local_estoque?: number | string } } | null)?.itensAjustes
  const v = ajustes?.codigo_local_estoque
  return v == null ? null : Number(v)
}
function cfopEntradaDeNF(it: { full_object: Record<string, unknown> | null }): string | null {
  const ajustes = (it.full_object as { itensAjustes?: { cCFOPEntrada?: string } } | null)?.itensAjustes
  return ajustes?.cCFOPEntrada ?? null
}

export async function gerarMovimentacaoOperacaoAutomatica(lojaId: number): Promise<LinhaOperAuto[]> {
  const supabase = createServiceClient()
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })

  const [metaRows, locaisRes] = await Promise.all([
    paginarTodos<{ codigo_produto: number; tipo_item: string | null; descricao_familia: string | null }>((from, to) =>
      supabase.from('produtos').select('codigo_produto, tipo_item, descricao_familia').eq('loja_id', lojaId).order('id').range(from, to)
    ),
    supabase.from('local_estoques').select('codigo_local_estoque, descricao').eq('loja_id', lojaId),
  ])
  const metaPorCodigo = new Map(metaRows.map((p) => [Number(p.codigo_produto), { tipo: p.tipo_item, familia: p.descricao_familia }]))
  const locaisPorCodigo = new Map(
    (locaisRes.data ?? []).map((l: { codigo_local_estoque: number; descricao: string | null }) => [
      Number(l.codigo_local_estoque),
      l.descricao ?? String(l.codigo_local_estoque),
    ])
  )
  const nomeLocal = (cod: number | null) => (cod == null ? 'N/D' : locaisPorCodigo.get(cod) ?? String(cod))
  const tipoSpedLabel = (tipo: string | null) => (tipo ? `${tipo}-${labelTipoItem(tipo)}` : 'N/D')

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
      supabase.from('notas_fiscais').select('id, d_emissao_nfe, deleted_at').eq('loja_id', lojaId).order('id').range(from, to)
    ),
  ])
  const [nfItens, nfHeaders] = await Promise.all([
    complementarNotaFiscalItems(nfItensHot, { lojaId, dataInicio: DESDE, dataFinal: hoje }),
    complementarNotasFiscais(nfHeadersHot, { lojaId, dataInicio: DESDE, dataFinal: hoje }),
  ])
  const headerPorId = new Map(nfHeaders.filter((h) => !h.deleted_at).map((h) => [h.id, h]))
  for (const it of nfItens) {
    const header = headerPorId.get(it.nota_fiscal_id)
    if (!header) continue
    const data = header.d_emissao_nfe.slice(0, 10)
    if (data < DESDE || data > hoje) continue
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

  // ---------- 2) PDV: Movimento Gerado pelo PDV ----------
  const cuponsFato = await buscarFatCupons({ lojaId, dataInicio: DESDE, dataFinal: hoje })
  const cuponsValidos = new Map(cuponsFato.filter((c) => !c.cancelado).map((c) => [c.n_id_cupom, c]))
  const itensFato = await buscarFatCupomItens({ lojaId, dataInicio: DESDE, dataFinal: hoje })
  for (const it of itensFato) {
    const cupom = cuponsValidos.get(it.n_id_cupom)
    if (!cupom) continue
    const meta = it.id_produto != null ? metaPorCodigo.get(Number(it.id_produto)) : undefined
    add({
      origem: 'Movimento Gerado pelo PDV', sentido: 'S', local: 'N/D',
      tipo_sped: tipoSpedLabel(meta?.tipo ?? null), familia: meta?.familia || 'N/D',
      mes: cupom.data.slice(0, 7), inventario: false,
      qtde: Number(it.quant) || 0, valor: Number(it.v_item) || 0,
    })
  }

  // ---------- 3) Ajustes manuais / inventário ----------
  const ajustesHot = await paginarTodos<{
    id: number; id_prod: number | null; tipo: string; quan: number | string | null
    valor: number | string | null; codigo_local_estoque: number | null; origem: string
    motivo: string | null; data: string
  }>((from, to) =>
    supabase
      .from('movimentos')
      .select('id, id_prod, tipo, quan, valor, codigo_local_estoque, origem, motivo, data')
      .eq('loja_id', lojaId)
      .gte('data', DESDE)
      .order('id')
      .range(from, to)
  )
  const ajustes = await complementarMovimentos(ajustesHot, { lojaId, dataInicio: DESDE })
  for (const a of ajustes) {
    // Achado real (loja 5: 50739 linhas / R$2.309.414,19): a baixa de estoque
    // gerada por venda no PDV chega aqui como origem='AJU'/motivo='PDV' (não
    // origem='PDV' -- esse é outro caso, bem mais raro, 381 linhas). Sem
    // checar motivo, essas linhas duplicavam o valor já coberto com precisão
    // pelo fato de cupom (item 2).
    if (a.origem === 'PDV' || a.motivo === 'PDV') continue
    if (a.tipo === 'TRF' || a.tipo === 'TPQ') continue // transferência, fora do escopo desta matriz
    const data = String(a.data).slice(0, 10)
    if (data < DESDE || data > hoje) continue
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
