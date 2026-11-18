// F-07 (Sertão): a tela Estoque esconde produto inativo; os que ainda têm saldo (ex.: VODKA SMIRNOFF 1L, Brócolis) sumiam da
// lista e dos indicadores sem nenhum aviso. Puro: resume o que ficou escondido para a tela avisar (quantidade, valor e exemplos).
export type LinhaInativa = { codigo: string; descricao: string; unidade: string; saldo: number; valor: number }
export type ResumoInativos = { quantidade: number; valor: number; exemplos: LinhaInativa[] }

export function resumirInativosComSaldo(linhas: LinhaInativa[]): ResumoInativos | null {
  const com = linhas.filter((x) => x.saldo !== 0)
  if (!com.length) return null
  const valor = Math.round(com.reduce((a, x) => a + x.valor, 0) * 100) / 100
  const exemplos = [...com].sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor) || Math.abs(b.saldo) - Math.abs(a.saldo)).slice(0, 5)
  return { quantidade: com.length, valor, exemplos }
}
