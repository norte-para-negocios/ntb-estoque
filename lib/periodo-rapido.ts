// lib/periodo-rapido.ts
// Chips de atalho de período (Este mês/3 meses/6 meses/Ano passado) para as
// telas de relatório que já têm data_inicio/data_final na gaveta mas nenhum
// atalho visível fora dela. Cada chip carrega um par de datas prontas (não
// um enum) -- o clique escreve os MESMOS 2 params que a gaveta já usa, sem
// introduzir um searchParam novo por página.
import { hojeBahiaISO } from '@/lib/data-bahia'

export type ChipPeriodoOpcao = { value: string; label: string; dataIni: string; dataFim: string }

function primeiroDiaMesAtras(hoje: string, meses: number): string {
  const [ano, mes] = hoje.slice(0, 7).split('-').map(Number)
  let a = ano
  let m = mes - meses
  while (m < 1) { m += 12; a-- }
  return `${a}-${String(m).padStart(2, '0')}-01`
}

/**
 * Gera os 4 chips padrão (Este mês / 3 meses / 6 meses / Ano passado),
 * relativos a hoje (America/Bahia). `extra`, quando informado, é
 * PREPENDADO à lista -- cada tela usa isso pro seu próprio chip de default
 * (ex.: {value:'', label:'Ano corrente', dataIni:'2026-01-01', dataFim:hoje}
 * ou {value:'', label:'Tudo', dataIni:'', dataFim:''} quando a tela não tem
 * piso nenhum por padrão).
 */
export function chipsPeriodoPadrao(extra?: ChipPeriodoOpcao): ChipPeriodoOpcao[] {
  const hoje = hojeBahiaISO()
  const anoAtual = Number(hoje.slice(0, 4))
  const chips: ChipPeriodoOpcao[] = [
    { value: 'mes', label: 'Este mês', dataIni: primeiroDiaMesAtras(hoje, 0), dataFim: hoje },
    { value: '3m', label: '3 meses', dataIni: primeiroDiaMesAtras(hoje, 2), dataFim: hoje },
    { value: '6m', label: '6 meses', dataIni: primeiroDiaMesAtras(hoje, 5), dataFim: hoje },
    { value: 'ano_passado', label: 'Ano passado', dataIni: `${anoAtual - 1}-01-01`, dataFim: `${anoAtual - 1}-12-31` },
  ]
  if (!extra) return chips
  // Evita 2 chips com o mesmo label visível (ex.: uma tela cujo próprio
  // default também se chama "Este mês") -- remove do array fixo qualquer
  // chip cujo label colida com o do `extra` antes de prependar.
  return [extra, ...chips.filter((c) => c.label !== extra.label)]
}
