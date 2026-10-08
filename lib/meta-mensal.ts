// Funcoes puras da tela "Meta do mes" (sem I/O, sem alias '@/'; testadas direto no node).
// 'mes' e' sempre 'YYYY-MM'; datas 'YYYY-MM-DD'.

export type DiaValor = { dia: string; valor: number }

const round2 = (n: number) => Math.round(n * 100) / 100
const pad = (n: number) => String(n).padStart(2, '0')

export function diasDoMes(mes: string): number {
  const [a, m] = mes.split('-').map(Number)
  return new Date(Date.UTC(a, m, 0)).getUTCDate()
}

export type Semana = { ini: string; fim: string; nDias: number }

// Semanas de segunda a domingo, cortadas no primeiro e no ultimo dia do mes.
export function semanasDoMes(mes: string): Semana[] {
  const [a, m] = mes.split('-').map(Number)
  const total = diasDoMes(mes)
  const out: Semana[] = []
  for (let d = 1; d <= total; ) {
    const dow = new Date(Date.UTC(a, m - 1, d)).getUTCDay() // 0 = domingo
    const nDias = Math.min(7 - ((dow + 6) % 7), total - d + 1)
    out.push({ ini: `${mes}-${pad(d)}`, fim: `${mes}-${pad(d + nDias - 1)}`, nDias })
    d += nDias
  }
  return out
}

export type ResumoMes = {
  diasNoMes: number
  metaDiaria: number
  realizado: number // tudo que ja vendeu no mes, inclusive hoje
  falta: number
  superou: boolean
  pct: number | null
  diasFechados: number // dias do mes antes de hoje
  diasRestantes: number // de hoje ate o fim do mes (hoje conta)
  precisaPorDia: number | null
  media: number | null // media por dia fechado
  projecao: number | null
  esperadoAteOntem: number // metaDiaria x diasFechados
  diferencaRitmo: number // vendido nos dias fechados menos o esperado
  pctEsperado: number // diasFechados / diasNoMes
}

export function resumirMes(p: { mes: string; meta: number; dias: DiaValor[]; hoje: string }): ResumoMes {
  const { mes, meta, hoje } = p
  const diasNoMes = diasDoMes(mes)
  const ate = p.dias.filter((d) => d.dia.slice(0, 7) === mes && d.dia <= hoje)
  const fechados = ate.filter((d) => d.dia < hoje)
  const realizado = round2(ate.reduce((s, d) => s + d.valor, 0))
  const realizadoFechado = round2(fechados.reduce((s, d) => s + d.valor, 0))
  const metaDiaria = round2(meta / diasNoMes)

  // Dias do mes antes de hoje: mes passado = todos; mes futuro = nenhum.
  const diasFechados = hoje.slice(0, 7) > mes ? diasNoMes : hoje.slice(0, 7) < mes ? 0 : Number(hoje.slice(8, 10)) - 1
  const diasRestantes = diasNoMes - diasFechados > 0 && hoje.slice(0, 7) <= mes ? diasNoMes - diasFechados : 0
  const falta = round2(Math.max(0, meta - realizado))
  const media = diasFechados > 0 ? round2(realizadoFechado / diasFechados) : null
  const esperadoAteOntem = round2(metaDiaria * diasFechados)

  return {
    diasNoMes,
    metaDiaria,
    realizado,
    falta,
    superou: realizado >= meta,
    pct: meta > 0 ? round2((realizado / meta) * 100) : null,
    diasFechados,
    diasRestantes,
    precisaPorDia: diasRestantes > 0 ? round2(falta / diasRestantes) : null,
    media,
    projecao: diasFechados === diasNoMes ? realizado : media === null ? null : round2(media * diasNoMes),
    esperadoAteOntem,
    diferencaRitmo: round2(realizadoFechado - esperadoAteOntem),
    pctEsperado: round2((diasFechados / diasNoMes) * 100),
  }
}

export type ResumoSemana = Semana & {
  meta: number
  realizado: number
  pct: number | null
  situacao: 'fechada' | 'andamento' | 'futura'
}

export function resumirSemanas(semanas: Semana[], dias: DiaValor[], metaDiaria: number, hoje: string): ResumoSemana[] {
  return semanas.map((s) => {
    const meta = round2(metaDiaria * s.nDias)
    const realizado = round2(dias.filter((d) => d.dia >= s.ini && d.dia <= s.fim && d.dia <= hoje).reduce((t, d) => t + d.valor, 0))
    return {
      ...s,
      meta,
      realizado,
      pct: meta > 0 ? round2((realizado / meta) * 100) : null,
      situacao: s.fim < hoje ? 'fechada' : s.ini > hoje ? 'futura' : 'andamento',
    }
  })
}

export type ResumoDia = { dia: string; meta: number; realizado: number; pct: number | null; situacao: 'fechada' | 'andamento' | 'futura' }

// Um item por dia do mes (inclusive os que ainda nao chegaram), cada um contra a meta diaria.
export function resumirDiasMes(mes: string, dias: DiaValor[], metaDiaria: number, hoje: string): ResumoDia[] {
  return Array.from({ length: diasDoMes(mes) }, (_, i) => {
    const dia = `${mes}-${pad(i + 1)}`
    const realizado = dia <= hoje ? round2(dias.filter((d) => d.dia === dia).reduce((t, d) => t + d.valor, 0)) : 0
    return {
      dia,
      meta: metaDiaria,
      realizado,
      pct: metaDiaria > 0 ? round2((realizado / metaDiaria) * 100) : null,
      situacao: dia < hoje ? 'fechada' : dia === hoje ? 'andamento' : 'futura',
    }
  })
}
