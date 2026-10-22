// Número da nota na etiqueta de entrada (pedido do Ramon, 22/10/2026). Sem imports @/,
// testável via `node --test lib/etiqueta-nf.test.ts`.
//
// Vai na metade direita da linha "Prod:" (vazia na etiqueta de nota), então não muda a
// altura da etiqueta. A data de entrada só entra "se couber": a largura é estimada pelas
// larguras da Helvetica (a fonte do PDF), em pontos.

export function numeroNf(n: string | number | null | undefined): string {
  const s = String(n ?? '').trim()
  if (!s) return ''
  return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, '') : s
}

/** "14/10/2026" (Omie) ou ISO -> "14/10/26". */
export function dataEntradaCurta(d: string | null | undefined): string {
  const s = String(d ?? '').trim()
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (m) return `${m[1]}/${m[2]}/${m[3].slice(2)}`
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[3]}/${m[2]}/${m[1].slice(2)}`
  return ''
}

// Larguras da Helvetica (AFM, em milésimos do corpo) para os caracteres que aparecem aqui.
const LARGURA: Record<string, number> = {
  ' ': 278, '/': 278, '-': 333, '.': 278, '·': 278, 'º': 370, N: 722, F: 611, S: 667,
  é: 556, r: 333, i: 222, s: 500, e: 556, n: 556,
}
function larguraChar(c: string, negrito: boolean): number {
  if (/\d/.test(c)) return 556
  const w = LARGURA[c] ?? (c === c.toUpperCase() ? 667 : 556)
  return negrito ? w * 1.06 : w
}

export function larguraTextoPt(texto: string, fontePt: number, negrito = false): number {
  let soma = 0
  for (const c of texto) soma += larguraChar(c, negrito)
  return (soma / 1000) * fontePt
}

/**
 * Texto do número da nota que cabe em `larguraPt`: tenta com série e data de entrada, depois
 * só com dia/mês, depois sem a data, depois a forma curta "NF 7046-1" (essa sempre vai, mesmo apertada).
 */
export function textoNfEtiqueta(
  nf: { numero?: string | number | null; serie?: string | null; entrada?: string | null },
  larguraPt: number,
  fontePt = 7.25,
  negrito = false
): string {
  const numero = numeroNf(nf.numero)
  if (!numero) return ''
  const serie = String(nf.serie ?? '').trim()
  const data = dataEntradaCurta(nf.entrada)
  const base = `NF nº ${numero}${serie ? ` série ${serie}` : ''}`
  // Data completa, depois só dia/mês, depois sem data.
  const opcoes = [data ? `${base} · ${data}` : null, data ? `${base} · ${data.slice(0, 5)}` : null, base].filter(Boolean) as string[]
  for (const t of opcoes) if (larguraTextoPt(t, fontePt, negrito) <= larguraPt) return t
  return `NF ${numero}${serie ? `-${serie}` : ''}`
}
