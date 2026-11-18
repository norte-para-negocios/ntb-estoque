// Gabarito do inventário (ticket 06): conta independente, SÓ função pura (sem banco, navegador ou código do ERP).
// Regra em palavras: ajuste = contado - saldo; valor do ajuste = ajuste x custo médio; o ajuste não muda o custo médio;
// a diferença só exige motivo quando o valor, sem sinal, passa do limite da loja.
// Decimais em BigInt com 9 casas (mesma base dos gabaritos de saldo e de custo). Valores entram e saem como texto decimal.
import { parseDec, fmtDec } from './saldo-gabarito.ts'
import { novoEstado } from './custo-gabarito.ts'

const UM = 10n ** 9n
const abs = (d: bigint) => (d < 0n ? -d : d)

export type EntradaAjuste = { saldo: string; contado: string; cmc: string }
export type AjusteEsperado = {
  diferenca: string
  sentido: 'entrada' | 'saida' | 'nenhum'
  geraAjuste: boolean
  saldoDepois: string
  /** diferença x custo médio, exato (com sinal). */
  valor: string
  /** o mesmo valor em centavos, meia para longe do zero (como a tela mostra). */
  valorCent: bigint
  cmcDepois: string
}

export function ajusteEsperado(e: EntradaAjuste): AjusteEsperado {
  const saldo = parseDec(e.saldo), contado = parseDec(e.contado), cmc = parseDec(e.cmc)
  const dif = contado - saldo
  const valor = (dif * cmc) / UM // 9 casas x 9 casas / 9 casas: exato porque cada fator tem no máximo 6 casas úteis
  const passo = 10n ** 7n // 1 centavo na escala de 9 casas
  const q = (abs(valor) * 2n + passo) / (passo * 2n)
  // custo médio depois: o ajuste entra sem custo (custo 0 não dilui nem zera o custo médio)
  const depois = novoEstado({ saldo: e.saldo, cmc: e.cmc }, fmtDec(dif), '0')
  return {
    diferenca: fmtDec(dif),
    sentido: dif > 0n ? 'entrada' : dif < 0n ? 'saida' : 'nenhum',
    geraAjuste: dif !== 0n,
    saldoDepois: fmtDec(contado),
    valor: fmtDec(valor),
    valorCent: valor < 0n ? -q : q,
    cmcDepois: depois.cmc,
  }
}

export function exigeMotivoEsperado(valor: string, limite: string): boolean {
  return abs(parseDec(valor)) > parseDec(limite)
}
