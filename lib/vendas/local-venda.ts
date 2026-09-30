// Local de estoque de onde sai cada item vendido no ntb-vendas (2026-09-30).
// Ordem: setor do item (ex.: Pizzaria -> local PIZZA, pedido do Ramon: pizza e
// embalagem de pizza consomem no local da pizzaria) > destino cozinha/bar > null
// (quem chama usa o local padrão da loja).
export type LojaLocais = {
  local_estoque_cozinha_codigo: number | null
  local_estoque_bar_codigo: number | null
  /** { "<nome do setor>": codigo_local_estoque } — chave comparada sem caixa/acento. */
  local_estoque_por_setor?: Record<string, number> | null
}

export type ItemLocal = { destination?: 'kitchen' | 'bar' | null; setor?: string | null }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

export function localDaVenda(loja: LojaLocais, item: ItemLocal): number | null {
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
 * Origem do IncluirAjusteEstoque no Omie: saída de venda vai como "PDV" (aparece como
 * movimento do PDV, igual ao sistema antigo); o resto é ajuste manual ("AJU").
 * Pedido do dono/Ramon em 30/09: venda não pode aparecer como "Movimento Manual".
 */
export function origemDoAjuste(motivo: string | null | undefined): 'PDV' | 'AJU' {
  return motivo === 'PDV' ? 'PDV' : 'AJU'
}
