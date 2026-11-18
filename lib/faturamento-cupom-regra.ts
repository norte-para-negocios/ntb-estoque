// Regra única de quais cupons do fato do Contabo (fat_cupons) entram no
// faturamento. Mesma regra do pré-agregado do ano atual (lib/omie/faturamento.ts,
// syncFaturamento: `cancelado` e `devolvido` ficam de fora). Antes, o caminho do
// histórico (anos anteriores) só montava o mês de cada cupom e somava os itens de
// TODOS os cupons, inclusive os cancelados depois da ingestão (achado F-03 da
// lista final do robô cmv: jul/2025 R$ 249,03 e out/2025 R$ 8,50 a mais).
export type CupomRegra = { n_id_cupom: number; data: string; cancelado: boolean; devolvido: boolean }

export function cupomEntraNoFaturamento(c: Pick<CupomRegra, 'cancelado' | 'devolvido'>): boolean {
  return !c.cancelado && !c.devolvido
}

// n_id_cupom -> 'YYYY-MM' só dos cupons que entram. Item de cupom fora do mapa
// é ignorado pelo agregador (`if (!mes) continue`).
export function mesPorCupomFaturavel(cupons: CupomRegra[]): Map<number, string> {
  return new Map(cupons.filter(cupomEntraNoFaturamento).map((c) => [c.n_id_cupom, c.data.slice(0, 7)]))
}
