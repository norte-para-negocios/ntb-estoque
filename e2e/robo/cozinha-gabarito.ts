// Gabarito da Norte Cozinha (ticket 11): conta independente, SÓ função pura (sem banco, sem navegador, sem código do ERP).
// Regra de negócio em palavras (não copiada do ERP):
//  - custo do prato = soma, item a item da ficha, de (quantidade bruta x quantidade do prato / rendimento) x custo médio do insumo;
//    bruta = líquida x fator de correção x (1 + perda%), 6 casas; item que é preparação (tem ficha) desce pela ficha dela;
//    insumo sem custo médio custa zero e conta como "sem custo"; ficha que volta a si mesma é ciclo;
//  - CMV = custo / preço de venda; preço abaixo de R$ 0,10 é marcador de cadastro, não preço;
//  - preço p/ meta = custo / meta, para cima, terminando em ,90;
//  - situação: até a meta ok, até 5 pontos acima atenção, mais acima; sem preço, suspeito, sem custo e incompleto à parte;
//  - CMV do prato típico = mediana do CMV dos pratos com preço e custo confiável (ok, atenção ou acima);
//  - evento: custo por pessoa = soma das porções por convidado x custo do prato, vezes (1 + folga%).
// Decimais em BigInt com 9 casas; texto decimal entra e sai. Arredondamento meia para longe do zero.
const E = 10n ** 9n
const abs = (n: bigint) => (n < 0n ? -n : n)

function dec(v: string | number): bigint {
  const s = String(v).trim()
  const m = s.match(/^([+-])?(\d*)(?:\.(\d*))?$/)
  if (!m || (!m[2] && !m[3])) throw new Error(`decimal inválido: "${s}"`)
  const frac = (m[3] ?? '').padEnd(10, '0')
  let n = BigInt(m[2] || '0') * E + BigInt(frac.slice(0, 9))
  if (Number(frac[9]) >= 5) n += 1n
  return m[1] === '-' ? -n : n
}
function txt(n: bigint): string {
  const neg = n < 0n
  const a = abs(n)
  const f = (a % E).toString().padStart(9, '0').replace(/0+$/, '')
  return `${neg ? '-' : ''}${a / E}${f ? `.${f}` : ''}`
}
/** a / b arredondado meia para longe do zero. */
function div(a: bigint, b: bigint): bigint {
  const neg = (a < 0n) !== (b < 0n)
  const q = (abs(a) * 2n + abs(b)) / (abs(b) * 2n)
  return neg ? -q : q
}
const mul = (a: bigint, b: bigint) => div(a * b, E)
const r6 = (a: bigint) => div(a, 1000n) * 1000n // 9 casas -> 6 casas

export type ItemFichaGab = { insumo: string; liquida: string; fator: string; perda: string }
export type FichaGab = { rendimento: string; itens: ItemFichaGab[] }

export function custoDoPrato(prato: string, fichas: Record<string, FichaGab>, cmc: Record<string, string | null | undefined>, unidade: Record<string, string | null | undefined> = {}): { custo: string; semCusto: number; ciclo: boolean; suspeitos: number; folhas: string[] } {
  let semCusto = 0
  let suspeitos = 0
  const folhas = new Set<string>()
  let ciclo = false
  const descer = (cod: string, qtd: bigint, caminho: string[]): bigint => {
    const f = fichas[cod]
    const rend = dec(f.rendimento)
    let soma = 0n
    for (const i of f.itens) {
      const bruta = r6(mul(mul(dec(i.liquida), dec(i.fator)), E + div(dec(i.perda), 100n)))
      const q = r6(div(bruta * qtd, rend))
      if (caminho.includes(i.insumo) || caminho.length > 10) { ciclo = true; continue }
      if (fichas[i.insumo]) { soma += descer(i.insumo, q, [...caminho, i.insumo]); continue }
      const c = cmc[i.insumo]
      folhas.add(i.insumo)
      if (c != null && custoSuspeitoGab(c, unidade[i.insumo] ?? null)) suspeitos++
      if (c == null || !(dec(c) > 0n)) { semCusto++; continue }
      soma += mul(q, dec(c))
    }
    return soma
  }
  if (!fichas[prato]) throw new Error(`prato sem ficha: ${prato}`)
  return { custo: txt(descer(prato, E, [prato])), semCusto, ciclo, suspeitos, folhas: [...folhas] }
}

