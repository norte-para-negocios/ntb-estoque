// Norte Cozinha, Início: lembrete da contagem semanal, próximo evento e valor em estoque (PURO, node --test).

const DIA = 86_400_000
const t = (iso: string) => Date.parse(`${iso.slice(0, 10)}T12:00:00Z`)
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Segunda-feira da semana de `hoje` (semana de segunda a domingo). */
export function inicioDaSemana(hoje: string): string {
  const d = new Date(t(hoje)).getUTCDay() // 0 = domingo
  return iso(t(hoje) - ((d + 6) % 7) * DIA)
}

/** Data, nesta semana (segunda a domingo), do dia escolhido para contar (0 = domingo … 6 = sábado). */
export function diaDaContagemNaSemana(hoje: string, diaContagem: number): string {
  return iso(t(inicioDaSemana(hoje)) + ((diaContagem + 6) % 7) * DIA)
}

export type EstadoContagem =
  | { estado: 'desligada' }
  | { estado: 'ainda_nao'; dia: string }
  | { estado: 'feita'; contados: number; total: number }
  | { estado: 'pendente'; dia: string; contados: number; total: number; diasAtraso: number }

/**
 * Lembrete da contagem: a partir do dia escolhido até alguém contar pelo menos metade dos insumos das fichas nesta semana.
 * `contados` = insumos das fichas contados desde a segunda-feira; `total` = insumos ativos das fichas.
 */
export function estadoContagem(hoje: string, diaContagem: number | null, contados: number, total: number): EstadoContagem {
  if (diaContagem == null) return { estado: 'desligada' }
  const dia = diaDaContagemNaSemana(hoje, diaContagem)
  if (total > 0 && contados >= Math.ceil(total / 2)) return { estado: 'feita', contados, total }
  if (hoje.slice(0, 10) < dia) return { estado: 'ainda_nao', dia }
  return { estado: 'pendente', dia, contados, total, diasAtraso: Math.round((t(hoje) - t(dia)) / DIA) }
}

/** Valor em estoque: saldo positivo × custo médio, só custo confiável. */
export function valorEmEstoque(itens: { saldo: number; custo: number | null }[]): number {
  return itens.reduce((a, i) => a + (i.custo != null && i.custo > 0 && i.saldo > 0 ? i.saldo * i.custo : 0), 0)
}

export type ResumoCompraEvento = { aComprar: number; custoCompra: number; conflitos: number }

/**
 * Quanto falta comprar para um evento, já descontando o que OUTROS eventos confirmados reservaram do mesmo saldo.
 * `necessidade` = insumo → quantidade (com folga); `saldo` devolve undefined quando não dá para comparar (unidade diferente).
 * Conflito = insumo do evento cujo saldo não cobre nem o que os outros eventos já reservaram.
 */
export function compraDoEvento(
  necessidade: Map<number, { quantidade: number; custoUnitario: number | null }>,
  saldo: (cod: number) => number | undefined,
  reservadoOutros: (cod: number) => number,
): ResumoCompraEvento {
  let aComprar = 0
  let custoCompra = 0
  let conflitos = 0
  for (const [cod, n] of necessidade) {
    const s = saldo(cod)
    const livre = s == null ? 0 : Math.max(s, 0) - Math.max(reservadoOutros(cod), 0)
    if (s != null && livre < -1e-9) conflitos++
    const falta = n.quantidade - Math.max(livre, 0)
    if (falta > 1e-9) { aComprar++; custoCompra += falta * (n.custoUnitario ?? 0) }
  }
  return { aComprar, custoCompra, conflitos }
}
