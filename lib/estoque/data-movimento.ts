// Data que as telas do estoque próprio mostram num movimento. O ledger guarda data_ref (dia do movimento, que pode ser
// passado: entrada manual / OP com data, migration 320) e created_at (quando alguém lançou). A tela mostra data_ref; se o
// lançamento foi em outro dia, mostra também "lançado em". Pedido do Ramon 05/11/2026. Puro: node --test.

const TZ = 'America/Bahia'

function diaLocal(iso: string): string {
  // en-CA dá AAAA-MM-DD
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ })
}

export function dataDoMovimento(dataRef: string | null | undefined, criadoEm: string, comAno = false): { data: string; lancado: string | null } {
  const opts: Intl.DateTimeFormatOptions = { timeZone: TZ, day: '2-digit', month: '2-digit', ...(comAno ? { year: '2-digit' } : {}), hour: '2-digit', minute: '2-digit' }
  const lancamento = new Date(criadoEm).toLocaleString('pt-BR', opts)
  const ref = dataRef ? dataRef.slice(0, 10) : null
  if (!ref || ref === diaLocal(criadoEm)) return { data: lancamento, lancado: null }
  const [a, m, d] = ref.split('-')
  return { data: comAno ? `${d}/${m}/${a.slice(2)}` : `${d}/${m}`, lancado: `lançado em ${lancamento}` }
}
