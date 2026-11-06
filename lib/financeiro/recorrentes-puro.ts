// Regras puras das CONTAS RECORRENTES (migration 370). Espelham fin_recorrente_datas e fin_recorrente_salvar.
// Datas sempre YYYY-MM-DD (dia civil, sem fuso).

export type Periodicidade = 'mensal' | 'semanal'
export type Recorrencia = { periodicidade: Periodicidade; dia: number; inicio: string; fim: string | null }

const DIAS_SEMANA = ['', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado', 'domingo']
const DATA = /^\d{4}-\d{2}-\d{2}$/

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`)
const iso = (d: Date) => d.toISOString().slice(0, 10)
const ultimoDia = (ano: number, mes0: number) => new Date(Date.UTC(ano, mes0 + 1, 0)).getUTCDate()

/** Vencimentos da recorrência dentro de [de, ate] (inclusive), respeitando início e fim. Mensal: dia 29–31 em mês curto = último dia. */
export function datasRecorrencia(r: Recorrencia, de: string, ate: string): string[] {
  const ini = de > r.inicio ? de : r.inicio
  const fim = r.fim && r.fim < ate ? r.fim : ate
  if (ini > fim) return []
  const out: string[] = []
  if (r.periodicidade === 'semanal') {
    const d = utc(ini)
    const dow = ((d.getUTCDay() + 6) % 7) + 1 // ISO: 1 = segunda … 7 = domingo
    d.setUTCDate(d.getUTCDate() + ((r.dia - dow + 7) % 7))
    for (; iso(d) <= fim; d.setUTCDate(d.getUTCDate() + 7)) out.push(iso(d))
    return out
  }
  const a = utc(ini)
  for (let ano = a.getUTCFullYear(), mes = a.getUTCMonth(); ; mes++) {
    if (mes > 11) { mes = 0; ano++ }
    const d = iso(new Date(Date.UTC(ano, mes, Math.min(r.dia, ultimoDia(ano, mes)))))
    if (d > fim) break
    if (d >= ini) out.push(d)
  }
  return out
}

export function validarRecorrente(r: {
  descricao: string; fornecedorId: number; valorCent: number; periodicidade: Periodicidade; dia: number; inicio: string; fim: string | null
}): string | null {
  if (r.descricao.trim().length < 2) return 'Informe a descrição (ex.: Aluguel).'
  if (!(r.fornecedorId > 0)) return 'Escolha o fornecedor.'
  if (!(r.valorCent > 0)) return 'Informe um valor maior que zero.'
  if (r.periodicidade === 'mensal' && !(Number.isInteger(r.dia) && r.dia >= 1 && r.dia <= 31)) return 'O dia do vencimento vai de 1 a 31.'
  if (r.periodicidade === 'semanal' && !(Number.isInteger(r.dia) && r.dia >= 1 && r.dia <= 7)) return 'Escolha o dia da semana do vencimento.'
  if (!DATA.test(r.inicio)) return 'Informe o início.'
  if (r.fim && (!DATA.test(r.fim) || r.fim < r.inicio)) return 'O fim não pode ser antes do início.'
  return null
}

export function rotuloPeriodicidade(p: Periodicidade, dia: number): string {
  if (p === 'semanal') return `Toda semana, ${DIAS_SEMANA[dia] ?? `dia ${dia}`}`
  return dia >= 29 ? `Todo mês, dia ${dia} (ou o último dia)` : `Todo mês, dia ${dia}`
}

export const OPCOES_DIA_SEMANA = DIAS_SEMANA.slice(1).map((label, i) => ({ value: i + 1, label }))
