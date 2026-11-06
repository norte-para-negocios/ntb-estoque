// Contas a receber geradas pelas vendas do Norte Vendas (Fase 4, passo 3; migration 380). Regras puras, sem banco e sem
// imports: espelham fin_cr_forma_do_pagamento, fin_cr_somar_dias e a conta da taxa em fin_receber_vendas_previa. O banco é
// a fonte da verdade; isto serve à tela (prévia, validação) e ao cron (janela). Quem muda um muda o outro.

export const FORMAS_RECEBIMENTO = ['credito', 'debito', 'pix', 'dinheiro', 'app_entrega', 'voucher', 'outros'] as const
export type FormaRecebimento = (typeof FORMAS_RECEBIMENTO)[number]

export const ROTULO_FORMA: Record<FormaRecebimento, string> = {
  credito: 'Cartão de crédito',
  debito: 'Cartão de débito',
  pix: 'PIX',
  dinheiro: 'Dinheiro',
  app_entrega: 'Apps de entrega',
  voucher: 'Vale-refeição (voucher)',
  outros: 'Outras formas',
}

// Vale-refeição entra no caixa do Vendas como cartão com bandeira de vale (CARD_BRAND_LABELS / VALE_BRANDS do Vendas).
const BANDEIRAS_VOUCHER = new Set(['alelo', 'sodexo', 'ticket', 'vr'])
// Nomes que o Vendas ainda NÃO manda (hoje: CREDIT, DEBIT, PIX, CASH; COURTESY não chega ao Estoque). Ficam prontos.
const METODOS_VOUCHER = new Set(['VOUCHER', 'MEAL_VOUCHER', 'FOOD_VOUCHER', 'VALE', 'VR', 'VA'])
const METODOS_APP = new Set(['APP', 'APP_ENTREGA', 'DELIVERY_APP', 'IFOOD', 'RAPPI', 'AIQFOME', '99FOOD', 'KEETA'])

/** Pagamento do Vendas (metodo + bandeira) → forma de recebimento. Desconhecido = 'outros' (o valor nunca some). */
export function formaDoPagamento(metodo: string | null | undefined, bandeira: string | null | undefined): FormaRecebimento {
  const m = String(metodo ?? '').trim().toUpperCase()
  const b = String(bandeira ?? '').trim().toLowerCase()
  if ((m === 'CREDIT' || m === 'DEBIT') && BANDEIRAS_VOUCHER.has(b)) return 'voucher'
  if (m === 'CREDIT') return 'credito'
  if (m === 'DEBIT') return 'debito'
  if (m === 'PIX') return 'pix'
  if (m === 'CASH') return 'dinheiro'
  if (METODOS_VOUCHER.has(m)) return 'voucher'
  if (METODOS_APP.has(m)) return 'app_entrega'
  return 'outros'
}

const paraData = (iso: string) => new Date(`${iso}T12:00:00Z`)
const paraISO = (d: Date) => d.toISOString().slice(0, 10)

/** Data + prazo. Dias úteis = segunda a sexta (sem feriado). Prazo 0 = o próprio dia. */
export function somarDias(dataISO: string, dias: number, uteis: boolean): string {
  const d = paraData(dataISO)
  if (!uteis) { d.setUTCDate(d.getUTCDate() + dias); return paraISO(d) }
  let n = 0
  while (n < dias) {
    d.setUTCDate(d.getUTCDate() + 1)
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) n++
  }
  return paraISO(d)
}

// round() do numeric do Postgres: meio para longe do zero. Trabalha em décimos de milésimo de centavo para não herdar o erro do float.
function round2(v: number): number {
  const escalado = Math.round(Math.abs(v) * 1e6) / 1e4 // centavos com 2 casas extras, já sem o ruído do float
  return Math.sign(v) * Math.round(escalado) / 100
}

/** Taxa = bruto × % + taxa fixa × nº de pagamentos, arredondada a 2 casas e nunca maior que o bruto. */
export function calcularPrevisto(p: { bruto: number; quantidade: number; taxaPercentual: number; taxaFixa: number }): { taxa: number; liquido: number } {
  const taxa = Math.min(round2(p.bruto * p.taxaPercentual / 100 + p.taxaFixa * p.quantidade), p.bruto)
  return { taxa, liquido: round2(p.bruto - taxa) }
}

/** Teto da função SQL fin_receber_vendas_gerar (de..ate com no máximo 93 dias). */
export const MAX_DIAS_GERACAO = 92

/** Janela do cron: últimos `dias` dias até hoje (vendas reenviadas/canceladas depois do dia ainda entram). */
export function janelaGeracao(hojeISO: string, dias: number): { de: string; ate: string } {
  const n = Math.min(Math.max(0, Math.trunc(Number.isFinite(dias) ? dias : 0)), MAX_DIAS_GERACAO)
  return { de: somarDias(hojeISO, -n, false), ate: hojeISO }
}

export type StatusReceber = 'aberto' | 'recebido' | 'cancelado'
export type SituacaoReceber = StatusReceber | 'atrasado'

export function situacaoReceber(status: StatusReceber, dataPrevista: string, hojeISO: string): SituacaoReceber {
  if (status === 'aberto' && dataPrevista < hojeISO) return 'atrasado'
  return status
}

export const ROTULO_SITUACAO_RECEBER: Record<SituacaoReceber, string> = {
  aberto: 'A receber', atrasado: 'Atrasado', recebido: 'Recebido', cancelado: 'Cancelado',
}

/** Mesmas regras dos checks de fin_formas_recebimento. Devolve a mensagem de erro ou null. */
export function validarFormaRecebimento(f: { forma: string; taxaPercentual: number; taxaFixa: number; prazoDias: number }): string | null {
  if (!(FORMAS_RECEBIMENTO as readonly string[]).includes(f.forma)) return 'Forma de recebimento inválida.'
  if (!Number.isFinite(f.taxaPercentual) || f.taxaPercentual < 0 || f.taxaPercentual >= 100) return 'A taxa (%) precisa ficar entre 0 e 99,99.'
  if (!Number.isFinite(f.taxaFixa) || f.taxaFixa < 0) return 'A taxa fixa não pode ser negativa.'
  if (!Number.isInteger(f.prazoDias) || f.prazoDias < 0 || f.prazoDias > 400) return 'O prazo precisa ser um número inteiro de 0 a 400 dias.'
  return null
}
