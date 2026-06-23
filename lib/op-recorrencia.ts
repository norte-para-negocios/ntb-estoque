// Recorrência da OP: unidade, intervalo, geração de datas e descrição. Módulo PURO
// (sem 'use client') para poder ser importado tanto pelo modal (client) quanto pela
// página nova (server) — importar um VALOR de um módulo 'use client' num Server
// Component devolve um client-reference proxy (undefined ao indexar), por isso fica aqui.
//
// Modelo: "repetir A CADA <intervalo> <unidade>, <vezes> vezes". Cobre tudo que o
// cliente pediu: todo dia (dia/1), de 15 em 15 dias (dia/15), a cada 2/3/4 semanas
// (semana/2..4), todo mês (mes/1), a cada N meses (mes/N).

export type UnidadeOP = 'nao' | 'dia' | 'semana' | 'mes'

export const UNIDADE_OP_LABEL: Record<UnidadeOP, string> = {
  nao: 'Não repetir',
  dia: 'Dia(s)',
  semana: 'Semana(s)',
  mes: 'Mês(es)',
}

export const UNIDADE_OP_VALIDAS: UnidadeOP[] = ['dia', 'semana', 'mes']

const norm = (base: string) => {
  const [a, m, d] = base.split('-').map(Number)
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// Datas a partir da base, repetindo a cada `intervalo` `unidade`, `vezes` no total.
// Mês mantém o mesmo dia com clamp no último dia do mês (31/01 +1mês -> 28/02).
export function gerarDatasOP(base: string, unidade: UnidadeOP, intervalo: number, vezes: number): string[] {
  if (!base) return []
  if (unidade === 'nao') return [norm(base)]
  const n = Math.max(1, Math.min(60, Math.floor(vezes) || 1))
  const passo = Math.max(1, Math.min(60, Math.floor(intervalo) || 1))
  const [a, m, d] = base.split('-').map(Number)
  const iso = (dt: Date) =>
    `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    let dt: Date
    if (unidade === 'dia') dt = new Date(a, m - 1, d + i * passo)
    else if (unidade === 'semana') dt = new Date(a, m - 1, d + i * passo * 7)
    else {
      const alvo = new Date(a, m - 1 + i * passo, 1)
      const ultimoDia = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate()
      dt = new Date(alvo.getFullYear(), alvo.getMonth(), Math.min(d, ultimoDia))
    }
    out.push(iso(dt))
  }
  return out
}

// Texto curto para o resumo: "todo dia, 4×", "a cada 2 semanas, 6×", "todo mês, 3×".
export function descreverRecorrenciaOP(unidade: UnidadeOP, intervalo: number, vezes: number): string {
  if (unidade === 'nao') return 'não repete'
  const i = Math.max(1, Math.floor(intervalo) || 1)
  const unidadeSing = unidade === 'dia' ? 'dia' : unidade === 'semana' ? 'semana' : 'mês'
  const unidadePlur = unidade === 'dia' ? 'dias' : unidade === 'semana' ? 'semanas' : 'meses'
  const cadencia = i === 1 ? `todo ${unidadeSing === 'mês' ? 'mês' : unidadeSing}` : `a cada ${i} ${unidadePlur}`
  return `${cadencia}, ${vezes}×`
}
