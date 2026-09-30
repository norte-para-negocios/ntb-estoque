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
