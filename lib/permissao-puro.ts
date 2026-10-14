// Regra pura de permissão (sem imports): '*' = acesso total (Admin global ou AdminLoja vinculado à loja).
export function temPermissao(nomes: Set<string>, permissaoNome: string): boolean {
  return nomes.has('*') || nomes.has(permissaoNome)
}
