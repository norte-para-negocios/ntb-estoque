// Regras puras do painel gerencial da home. node --test lib/dashboard-gerencial-puro.test.ts

/**
 * Nome de exibição de um produto vindo do fato do Contabo (/fat_agregado devolve só o código cru). Item vendido sem
 * código (na ODARA, 336 de 1.907 itens em 03/11/2026) vinha como "null" → Number → "Produto NaN".
 */
export function rotuloProdutoAgregado(rotulo: string | number | null | undefined, nomes: Map<number, string>): string {
  const txt = rotulo == null ? '' : String(rotulo).trim()
  if (!txt || txt === 'null' || txt === 'undefined') return 'Sem cadastro'
  const cod = Number(txt)
  if (!Number.isFinite(cod)) return `Sem cadastro (${txt})`
  return nomes.get(cod) ?? `Sem cadastro (${txt})`
}
