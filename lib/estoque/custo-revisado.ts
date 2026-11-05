// Aviso "custo revisado em dd/mm" das telas do estoque próprio (migration 311: o custo de um movimento pode ser revisado
// depois — nota lançada com a data dela, cascata de OP, estorno fora da cadeia). Puro: node --test lib/estoque/custo-revisado.test.ts.

export function rotuloCustoRevisado(revisado: boolean | null | undefined, revisadoEm: string | null | undefined): string | null {
  if (!revisado) return null
  const d = revisadoEm ? new Date(revisadoEm) : null
  if (!d || Number.isNaN(d.getTime())) return 'custo revisado'
  const dia = d.toLocaleDateString('pt-BR', { timeZone: 'America/Bahia', day: '2-digit', month: '2-digit' })
  return `custo revisado em ${dia}`
}
