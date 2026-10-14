// Central de correções: regras puras (formatos, causa em uma frase, classificação, estado, prévias, busca).
// Um arquivo só de propósito: módulos puros não podem importar valores uns dos outros com '.ts' (o tsc recusa sem
// allowImportingTsExtensions) e sem a extensão o node --test não acha. Sem imports de valor: node --test.

const CONTAVEL = new Set(['UN', 'POR', 'PCT', 'CE', 'CX', 'PC', 'DZ'])
const nf = (max: number, min = 0) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: max, minimumFractionDigits: min })

export function unidadeCurta(un: string | null | undefined): string {
  const u = (un ?? '').trim().toLowerCase()
  if (u === 'lt' || u === 'l') return 'L'
  return u || 'un'
}

/** Quantidade com unidade: '−11 un', '64,89 kg', '1,5 g'. */
export function fmtQtd(q: number | null | undefined, un: string | null | undefined): string {
  if (q == null || !Number.isFinite(q)) return '—'
  const U = (un ?? '').toUpperCase()
  const casas = CONTAVEL.has(U) ? (Number.isInteger(q) ? 0 : 2) : ['G', 'ML'].includes(U) ? 1 : 3
  return (q < 0 ? '−' : '') + nf(casas).format(Math.abs(q)) + ' ' + unidadeCurta(un)
}

/** Com sinal explícito: '+15 un', '−2 kg'. */
export function fmtQtdSinal(q: number, un: string | null | undefined): string {
  return (q > 0 ? '+' : '') + fmtQtd(q, un)
}

export function fmtBRL(v: number): string {
  return (v < 0 ? '−R$ ' : 'R$ ') + nf(2, 2).format(Math.abs(v))
}

/** Valor curto para cartões: 'R$ 139,2 mil', 'R$ 1,3 mi', 'R$ 851', 'R$ 58,08'. */
export function fmtBRLCurto(v: number): string {
  if (v < 0) return '−' + fmtBRLCurto(-v)
  if (v >= 1e6) return 'R$ ' + nf(1).format(v / 1e6) + ' mi'
  if (v >= 1e4) return 'R$ ' + nf(1).format(v / 1e3) + ' mil'
  if (v >= 100) return 'R$ ' + nf(0).format(v)
  return fmtBRL(v)
}

export function fmtData(iso: string | null | undefined): string {
  if (!iso) return '—'
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
}

export function fmtDataLonga(iso: string | null | undefined): string {
  if (!iso) return '—'
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}

export const b36 = (n: number) => Math.trunc(Math.abs(n)).toString(36)

/** Hash determinístico curto (2 × FNV-1a 32 bits, base36, 13 caracteres). */
export function hashCurto(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0
  }
  return (h1.toString(36).padStart(7, '0') + h2.toString(36).padStart(7, '0')).slice(0, 13)
}

/** Sem acento, minúsculas (busca). */
export const normalizar = (s: string | null | undefined) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
