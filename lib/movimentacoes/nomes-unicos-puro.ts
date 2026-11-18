// F-14: a loja 19 tem 5 famílias com o mesmo nome (duas linhas em `familias`); o filtro de família de /movimentacoes usa o nome
// como valor e como `key` da opção, então o React acusava "dois filhos com a mesma chave". O filtro é por NOME: a lista deve ter
// cada nome uma vez só.
export function nomesUnicos(nomes: (string | null | undefined)[]): string[] {
  const vistos = new Set<string>()
  const out: string[] = []
  for (const n of nomes) {
    const t = (n ?? '').trim()
    if (!t || vistos.has(t)) continue
    vistos.add(t)
    out.push(t)
  }
  return out
}
