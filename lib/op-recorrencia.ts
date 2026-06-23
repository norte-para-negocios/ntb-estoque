// Recorrência da OP: tipo, rótulos e geração de datas. Módulo PURO (sem 'use
// client') para poder ser importado tanto pelo modal (client) quanto pela página
// nova (server) — importar um VALOR de um módulo 'use client' num Server Component
// devolve um client-reference proxy (undefined ao indexar), por isso fica aqui.

export type FreqOP = 'nao' | 'diario' | 'semanal' | 'quinzenal' | 'mensal'

export const FREQ_OP_LABEL: Record<FreqOP, string> = {
  nao: 'Não repetir',
  diario: 'Todo dia',
  semanal: 'Toda semana',
  quinzenal: 'De 15 em 15 dias',
  mensal: 'Todo mês',
}

export const FREQ_OP_VALIDAS: FreqOP[] = ['diario', 'semanal', 'quinzenal', 'mensal']

// Datas a partir da base, repetindo conforme a frequência, `vezes` vezes no total.
// Diário = +1 dia, semanal = +7, quinzenal = +15, mensal = mesmo dia do mês seguinte
// (com clamp no último dia do mês: 31/01 -> 28/02).
export function gerarDatasOP(base: string, freq: FreqOP, vezes: number): string[] {
  if (!base) return []
  const n = freq === 'nao' ? 1 : Math.max(1, Math.min(24, vezes))
  const [a, m, d] = base.split('-').map(Number)
  const iso = (dt: Date) =>
    `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    let dt: Date
    if (freq === 'diario') dt = new Date(a, m - 1, d + i)
    else if (freq === 'semanal') dt = new Date(a, m - 1, d + i * 7)
    else if (freq === 'quinzenal') dt = new Date(a, m - 1, d + i * 15)
    else if (freq === 'mensal') {
      const alvo = new Date(a, m - 1 + i, 1)
      const ultimoDia = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate()
      dt = new Date(alvo.getFullYear(), alvo.getMonth(), Math.min(d, ultimoDia))
    } else dt = new Date(a, m - 1, d)
    out.push(iso(dt))
  }
  return out
}
