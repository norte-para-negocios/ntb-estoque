// Norte Cozinha, lista de compras completa (PURO, node --test).
// Disponível = saldo (negativo conta como zero) − reservado para eventos confirmados + o que já está pedido e não chegou.
// Entra na lista quem: está abaixo do mínimo, OU não cobre o consumo dos próximos N dias, OU não cobre as reservas.
// Quanto comprar: até o mínimo + o consumo de N dias (sem consumo conhecido, mínimo + metade do mínimo), menos o disponível.
// @ts-expect-error: o node --test (type stripping) exige a extensão .ts; o tsc do Next não a aceita
import { arredondarCompra, quantidadeTexto, type GrupoCompra } from './insumos-puro.ts'

export type MotivoCompra = 'reserva' | 'minimo' | 'consumo'
export const NOME_MOTIVO: Record<MotivoCompra, string> = {
  reserva: 'não cobre os eventos',
  minimo: 'abaixo do mínimo',
  consumo: 'não cobre o consumo',
}

export type EntradaSugestao = {
  saldo: number
  minimo: number
  unidade: string | null
  /** Consumo médio por dia (null = desconhecido). */
  consumoPorDia: number | null
  diasCobertura: number
  /** Reservado para eventos confirmados (0 = nada). */
  reservado: number
  /** Já pedido ao fornecedor e ainda não recebido. */
  jaPedido: number
}

export type Sugestao = { quantidade: number; disponivel: number; alvo: number; motivo: MotivoCompra | null }

const EPS = 1e-9

export function sugestaoDeCompra(e: EntradaSugestao): Sugestao {
  const reservado = Math.max(e.reservado, 0)
  const jaPedido = Math.max(e.jaPedido, 0)
  const minimo = Math.max(e.minimo, 0)
  const disponivel = Math.max(e.saldo, 0) - reservado + jaPedido
  const consumo = e.consumoPorDia != null && e.consumoPorDia > 0 ? e.consumoPorDia * Math.max(e.diasCobertura, 0) : 0
  const motivo: MotivoCompra | null =
    disponivel < -EPS ? 'reserva'
      : minimo > 0 && disponivel < minimo - EPS ? 'minimo'
        : consumo > 0 && disponivel < consumo - EPS ? 'consumo'
          : null
  const alvo = minimo + (consumo > 0 ? consumo : minimo * 0.5)
  if (!motivo) return { quantidade: 0, disponivel, alvo, motivo: null }
  // Reserva sem mínimo nem consumo: compra só o que falta para os eventos.
  const quantidade = arredondarCompra(Math.max(alvo, 0) - disponivel, e.unidade)
  return { quantidade, disponivel, alvo, motivo: quantidade > 0 ? motivo : null }
}

/** Pedidos de compra em aberto → quanto falta chegar por produto (quantidade na unidade do estoque menos o que já está em nota). */
export function jaPedidoPorProduto(itens: { codigoProduto: number; quantidadeBase: number; vinculado: number }[]): Map<number, number> {
  const m = new Map<number, number>()
  for (const i of itens) {
    const falta = Math.max(Number(i.quantidadeBase) - Number(i.vinculado), 0)
    if (falta > EPS) m.set(i.codigoProduto, Math.round(((m.get(i.codigoProduto) ?? 0) + falta) * 1e6) / 1e6)
  }
  return m
}

/** Texto de um fornecedor para o WhatsApp, com saudação. */
export function mensagemFornecedor(g: GrupoCompra, loja: string | null): string {
  const t = [`Olá! Segue o pedido${loja ? ` da ${loja}` : ''}:`, '']
  for (const i of g.itens) t.push(`- ${quantidadeTexto(i.quantidade, i.unidade)} de ${i.descricao}`)
  t.push('', 'Obrigado!')
  return t.join('\n')
}
