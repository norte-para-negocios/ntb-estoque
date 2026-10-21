// Regras puras do contas a pagar (sem banco, sem imports): espelham as funções SQL da migration 286
// (fin_situacao_titulo, fin_status_titulo, fin_pagamento_registrar). O banco é a fonte da verdade;
// isto serve para validar o formulário antes de enviar e para exibir. Dinheiro em centavos inteiros
// para nunca depender de ponto flutuante.

export type StatusTitulo = 'aberto' | 'parcial' | 'pago' | 'cancelado'
export type SituacaoTitulo = StatusTitulo | 'atrasado'

export const ROTULO_SITUACAO: Record<SituacaoTitulo, string> = {
  aberto: 'Em aberto',
  parcial: 'Pago em parte',
  pago: 'Pago',
  atrasado: 'Atrasado',
  cancelado: 'Cancelado',
}

/**
 * Texto de dinheiro → centavos. NaN se não for um valor claro (nunca adivinha).
 * Vírgula = decimal ("12,5", "1.234,56"); ponto sozinho só é decimal com 1–2 casas ("10.5", "10.50"),
 * senão é milhar ("1.500" = 1500, "R$ 2.000" = 2000). Recusa "1,500.00", "1e3", letras e valores de 1 trilhão para cima.
 */
export function paraCentavos(v: number | string | null | undefined): number {
  if (v == null || v === '') return NaN
  let n: number
  if (typeof v === 'number') n = v
  else {
    const t = v.trim().replace(/^R\$\s*/i, '').replace(/\s+/g, '')
    let norm: string | null = null
    if (/^-?\d{1,3}(\.\d{3})*,\d{1,2}$/.test(t) || /^-?\d+,\d{1,2}$/.test(t)) norm = t.replace(/\./g, '').replace(',', '.')
    else if (/^-?\d+\.\d{1,2}$/.test(t)) norm = t
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(t) || /^-?\d+$/.test(t)) norm = t.replace(/\./g, '')
    if (norm === null) return NaN
    n = Number(norm)
  }
  if (!Number.isFinite(n) || Math.abs(n) >= 1e12) return NaN
  return Math.round(Number((n * 100).toPrecision(15)))
}

/** Prévia "R$ 1.500,00" do que o texto digitado vai valer; null se o texto não for um valor claro (ou estiver vazio). */
export function previaMoeda(texto: string): string | null {
  if (!texto.trim()) return null
  const c = paraCentavos(texto)
  return Number.isNaN(c) ? null : (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export const deCentavos = (c: number): number => c / 100

/** Arredonda para 2 casas (numeric(14,2)). */
export const arredondar2 = (n: number): number => deCentavos(Math.round(Number((n * 100).toPrecision(15))))

/** Status guardado: depende só do valor e do quanto já foi quitado (mesma regra de fin_status_titulo). */
export function statusPorQuitado(valorCent: number, quitadoCent: number): Exclude<StatusTitulo, 'cancelado'> {
  if (quitadoCent <= 0) return 'aberto'
  if (quitadoCent >= valorCent) return 'pago'
  return 'parcial'
}

/** Situação exibida: o status guardado + "atrasado" (vencimento anterior a hoje e ainda com saldo). Datas YYYY-MM-DD. */
export function situacaoTitulo(status: StatusTitulo, vencimento: string, hoje: string): SituacaoTitulo {
  if (status === 'cancelado') return 'cancelado'
  if (status === 'pago') return 'pago'
  if (vencimento < hoje) return 'atrasado'
  return status
}

/** Competência padrão = 1º dia do mês do vencimento. Aceita 'YYYY-MM' ou data completa. */
export function competenciaDe(entrada: string | null | undefined, vencimento: string): string {
  const t = (entrada ?? '').trim()
  if (/^\d{4}-\d{2}$/.test(t)) return `${t}-01`
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return `${t.slice(0, 7)}-01`
  return `${vencimento.slice(0, 7)}-01`
}

export type EntradaPagamento = {
  restanteCent: number
  principalCent: number | null // null = quitar o que falta
  jurosCent: number
  descontoCent: number
}
export type ResultadoPagamento =
  | { ok: true; principalCent: number; pagoCent: number; restanteDepoisCent: number; statusDepois: Exclude<StatusTitulo, 'cancelado'> }
  | { ok: false; erro: string }

/** Confere uma baixa (total ou parcial): principal + juros − desconto sai da conta. */
export function calcularPagamento(e: EntradaPagamento): ResultadoPagamento {
  const principal = e.principalCent ?? e.restanteCent
  if (![principal, e.jurosCent, e.descontoCent, e.restanteCent].every(Number.isFinite)) return { ok: false, erro: 'Valor inválido' }
  if (e.restanteCent <= 0) return { ok: false, erro: 'Título já está pago' }
  if (principal <= 0) return { ok: false, erro: 'O valor do pagamento precisa ser maior que zero' }
  if (principal > e.restanteCent) return { ok: false, erro: 'O valor passa do que falta pagar' }
  if (e.jurosCent < 0 || e.descontoCent < 0) return { ok: false, erro: 'Juros e desconto não podem ser negativos' }
  if (e.descontoCent > principal) return { ok: false, erro: 'O desconto não pode passar do valor quitado' }
  const pago = principal + e.jurosCent - e.descontoCent
  if (pago <= 0) return { ok: false, erro: 'O valor pago (valor + juros − desconto) precisa ser maior que zero' }
  const restanteDepois = e.restanteCent - principal
  return { ok: true, principalCent: principal, pagoCent: pago, restanteDepoisCent: restanteDepois, statusDepois: restanteDepois === 0 ? 'pago' : 'parcial' }
}

/** Estorno de um pagamento: devolve o principal ao título (o dinheiro volta como entrada no extrato). */
export function aplicarEstorno(valorCent: number, quitadoCent: number, principalEstornadoCent: number): { quitadoCent: number; status: Exclude<StatusTitulo, 'cancelado'> } {
  const q = Math.max(0, quitadoCent - principalEstornadoCent)
  return { quitadoCent: q, status: statusPorQuitado(valorCent, q) }
}

/** Cancelar só vale sem pagamento ativo; título já cancelado é idempotente. */
export function podeCancelar(status: StatusTitulo, quitadoCent: number): { ok: boolean; motivo?: string } {
  if (status === 'cancelado') return { ok: true }
  if (quitadoCent > 0) return { ok: false, motivo: 'O título tem pagamento registrado: estorne os pagamentos antes de cancelar' }
  return { ok: true }
}

export const podeEditarDinheiro = (status: StatusTitulo): boolean => status === 'aberto' || status === 'parcial'
export const podePagar = (status: StatusTitulo): boolean => status === 'aberto' || status === 'parcial'

/** Saldo de uma conta: saldo inicial + entradas − saídas, em centavos. */
export function saldoConta(saldoInicialCent: number, lancamentos: { tipo: 'entrada' | 'saida'; valorCent: number }[]): number {
  return lancamentos.reduce((s, l) => s + (l.tipo === 'entrada' ? l.valorCent : -l.valorCent), saldoInicialCent)
}
