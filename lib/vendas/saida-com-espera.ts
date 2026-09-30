// Saída de estoque da venda logo depois da OP: o Omie leva alguns segundos pra calcular o custo (CMC) do que a OP
// acabou de produzir, e a saída feita antes disso volta "Sem CMC" (Sertão, 29/09). Em vez de deixar pro cron (1 h),
// espera um pouco e tenta de novo. Qualquer outro erro volta na hora (sem insistir).
export async function comEsperaDeCmc<T extends { status: string }>(
  tentar: () => Promise<T>,
  opts: { esperasMs?: number[]; dormir?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const esperas = opts.esperasMs ?? [8000, 15000, 25000]
  const dormir = opts.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let r = await tentar()
  for (const ms of esperas) {
    if (r.status !== 'Sem CMC') return r
    await dormir(ms)
    r = await tentar()
  }
  return r
}
