// Gabarito do saldo de estoque (ticket 03): conta independente, SÓ função pura (sem banco, sem navegador, sem código do ERP).
// Decimais em BigInt com 9 casas: o banco guarda no máximo 6 e a soma fica exata.
const ESCALA = 9
const UM = 10n ** BigInt(ESCALA)

export type Dec = bigint

/** Texto/número decimal ("-1.25", "10", 3.5) para inteiro escalado. Arredonda além da 9ª casa. */
export function parseDec(v: string | number): Dec {
  const s = String(v).trim()
  const m = s.match(/^([+-])?(\d*)(?:\.(\d*))?$/)
  if (!m || (!m[2] && !m[3])) throw new Error(`decimal inválido: "${s}"`)
  const frac = (m[3] ?? '').padEnd(ESCALA + 1, '0')
  let n = BigInt(m[2] || '0') * UM + BigInt(frac.slice(0, ESCALA))
  if (Number(frac[ESCALA]) >= 5) n += 1n
  return m[1] === '-' ? -n : n
}

export function fmtDec(d: Dec): string {
  const neg = d < 0n
  const a = neg ? -d : d
  const int = a / UM
  const frac = (a % UM).toString().padStart(ESCALA, '0').replace(/0+$/, '')
  return `${neg ? '-' : ''}${int}${frac ? `.${frac}` : ''}`
}

/** Número como a tela mostra (pt-BR: milhar com ponto, decimal com vírgula). */
export function lerNumeroBR(texto: string): Dec {
  return parseDec(texto.trim().replace(/\./g, '').replace(',', '.'))
}

/** A tela mostra no máximo 3 casas: diferença até meio milésimo é só arredondamento. */
export const TOLERANCIA_TELA = parseDec('0.0005')
const abs = (d: Dec) => (d < 0n ? -d : d)
const iguais = (a: Dec, b: Dec) => abs(a - b) <= TOLERANCIA_TELA

export type MovLedger = { produto: number; local: number; quantidade: string }
export type SaldosPorLocal = Map<string, Dec> // chave "produto:local"
const chave = (p: number, l: number) => `${p}:${l}`

/** Estoque próprio: o ledger já guarda a quantidade com sinal (entrada +, saída -, ajuste e estorno como diferença). Saldo = soma. */
export function saldoPorLedger(movs: MovLedger[]): SaldosPorLocal {
  const s: SaldosPorLocal = new Map()
  for (const m of movs) {
    const k = chave(m.produto, m.local)
    s.set(k, (s.get(k) ?? 0n) + parseDec(m.quantidade))
  }
  return s
}

export type MovKardex = { produto: number; local: number; dataMov: string; idMov: number; quantidade: string; saldoApos: string; cancelado: boolean }

/**
 * Loja Omie: o kardex espelhado só começa numa data (sem saldo inicial). A abertura de cada produto×local é a da primeira
 * linha (saldo depois − quantidade); o saldo é abertura + soma das quantidades. Ordem: data, depois id do movimento.
 */
export function saldoPorKardex(movs: MovKardex[]): SaldosPorLocal {
  const grupos = new Map<string, MovKardex[]>()
  for (const m of movs) {
    if (m.cancelado) continue
    const k = chave(m.produto, m.local)
    const g = grupos.get(k)
    if (g) g.push(m)
    else grupos.set(k, [m])
  }
  const s: SaldosPorLocal = new Map()
  for (const [k, g] of grupos) {
    const primeira = g.reduce((a, b) => (b.dataMov < a.dataMov || (b.dataMov === a.dataMov && b.idMov < a.idMov) ? b : a))
    let saldo = parseDec(primeira.saldoApos) - parseDec(primeira.quantidade)
    for (const m of g) saldo += parseDec(m.quantidade)
    s.set(k, saldo)
  }
  return s
}

/** Soma os locais de cada produto (a tela de estoque mostra o saldo total do item). */
export function somarLocais(s: SaldosPorLocal): Map<number, Dec> {
  const r = new Map<number, Dec>()
  for (const [k, v] of s) {
    const p = Number(k.split(':')[0])
    r.set(p, (r.get(p) ?? 0n) + v)
  }
  return r
}

export type Origem = 'ERP' | 'Omie'
export type Divergencia = { produto: number; esperado: Dec; mostrado: Dec | null; omie: Dec | null; origem: Origem | null }

/**
 * Compara gabarito x tela, item a item.
 * Origem (só com `omie`): tela diferente do saldo que o Omie informou = ERP (a tela não reflete o Omie);
 * tela igual ao Omie mas diferente do gabarito = Omie (o saldo do Omie não bate com os movimentos dele).
 * `semGabarito`: itens que o gabarito não consegue calcular (ex.: sem movimento no kardex espelhado); ficam fora.
 */
export function compararSaldos(a: { gabarito: Map<number, Dec>; tela: Map<number, Dec>; omie?: Map<number, Dec> | null; semGabarito?: Set<number> }) {
  const itens = [...new Set([...a.gabarito.keys(), ...a.tela.keys()])].sort((x, y) => x - y)
  const divergencias: Divergencia[] = []
  const naoComparaveis: number[] = []
  let comparados = 0
  for (const p of itens) {
    if (a.semGabarito?.has(p)) { naoComparaveis.push(p); continue }
    comparados++
    const esperado = a.gabarito.get(p) ?? 0n
    const mostrado = a.tela.get(p) ?? null
    if (mostrado === null ? iguais(esperado, 0n) : iguais(esperado, mostrado)) continue
    let omie: Dec | null = null
    let origem: Origem | null = null
    if (a.omie) {
      omie = a.omie.get(p) ?? 0n
      origem = iguais(mostrado ?? 0n, omie) ? 'Omie' : 'ERP'
    }
    divergencias.push({ produto: p, esperado, mostrado, omie, origem })
  }
  return { comparados, divergencias, naoComparaveis }
}
