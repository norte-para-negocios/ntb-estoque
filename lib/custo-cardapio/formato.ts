// Formatos do Custo e Cardápio (puro).
export const brl = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
export const pct = (v: number | null | undefined, casas = 1) =>
  v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`
export const qtd = (v: number, unidade: string | null) => {
  const u = (unidade ?? '').toUpperCase()
  if (u === 'KG' && v < 1) return `${(v * 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} g`
  if (u === 'L' && v < 1) return `${(v * 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} ml`
  return `${v.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}${u ? ` ${u.toLowerCase()}` : ''}`
}
