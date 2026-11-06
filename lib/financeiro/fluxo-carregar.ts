import { hojeBahiaISO } from '@/lib/data-bahia'
import { entradaFluxo } from '@/lib/financeiro/dados'
import { montarFluxo, type Agrupar, type Fluxo } from '@/lib/financeiro/fluxo-caixa-puro'

// Fluxo de caixa: lê os filtros da URL e monta o fluxo (tela /financeiro/fluxo-caixa e exportação para Excel).
// Chamar depois de acessoFinanceiro(PERM.contasCorrentes).
export const LIMITE_FLUXO: Record<Agrupar, number> = { dia: 92, semana: 400, mes: 731 }
export type FiltroFluxo = { de?: string; ate?: string; por?: string }

const somaDias = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

export async function carregarFluxo(lojaId: number, sp: FiltroFluxo) {
  const hoje = hojeBahiaISO()
  const data = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
  const por: Agrupar = sp.por === 'dia' || sp.por === 'mes' ? sp.por : 'semana'
  const de = data(sp.de) ?? `${hoje.slice(0, 7)}-01`
  let ate = data(sp.ate) ?? somaDias(hoje, 30)
  let cortado = false
  if (ate < de) ate = de
  if (diasEntre(de, ate) > LIMITE_FLUXO[por]) { ate = somaDias(de, LIMITE_FLUXO[por]); cortado = true }

  let erro: string | null = null
  let fluxo: Fluxo | null = null
  let avisos: string[] = []
  const inicio = Date.now()
  try {
    const r = await entradaFluxo(lojaId, de, ate, hoje, por)
    fluxo = montarFluxo(r.entrada)
    avisos = [...r.avisos, ...fluxo.avisos]
  } catch (e) {
    erro = e instanceof Error ? e.message : 'Não foi possível montar o fluxo de caixa.'
  }
  console.info(`financeiro/fluxo-caixa: loja ${lojaId} ${de}..${ate} por ${por} em ${Date.now() - inicio} ms`)
  return { hoje, por, de, ate, cortado, erro, fluxo, avisos }
}
