// Gabarito do pedido de compra (ticket 07): conta independente, SÓ função pura (sem banco, navegador nem código do ERP).
// Regra em palavras: etapas gravadas rascunho -> aguardando aprovação -> aprovado -> cancelado; "recebido" (parcial ou
// total) só existe quando há nota lançada no estoque; pedido recebido por completo não se cancela.
import { parseDec, fmtDec } from './saldo-gabarito.ts'
import { arredondarTexto } from './custo-gabarito.ts'

const UM = 10n ** 9n

/** Total do pedido = soma(quantidade x preço) arredondada em centavos + frete + outras despesas. */
export function totalPedido(itens: { quantidade: string; preco: string }[], frete: string, outras: string): string {
  const merc = itens.reduce((a, i) => a + parseDec(i.quantidade) * parseDec(i.preco) / UM, 0n)
  return fmtDec(parseDec(arredondarTexto(fmtDec(merc), 2)) + parseDec(frete) + parseDec(outras))
}

export type EtapaGravada = 'rascunho' | 'aguardando_aprovacao' | 'aprovado' | 'cancelado'
export type Acao = 'enviar' | 'aprovar' | 'reprovar' | 'reabrir' | 'cancelar'

export function proximaEtapa(etapa: EtapaGravada, acao: Acao, o: { temNota?: boolean; recebidoTotal?: boolean } = {}): { ok: true; etapa: EtapaGravada } | { ok: false; motivo: string } {
  const recusa = (motivo: string) => ({ ok: false as const, motivo })
  if (acao === 'enviar') return etapa === 'rascunho' ? { ok: true, etapa: 'aguardando_aprovacao' } : recusa('enviar só vale em rascunho')
  if (acao === 'aprovar') return etapa === 'rascunho' || etapa === 'aguardando_aprovacao' ? { ok: true, etapa: 'aprovado' } : recusa('aprovar só vale em rascunho ou aguardando')
  if (acao === 'reprovar') return etapa === 'aguardando_aprovacao' ? { ok: true, etapa: 'rascunho' } : recusa('reprovar só vale aguardando aprovação')
  if (acao === 'reabrir') {
    if (etapa !== 'aprovado') return recusa('reabrir só vale em pedido aprovado')
    return o.temNota ? recusa('pedido com nota vinculada não reabre') : { ok: true, etapa: 'rascunho' }
  }
  if (etapa === 'cancelado') return recusa('pedido já cancelado')
  if (o.recebidoTotal) return recusa('pedido recebido por completo não se cancela')
  return { ok: true, etapa: 'cancelado' }
}

export type NotaItemPedido = { indice: number; quantidade: string; fator: string }
export type ResultadoRecebimento = {
  etapaExibida: 'aprovado' | 'recebido_parcial' | 'recebido'; recebidoTotal: boolean
  itens: { pedidoBase: string; recebido: string; falta: string }[]
}

/** Recebimento de um pedido APROVADO: cada nota lançada traz itens (indice do item do pedido, quantidade, fator). Tudo em unidade de estoque. */
export function recebimento(pedido: { quantidade: string; fator: string }[], notasLancadas: NotaItemPedido[][]): ResultadoRecebimento {
  const itens = pedido.map((p, i) => {
    const base = parseDec(p.quantidade) * parseDec(p.fator) / UM
    const rec = notasLancadas.flat().filter((n) => n.indice === i).reduce((a, n) => a + parseDec(n.quantidade) * parseDec(n.fator) / UM, 0n)
    const falta = base > rec ? base - rec : 0n
    return { base, rec, pedidoBase: fmtDec(base), recebido: fmtDec(rec), falta: fmtDec(falta) }
  })
  const total = itens.length > 0 && itens.every((i) => i.rec >= i.base)
  const algum = itens.some((i) => i.rec > 0n)
  return {
    etapaExibida: total ? 'recebido' : algum ? 'recebido_parcial' : 'aprovado', recebidoTotal: total,
    itens: itens.map(({ pedidoBase, recebido, falta }) => ({ pedidoBase, recebido, falta })),
  }
}

/** Conferência pedido x nota de um item: o que a nota trouxe contra o que o pedido esperava. */
export function situacaoNaNota(esperado: string, naNota: string | null): 'ok' | 'falta' | 'excede' | 'nao_veio' {
  if (naNota === null) return 'nao_veio'
  const e = parseDec(esperado), n = parseDec(naNota)
  return n === e ? 'ok' : n < e ? 'falta' : 'excede'
}
