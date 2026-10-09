// Ids provisórios: linhas criadas sem internet ganham ids numa faixa alta e exclusiva por tabela
// (definida pelo banco local, ntb_local.ajustar_sequencias). Quando a ação é reenviada ao
// servidor, os ids reais substituem os provisórios nos argumentos das ações seguintes da fila.
import type { Json } from './serializacao'

export const BASE_INT4 = 2_000_000_000
export const PASSO_INT4 = 1_000_000
export const BASE_INT8 = 5_000_000_000_000_000
export const PASSO_INT8 = 10_000_000_000

export function ehProvisorio(n: number): boolean {
  if (!Number.isSafeInteger(n)) return false
  return (n >= BASE_INT4 && n <= 2_147_483_647) || (n >= BASE_INT8 && n < BASE_INT8 * 2)
}

export type Faixas = Record<string, { base: number; tipo: 'int4' | 'int8' }>

export function tabelaDoProvisorio(n: number, faixas: Faixas): string | null {
  for (const [tabela, f] of Object.entries(faixas)) {
    const passo = f.tipo === 'int4' ? PASSO_INT4 : PASSO_INT8
    if (n >= f.base && n < f.base + passo) return tabela
  }
  return null
}

const NUM_EM_TEXTO = /(?<![\d.])(\d{10,16})(?![\d.])/g

/**
 * Troca ids provisórios por reais em qualquer número (ou trecho numérico de texto, como
 * '/inventario/2000000005') do JSON. Só mexe nos números que este computador de fato criou
 * (`candidatos`: chaves do mapa + ids das linhas criadas sem internet); um telefone ou código que
 * caia na mesma faixa passa intacto. Devolve os candidatos que não têm par no mapa.
 */
export function reescreverIds(json: Json, mapa: Map<number, number>, candidatos?: Set<number>): { json: Json; faltando: number[] } {
  const faltando = new Set<number>()
  const conhecidos = candidatos ?? new Set(mapa.keys())
  if (!conhecidos.size) return { json, faltando: [] }
  const troca = (n: number): number => {
    if (!conhecidos.has(n)) return n
    const real = mapa.get(n)
    if (real === undefined) {
      faltando.add(n)
      return n
    }
    return real
  }
  const visitar = (v: Json): Json => {
    if (typeof v === 'number') return troca(v)
    if (typeof v === 'string') {
      if (/^\d+$/.test(v) && v.length >= 10 && v.length <= 16) return String(troca(Number(v)))
      return v.replace(NUM_EM_TEXTO, (m) => String(troca(Number(m))))
    }
    if (Array.isArray(v)) return v.map(visitar)
    if (v && typeof v === 'object') {
      const o: { [k: string]: Json } = {}
      for (const [k, val] of Object.entries(v)) o[k] = visitar(val)
      return o
    }
    return v
  }
  return { json: visitar(json), faltando: [...faltando] }
}

/** Os candidatos citados num JSON (para saber de quais ações uma ação depende). */
export function provisoriosEm(json: Json, candidatos: Set<number>): number[] {
  return reescreverIds(json, new Map(), candidatos).faltando
}

/** Um pk é provisório se cai na faixa da PRÓPRIA tabela (faixas vindas de ntb_local.meta). */
export function pkProvisorio(tabela: string, pk: Record<string, unknown>, faixas: Faixas): boolean {
  const f = faixas[tabela]
  if (!f) return false
  const passo = f.tipo === 'int4' ? PASSO_INT4 : PASSO_INT8
  return Object.values(pk).some((v) => typeof v === 'number' && v >= f.base && v < f.base + passo)
}
