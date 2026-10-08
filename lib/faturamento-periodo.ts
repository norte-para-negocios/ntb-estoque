// Periodo do painel de Faturamento (puro). Datas 'YYYY-MM-DD'; mes 'YYYY-MM'.

export type Atalho = 'hoje' | 'ontem' | '7dias' | 'mes' | 'mes_passado' | 'ano'
export const ATALHOS: { value: Atalho; label: string }[] = [
  { value: 'hoje', label: 'Hoje' },
  { value: 'ontem', label: 'Ontem' },
  { value: '7dias', label: '7 dias' },
  { value: 'mes', label: 'Este mês' },
  { value: 'mes_passado', label: 'Mês passado' },
  { value: 'ano', label: 'Ano' },
]
export const MAX_DIAS = 366

const ISO = /^\d{4}-\d{2}-\d{2}$/
const MES = /^\d{4}-(0[1-9]|1[0-2])$/
const pad = (n: number) => String(n).padStart(2, '0')

export function addDias(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function mesVizinho(mes: string, delta: number): string {
  const [a, m] = mes.split('-').map(Number)
  const d = new Date(Date.UTC(a, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`
}

export function periodoDoMes(mes: string, hoje: string): { ini: string; fim: string } {
  const [a, m] = mes.split('-').map(Number)
  const ultimo = `${mes}-${pad(new Date(Date.UTC(a, m, 0)).getUTCDate())}`
  return { ini: `${mes}-01`, fim: ultimo > hoje ? hoje : ultimo }
}

export function periodoDoAtalho(a: Atalho, hoje: string): { ini: string; fim: string } {
  if (a === 'hoje') return { ini: hoje, fim: hoje }
  if (a === 'ontem') { const d = addDias(hoje, -1); return { ini: d, fim: d } }
  if (a === '7dias') return { ini: addDias(hoje, -6), fim: hoje }
  if (a === 'mes') return periodoDoMes(hoje.slice(0, 7), hoje)
  if (a === 'mes_passado') return periodoDoMes(mesVizinho(hoje.slice(0, 7), -1), hoje)
  return { ini: `${hoje.slice(0, 4)}-01-01`, fim: hoje }
}

export function nomeMes(mes: string): string {
  const s = new Date(`${mes}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return (s.charAt(0).toUpperCase() + s.slice(1)).replace(' de ', ' ')
}

export function lerPeriodo(sp: { ini?: string; fim?: string; mes?: string }, hoje: string): { ini: string; fim: string; cortado: boolean } {
  const padrao = periodoDoMes(hoje.slice(0, 7), hoje)
  let p = padrao
  if (sp.ini && ISO.test(sp.ini) && sp.ini <= hoje) {
    const fim = sp.fim && ISO.test(sp.fim) ? (sp.fim > hoje ? hoje : sp.fim) : hoje
    p = fim >= sp.ini ? { ini: sp.ini, fim } : padrao
  } else if (sp.mes && MES.test(sp.mes) && sp.mes <= hoje.slice(0, 7)) {
    p = periodoDoMes(sp.mes, hoje)
  }
  const minIni = addDias(p.fim, -(MAX_DIAS - 1))
  return p.ini < minIni ? { ini: minIni, fim: p.fim, cortado: true } : { ...p, cortado: false }
}
