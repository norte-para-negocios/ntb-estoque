// Item ativo do menu: o href mais específico (mais longo) que é a rota atual ou um prefixo dela seguido de '/'.
// Sem isso, /estoque e /estoque/saude ficariam os dois marcados. Puro: node --test lib/nav-ativo.test.ts.
export function hrefAtivo(pathname: string, hrefs: string[]): string | null {
  let melhor: string | null = null
  for (const h of hrefs) {
    if ((pathname === h || pathname.startsWith(h + '/')) && (melhor == null || h.length > melhor.length)) melhor = h
  }
  return melhor
}
