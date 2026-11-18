// Gabarito do custo médio e do título a pagar da nota de entrada (ticket 04): conta independente, SÓ função pura.
// Não usa função, view nem RPC do ERP. A regra de negócio (lida no ERP só para conferir o que se espera):
//  - custo da entrada por unidade de estoque = (valor líquido do item + parte do (frete - desconto da nota) proporcional
//    ao valor líquido) / (quantidade da nota x fator), arredondado em 6 casas;
//  - custo médio novo = (saldo x custo médio + entrada x custo) / (saldo + entrada), 6 casas; vale o custo da entrada
//    quando o custo médio atual é <= 0, quando o saldo final é 0 ou quando o ponderado dá <= 0; entrada sem custo (0)
//    só soma saldo;
//  - título a pagar (só loja com a chave ligada e entrada lançada): um por duplicata com valor, sem duplicata um no total
//    vencendo na emissão.
// Decimais em BigInt com 9 casas (mesma base do gabarito do saldo). Valores entram e saem como texto decimal.
import { parseDec, fmtDec, type Dec } from './saldo-gabarito.ts'

const UM = 10n ** 9n
const abs = (d: bigint) => (d < 0n ? -d : d)

/** Divisão inteira arredondando para longe do zero na metade (igual ao round() do Postgres). */
function divArred(a: bigint, b: bigint): bigint {
  const neg = (a < 0n) !== (b < 0n)
  const q = (abs(a) * 2n + abs(b)) / (abs(b) * 2n)
  return neg ? -q : q
}
/** Arredonda um valor escalado (9 casas) para `casas` casas decimais. */
function arredondar(v: Dec, casas: number): Dec {
  const passo = 10n ** BigInt(9 - casas)
  return divArred(v, passo) * passo
}

/** Valor decimal arredondado para `casas` casas (meia para longe do zero), como texto. */
export function arredondarTexto(v: string, casas: number): string {
  return fmtDec(arredondar(parseDec(v), casas))
}

export type ItemNota = { quantidade: string; valorUnitario: string; fator: string; desconto?: string; valorTotal?: string }
export type RateioNota = { frete: string; descontoNota: string }

/** Valor do item na nota: informado, ou quantidade x unitário em centavos (como a compra digitada faz). */
function valorBruto(i: ItemNota): Dec {
  return i.valorTotal !== undefined ? parseDec(i.valorTotal) : arredondar(divArred(parseDec(i.quantidade) * parseDec(i.valorUnitario), UM), 2)
}
const liquido = (i: ItemNota): Dec => valorBruto(i) - parseDec(i.desconto ?? '0')

export function custoUnitarioBase(item: ItemNota, itens: ItemNota[], nota: RateioNota): string | null {
  const q = parseDec(item.quantidade) * parseDec(item.fator) / UM // quantidade em unidade de estoque (escala 9)
  if (q <= 0n) return null
  const net = liquido(item)
  const total = itens.reduce((a, i) => a + liquido(i), 0n)
  const fd = parseDec(nota.frete) - parseDec(nota.descontoNota)
  const n = BigInt(Math.max(itens.length, 1))
  // custo em micro-unidades (6 casas), conta exata em frações
  const micro = total > 0n
    ? divArred(net * (total + fd) * 10n ** 6n, total * q)
    : divArred((net * n + fd) * 10n ** 6n, n * q)
  return fmtDec(micro * 1000n)
}

/** Quantidade que entra no estoque: quantidade da nota x fator, em unidade de estoque. */
export function quantidadeBase(item: ItemNota): string {
  return fmtDec(parseDec(item.quantidade) * parseDec(item.fator) / UM)
}

/** Valor em centavos de saldo x custo médio (arredondado), como "valor em estoque" mostra. */
export function valorEmEstoqueCent(saldo: string, cmc: string): bigint {
  return divArred(parseDec(saldo) * parseDec(cmc) / UM, 10n ** 7n)
}

export type Estado = { saldo: string; cmc: string }

export function novoEstado(antes: Estado, quantidade: string, custo: string): Estado {
  const S = parseDec(antes.saldo), C = parseDec(antes.cmc), d = parseDec(quantidade), c = parseDec(custo)
  const saldo = S + d
  let cmc = C
  if (c > 0n) {
    if (C <= 0n || saldo === 0n) cmc = c
    else {
      cmc = divArred((S * C + d * c) * 10n ** 6n, saldo * UM) * 1000n
      if (cmc <= 0n) cmc = c
    }
  }
  return { saldo: fmtDec(saldo), cmc: fmtDec(cmc) }
}

/** Cadeia de entradas sobre um estado de abertura (a "foto" antes da nota). */
export function encadear(abertura: Estado, entradas: { quantidade: string; custo: string }[]): Estado {
  return entradas.reduce((e, x) => novoEstado(e, x.quantidade, x.custo), abertura)
}

export type TituloEsperado = { parcela: number; totalParcelas: number; vencimento: string; valor: string }

export function titulosEsperados(p: {
  ligado: boolean; entradaLancada: boolean; total: string; emissao: string; duplicatas: { vencimento: string | null; valor: string }[]
}): TituloEsperado[] {
  if (!p.ligado || !p.entradaLancada) return []
  const duplicatas = p.duplicatas.map((d) => ({ vencimento: d.vencimento ?? p.emissao, valor: arredondar(parseDec(d.valor), 2) })).filter((d) => d.valor > 0n)
  if (duplicatas.length) return duplicatas.map((d, i) => ({ parcela: i + 1, totalParcelas: duplicatas.length, vencimento: d.vencimento, valor: fmtDec(d.valor) }))
  const t = arredondar(parseDec(p.total), 2)
  return t > 0n ? [{ parcela: 1, totalParcelas: 1, vencimento: p.emissao, valor: fmtDec(t) }] : []
}
