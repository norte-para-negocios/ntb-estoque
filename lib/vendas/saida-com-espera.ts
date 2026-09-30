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

// Conclusão da OP da venda: o Omie recusa com "movimentos de estoque pendentes de cálculo" (ou CMC ainda em
// cálculo) quando um ingrediente acabou de mexer. É passageiro — espera e tenta de novo. Outro erro sobe na hora.
export function ehCalculoPendente(msg: string): boolean {
  return /pendentes? de c.lculo|c.lculo do saldo de estoque e CMC/i.test(msg)
}

export async function repetirSeCalculoPendente(
  tentar: () => Promise<unknown>,
  opts: { esperasMs?: number[]; dormir?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const esperas = opts.esperasMs ?? [8000, 15000, 25000]
  const dormir = opts.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  for (let i = 0; ; i++) {
    try {
      await tentar()
      return
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!ehCalculoPendente(msg) || i >= esperas.length) throw e
      await dormir(esperas[i])
    }
  }
}
