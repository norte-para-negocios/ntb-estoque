// Formatos do Custo e Cardápio (puro).
export const brl = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
export const pct = (v: number | null | undefined, casas = 1) =>
  v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`
export const qtd = (v: number, unidade: string | null) => {
  const u = (unidade ?? '').toUpperCase()
  if ((u === 'G' || u === 'GR') && Math.abs(v) >= 1000) return `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg`
  if (u === 'ML' && Math.abs(v) >= 1000) return `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} l`
  if (u === 'KG' && v < 1) return `${(v * 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} g`
  if (u === 'L' && v < 1) return `${(v * 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} ml`
  return `${v.toLocaleString('pt-BR', { maximumFractionDigits: Math.abs(v) >= 100 ? 1 : 3 })}${u ? ` ${u.toLowerCase()}` : ''}`
}

/** O Omie devolve textos com entidades HTML (&quot; &amp; &apos;). */
export const limparTexto = (t: string) => t.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
