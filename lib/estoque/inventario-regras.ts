// Regras puras do inventário/reposição do estoque próprio (sem banco, testáveis).

export type ClasseAbc = 'A' | 'B' | 'C'

/** "1.234,5" / "1,5" / "2.5" -> número; vazio ou inválido -> null. Contagem nunca é negativa. */
export function lerQuantidade(texto: string | number | null | undefined): number | null {
  if (texto == null) return null
  if (typeof texto === 'number') return Number.isFinite(texto) && texto >= 0 ? texto : null
  const t = texto.trim()
  if (!t) return null
  // Formato brasileiro (vírgula decimal, ponto de milhar) ou ponto decimal simples.
  const normal = /,/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t
  const n = Number(normal)
  return Number.isFinite(n) && n >= 0 ? n : null
}

export type ItemContagem = { contado: number | null }

export function progressoContagem(itens: ItemContagem[]): { total: number; contados: number; pct: number } {
  const total = itens.length
  const contados = itens.filter((i) => i.contado != null).length
  return { total, contados, pct: total ? Math.round((contados / total) * 100) : 0 }
}

export type LinhaVariancia = { delta: number; valorDelta: number; exigeMotivo: boolean; motivo: string | null }

export function resumirVariancia(linhas: LinhaVariancia[]) {
  const comDiferenca = linhas.filter((l) => l.delta !== 0)
  return {
    contados: linhas.length,
    comDiferenca: comDiferenca.length,
    sobras: comDiferenca.filter((l) => l.delta > 0).reduce((a, l) => a + l.valorDelta, 0),
    faltas: comDiferenca.filter((l) => l.delta < 0).reduce((a, l) => a + l.valorDelta, 0),
    liquido: comDiferenca.reduce((a, l) => a + l.valorDelta, 0),
    semMotivo: comDiferenca.filter((l) => l.exigeMotivo && !(l.motivo ?? '').trim()).length,
  }
}

export function podeFechar(linhas: LinhaVariancia[]): boolean {
  return linhas.length > 0 && resumirVariancia(linhas).semMotivo === 0
}

export const ROTULO_CLASSE: Record<ClasseAbc, string> = {
  A: 'Curva A — os itens que mais giram em valor (conte toda semana)',
  B: 'Curva B — giro médio (conte todo mês)',
  C: 'Curva C — giro baixo (conte a cada 3 meses)',
}

/** Escapa um campo de CSV (ponto e vírgula, padrão do Excel brasileiro). */
export function campoCsv(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v)
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function linhaCsv(campos: (string | number | null | undefined)[]): string {
  return campos.map(campoCsv).join(';')
}

export function numeroCsv(n: number, casas = 3): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas, useGrouping: false })
}
