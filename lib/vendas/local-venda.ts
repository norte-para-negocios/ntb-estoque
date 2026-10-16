// Local de estoque de onde sai cada item vendido no ntb-vendas (2026-09-30).
// Ordem: produto mapeado > local escolhido no Norte Vendas > setor do item (ex.: Pizzaria -> local PIZZA, pedido do Ramon: pizza e
// embalagem de pizza consomem no local da pizzaria) > destino cozinha/bar > null
// (quem chama usa o local padrão da loja).
export type LojaLocais = {
  local_estoque_cozinha_codigo: number | null
  local_estoque_bar_codigo: number | null
  /** { "<nome do setor>": codigo_local_estoque } — chave comparada sem caixa/acento. */
  local_estoque_por_setor?: Record<string, number> | null
  /** { "<codigo do produto (SKU)>": codigo_local_estoque } — vence tudo. Ex.: embalagem de pizza
   *  baixa na PIZZA sem precisar mudar onde ela imprime (30/09). */
  local_estoque_por_produto?: Record<string, number> | null
}

export type ItemLocal = {
  codigo?: string
  destination?: 'kitchen' | 'bar' | null
  setor?: string | null
  /** Local escolhido pelo lojista no Norte Vendas pro destino/setor do item (30/09). */
  localEstoque?: number | null
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

export function localDaVenda(loja: LojaLocais, item: ItemLocal): number | null {
  const porProduto = item.codigo ? loja.local_estoque_por_produto?.[item.codigo] : undefined
  if (porProduto) return Number(porProduto)
  if (item.localEstoque) return Number(item.localEstoque)
  if (item.setor && loja.local_estoque_por_setor) {
    const alvo = norm(item.setor)
    for (const [nome, codigo] of Object.entries(loja.local_estoque_por_setor)) {
      if (norm(nome) === alvo && codigo) return Number(codigo)
    }
  }
  if (item.destination === 'kitchen') return loja.local_estoque_cozinha_codigo ?? null
  if (item.destination === 'bar') return loja.local_estoque_bar_codigo ?? null
  return null
}

/**
 * Origem do IncluirAjusteEstoque no Omie (regra do dono, 30/09): saída de venda COM nota
 * fiscal vai como "PDV" (movimento do PDV, igual ao sistema antigo); venda SEM nota é só uma
 * baixa comum ("AJU"). Ajustes manuais continuam "AJU". A origem de cada movimento fica gravada
 * em `movimentos.origem` na hora da venda; o reenvio (cron) usa a gravada.
 */
export function origemDaVenda(comNota: boolean | null | undefined): 'PDV' | 'AJU' {
  return comNota === true ? 'PDV' : 'AJU'
}

export function origemDoAjuste(motivo: string | null | undefined, origemGravada: string | null | undefined): 'PDV' | 'AJU' {
  return motivo === 'PDV' && origemGravada === 'PDV' ? 'PDV' : 'AJU'
}

/**
 * Obs da saída de estoque de um item vendido (pedido do Ramon, 15/10/2026): venda COM nota (movimento "Integração
 * com o PDV" no Omie) leva só "Cupom <número da NFC-e>", para achar a nota no painel de NFC-e. A marca da venda
 * ("Venda ntb-vendas #<pedido>") continua guardada em `movimentos.obs_item` (`marca`): o estorno acha a saída por ela.
 * Sem o número da nota (ainda não autorizada) ou venda sem nota: obs de sempre.
 */
export function obsDaBaixa(obsVenda: string, comNota: boolean | null | undefined, cupom: string | number | null | undefined): { obs: string; marca: string | null } {
  const n = cupom == null ? '' : String(cupom).trim()
  if (comNota === true && /^\d{1,9}$/.test(n) && Number(n) > 0) return { obs: `Cupom ${Number(n)}`, marca: obsVenda }
  return { obs: `${obsVenda} · saída automática da venda`, marca: null }
}
