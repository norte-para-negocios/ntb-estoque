// Fase F: parâmetros do pacote do contador (mês e data do Bloco H). Sem imports: node --test lib/contador/params-puro.test.ts

/** Mês padrão = o mês passado; data do Bloco H padrão = último dia do mês escolhido. Mês atual ou futuro não vale. */
export function lerParamsPacote(sp: { mes?: string | null; data?: string | null }, hojeISO: string): { mes: string; data: string } | { error: string } {
  const [ha, hm] = hojeISO.slice(0, 7).split('-').map(Number)
  const passado = hm === 1 ? `${ha - 1}-12` : `${ha}-${String(hm - 1).padStart(2, '0')}`
  const mes = (sp.mes ?? '').trim() || passado
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return { error: 'Mês inválido.' }
  if (mes >= hojeISO.slice(0, 7)) return { error: 'Escolha um mês que já terminou.' }
  const [a, m] = mes.split('-').map(Number)
  const ultimo = `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`
  const data = (sp.data ?? '').trim() || ultimo
  const d = data.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const valida = !!d && new Date(Date.UTC(+d[1], +d[2] - 1, +d[3])).toISOString().slice(0, 10) === data
  if (!valida) return { error: 'Data do inventário inválida.' }
  if (data > hojeISO) return { error: 'A data do inventário não pode ser futura.' }
  return { mes, data }
}
