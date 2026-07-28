// lib/pendencias-periodo.ts
// Período de 12 meses da tela de Pendências de Classificação -- antes era
// calculado 3 vezes de forma independente (page.tsx + os 2 blocos do
// export/route.ts), sem nenhum jeito do usuário escolher um período
// diferente. Uma função só, parametrizável, usada nos 2 arquivos.
import { hojeBahiaISO } from '@/lib/data-bahia'

export function periodoPendencias(sp: { data_inicio?: string; data_final?: string }): { dataIni: string; dataFim: string } {
  const hojeISO = hojeBahiaISO()
  const dataFimValida = /^\d{4}-\d{2}-\d{2}$/.test(sp.data_final ?? '') ? sp.data_final! : hojeISO
  const dataIniPadrao = `${Number(dataFimValida.slice(0, 4)) - 1}${dataFimValida.slice(4, 10)}`
  const dataIniValida = /^\d{4}-\d{2}-\d{2}$/.test(sp.data_inicio ?? '') ? sp.data_inicio! : dataIniPadrao
  return { dataIni: dataIniValida, dataFim: dataFimValida }
}
