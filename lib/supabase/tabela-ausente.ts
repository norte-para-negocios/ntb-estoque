// Puro (sem @/): "a tabela ainda não existe" (migration não aplicada). O Postgres responde 42P01; o PostgREST, antes de
// recarregar o cache do esquema, responde PGRST205. As telas novas tratam os dois como "ainda não ativado".
export function tabelaAusente(erro: { code?: string | null } | null | undefined): boolean {
  return erro?.code === '42P01' || erro?.code === 'PGRST205'
}