/** Preço de verdade: R$ 0,10 ou mais. */
export const precoReal = (preco: string | null) => preco != null && dec(preco) >= dec('0.1')

export function cmvDoPrato(custo: string, preco: string | null): string | null {
  if (!precoReal(preco)) return null
  return txt(div(dec(custo) * E, dec(preco as string)))
}

export function precoSugeridoSalao(custo: string, meta: string): string {
  const v = div(dec(custo) * E, dec(meta))
  const inteiro = v / E * E
  const candidato = inteiro + dec('0.9')
  return txt(candidato >= v ? candidato : inteiro + dec('1.9'))
}

export type SituacaoGab = 'ok' | 'atencao' | 'acima' | 'sem_preco' | 'sem_custo' | 'incompleto' | 'suspeito'
export function situacaoDoPrato(custo: string, preco: string | null, semCusto: number, suspeitos: number, meta: string): SituacaoGab {
  if (!precoReal(preco)) return 'sem_preco'
  if (suspeitos > 0) return 'suspeito'
  if (semCusto > 0 && dec(custo) <= 0n) return 'sem_custo'
  const c = div(dec(custo) * E, dec(preco as string))
  const m = dec(meta)
  const cinco = dec('0.05')
  if (semCusto > 0 && c <= m + cinco) return 'incompleto'
  if (c <= m) return 'ok'
  if (c <= m + cinco) return 'atencao'
  return 'acima'
}

export function medianaCmv(valores: string[]): string | null {
  if (!valores.length) return null
  const o = valores.map(dec).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const m = Math.floor(o.length / 2)
  return txt(o.length % 2 ? o[m] : div(o[m - 1] + o[m], 2n))
}

export function custoSuspeitoGab(custoUnitario: string | null, unidade: string | null): boolean {
  if (custoUnitario == null || !(dec(custoUnitario) > 0n)) return false
  const u = (unidade ?? '').toUpperCase()
  const teto = u === 'G' || u === 'ML' || u === 'GR' ? '2' : u === 'KG' || u === 'L' || u === 'LT' ? '2000' : '5000'
  return dec(custoUnitario) > dec(teto)
}

export function custoPorPessoaEvento(itens: { porcoes: string; custo: string }[], folgaPct: string): string {
  const soma = itens.reduce((a, i) => a + mul(dec(i.porcoes), dec(i.custo)), 0n)
  return txt(mul(soma, E + div(dec(folgaPct), 100n)))
}

export function valorEmEstoqueGab(itens: { saldo: string; custo: string | null }[]): string {
  return txt(itens.reduce((a, i) => (i.custo != null && dec(i.custo) > 0n && dec(i.saldo) > 0n ? a + mul(dec(i.saldo), dec(i.custo)) : a), 0n))
}

export function precoSugeridoDelivery(custo: string, t: { meta: string; imposto: string; cartao: string; app: string; embalagem: string }): string {
  const liquido = E - dec(t.app) - dec(t.cartao) - dec(t.imposto)
  const v = div((dec(custo) + dec(t.embalagem)) * E * E, mul(dec(t.meta), liquido) * E)
  const inteiro = v / E * E
  const candidato = inteiro + dec('0.9')
  return txt(candidato >= v ? candidato : inteiro + dec('1.9'))
}

export function sobraSalao(preco: string, custo: string, t: { imposto: string; cartao: string }): string {
  return txt(mul(dec(preco), E - dec(t.imposto) - dec(t.cartao)) - dec(custo))
}

/** O valor da tela (inteiro / divisor) é o mais próximo do exato? Aceita os dois lados na metade e folga de 1/20000 do passo. */
export function cabeNaEscala(exato: string, tela: bigint, divisor: bigint): boolean {
  const alvo = tela * E / divisor
  return abs(dec(exato) - alvo) <= E / (2n * divisor) + E / (divisor * 100n)
}

/** O valor da tela (em centavos) é o centavo mais próximo do exato? Aceita os dois lados na metade e uma folga de 0,0001. */
export function cabeNoCentavo(exato: string, centavosTela: bigint): boolean {
  const alvo = centavosTela * (E / 100n)
  return abs(dec(exato) - alvo) <= E / 200n + E / 10000n
}

export const decGab = dec
export const textoGab = txt
export const divGab = div
export const mulGab = mul
