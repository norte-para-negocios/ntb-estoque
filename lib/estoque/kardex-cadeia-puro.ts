// Ordem dos movimentos do kardex do Omie dentro de um dia. O Omie NÃO ordena por id_mov: a ordem real é a cadeia
// de saldo (saldo antes do movimento = saldo_apos − quantidade = saldo_apos do movimento anterior). Ordenar por
// (data_mov, id_mov) erra o saldo do fim do dia em ~4,7% dos produto×local×dia com 2+ movimentos (loja 5, ago–out/2026:
// ex. 31/08, produto 2453421862, NTB 2.504,5 × Omie 5.500). Puro: node --test lib/estoque/kardex-cadeia-puro.test.ts.

export type MovCadeia = { id_mov: number | string; quantidade: number | string; saldo_apos: number | string | null }

// Saldo com 6 casas (precisão do Omie) como chave, para comparar sem erro de ponto flutuante.
const chave = (v: number) => Math.round(v * 1e6)
const antes = (r: MovCadeia) => chave(Number(r.saldo_apos ?? 0) - Number(r.quantidade))
const depois = (r: MovCadeia) => chave(Number(r.saldo_apos ?? 0))

function contar(vals: number[]): Map<number, number> {
  const m = new Map<number, number>()
  for (const v of vals) m.set(v, (m.get(v) ?? 0) + 1)
  return m
}

const porIdDesc = (a: MovCadeia, b: MovCadeia) => Number(b.id_mov) - Number(a.id_mov)

/**
 * Último movimento do dia na ordem do Omie: o saldo que sobra quando cada "saldo depois" é casado com um "saldo
 * antes" (multiconjunto). Dia que volta ao saldo de abertura (ciclo) não tem saldo que sobra: cai no maior id_mov.
 */
export function fimDoDia<T extends MovCadeia>(dia: T[]): T | null {
  if (!dia.length) return null
  const a = contar(dia.map(antes))
  const d = contar(dia.map(depois))
  const finais = [...d.keys()].filter((v) => (d.get(v) ?? 0) - (a.get(v) ?? 0) === 1)
  const candidatos = finais.length === 1 ? dia.filter((r) => depois(r) === finais[0]) : dia
  return [...candidatos].sort(porIdDesc)[0]
}

/** Primeiro movimento do dia na ordem do Omie (o saldo antes dele é o saldo de abertura). Ciclo: menor id_mov. */
export function inicioDoDia<T extends MovCadeia>(dia: T[]): T | null {
  if (!dia.length) return null
  const a = contar(dia.map(antes))
  const d = contar(dia.map(depois))
  const iniciais = [...a.keys()].filter((v) => (a.get(v) ?? 0) - (d.get(v) ?? 0) === 1)
  const candidatos = iniciais.length === 1 ? dia.filter((r) => antes(r) === iniciais[0]) : dia
  return [...candidatos].sort((x, y) => -porIdDesc(x, y))[0]
}

/**
 * Movimentos de um mesmo produto+local+dia na ordem do Omie: começa no início da cadeia e segue pelo movimento cujo
 * saldo antes é o saldo depois do anterior. Se a cadeia não fecha (movimento faltando ou cancelado), o resto vai por id_mov.
 */
export function ordenarCadeia<T extends MovCadeia>(dia: T[]): T[] {
  const resto = [...dia].sort((x, y) => -porIdDesc(x, y))
  const out: T[] = []
  let atual = inicioDoDia(resto)
  while (atual) {
    out.push(atual)
    resto.splice(resto.indexOf(atual), 1)
    const saldo = depois(atual)
    atual = resto.find((r) => antes(r) === saldo) ?? null
  }
  return [...out, ...resto]
}

type LinhaPagina = MovCadeia & { n_cod_prod: number | string; codigo_local_estoque: number | string; data_mov: string }

/**
 * Página do kardex na ordem de tela (mais novo primeiro): dentro de cada produto+local+dia os movimentos passam para a
 * ordem do Omie (o último da cadeia primeiro), ocupando as mesmas posições; linhas de outros produtos não mudam de lugar.
 * Dia cortado entre duas páginas é reordenado só com o que veio nesta.
 */
export function reordenarPagina<T extends LinhaPagina>(pagina: T[]): T[] {
  const grupos = new Map<string, number[]>()
  pagina.forEach((r, i) => {
    const k = `${r.n_cod_prod}|${r.codigo_local_estoque}|${r.data_mov}`
    grupos.set(k, [...(grupos.get(k) ?? []), i])
  })
  const out = [...pagina]
  for (const posicoes of grupos.values()) {
    if (posicoes.length < 2) continue
    const ordem = ordenarCadeia(posicoes.map((i) => pagina[i])).reverse()
    posicoes.forEach((pos, j) => { out[pos] = ordem[j] })
  }
  return out
}
