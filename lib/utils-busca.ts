/**
 * Escapa curingas do PostgREST/SQL LIKE para uso em `.ilike()`.
 * Escapa `\`, `%` e `_` para que sejam tratados como literais.
 */
export function escapeIlike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

/**
 * Versao para uso dentro de `.or(...)` do PostgREST. Alem de escapar os
 * curingas do LIKE, remove/neutraliza caracteres que quebram a sintaxe do
 * filtro `.or()` quando vem do input do usuario: virgula (separa condicoes)
 * e parenteses (agrupam condicoes).
 */
export function escapeIlikeOr(s: string): string {
  return escapeIlike(s).replace(/[(),]/g, ' ')
}
