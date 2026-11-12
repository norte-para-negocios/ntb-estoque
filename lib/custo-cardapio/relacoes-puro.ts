// Norte Cozinha, "onde é usado" completo de um insumo: cardápios e próximos eventos que o usam, direto ou por uma
// preparação (PURO, node --test). `usos` = raiz (prato/preparação) → quantidade do insumo em 1 unidade da raiz.

export type CardapioQueUsa = { id: number; nome: string; ativo: boolean; pratos: { codigo: number; quantidade: number }[]; quantidade: number }
export type EventoQueUsa = { id: number; nome: string; data: string | null; status: string; convidados: number; quantidade: number; pratos: number[] }

const r6 = (n: number) => Math.round(n * 1e6) / 1e6

/** Cardápios com algum prato que usa o insumo; quantidade = soma de 1 porção de cada prato × porções do prato no cardápio. */
export function cardapiosQueUsam(
  usos: Map<number, number>,
  cardapios: { id: number; nome: string; ativo: boolean }[],
  itens: { cardapioId: number; codigo: number; porcoes: number }[],
): CardapioQueUsa[] {
  const out: CardapioQueUsa[] = []
  for (const c of cardapios) {
    const pratos = itens.filter((i) => i.cardapioId === c.id && usos.has(i.codigo))
      .map((i) => ({ codigo: i.codigo, quantidade: r6((usos.get(i.codigo) as number) * (i.porcoes > 0 ? i.porcoes : 1)) }))
    if (pratos.length) out.push({ ...c, pratos, quantidade: r6(pratos.reduce((a, p) => a + p.quantidade, 0)) })
  }
  return out.sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome, 'pt-BR'))
}

/** Eventos com algum prato que usa o insumo; quantidade = convidados × porções por convidado × uso × (1 + folga). */
export function eventosQueUsam(
  usos: Map<number, number>,
  eventos: { id: number; nome: string; data: string | null; status: string; convidados: number; folgaPct: number }[],
  itens: { eventoId: number; codigo: number; porcoesPorConvidado: number }[],
): EventoQueUsa[] {
  const out: EventoQueUsa[] = []
  for (const e of eventos) {
    const doEvento = itens.filter((i) => i.eventoId === e.id && usos.has(i.codigo))
    if (!doEvento.length) continue
    const folga = 1 + Math.max(e.folgaPct, 0) / 100
    const quantidade = doEvento.reduce((a, i) => a + Math.max(e.convidados, 0) * Math.max(i.porcoesPorConvidado, 0) * (usos.get(i.codigo) as number) * folga, 0)
    out.push({ ...e, quantidade: r6(quantidade), pratos: doEvento.map((i) => i.codigo) })
  }
  return out.sort((a, b) => (a.data ?? '9999').localeCompare(b.data ?? '9999') || a.id - b.id)
}
