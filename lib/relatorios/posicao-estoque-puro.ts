// Posição de estoque (matriz N6) e posição tipo SPED / Bloco H (N7) a partir de uma foto de posicao_estoques.
// Regras do Omie (omie-rea/regras/estoque-saldo-e-custo.md): saldo e CMC por produto × local (E1), valor = quantidade
// × CMC (E2), negativos entram no total (E4), disponível = quantidade − reservada (E3), o local padrão lista todos
// os produtos inclusive com saldo 0 (E7). Local 0 é a sentinela do sync (mínimo + CMC do produto), nunca uma linha.
// Custo suspeito: regra única no banco, posicao_valorizada (migration 282; paridade 20/10/2026): CMC > 10× a referência de
// custo do produto (CMC ponderado dos locais com saldo positivo, senão o custo da última entrada por nota), sem referência
// > 10× o preço de venda, sem nada > 100 mil em linha negativa, e sempre ≥ 1e7. A linha suspeita vale saldo × referência
// (0 sem referência) e entra na lista do aviso com o valor cru do Omie. Sem a 282 aplicada (linhas sem `valor`), volta à
// regra antiga: CMC fora de (0, 1e7) vale 0.
// Um só total: as visões por produto e por local somam as mesmas linhas de local.
// Puro, sem imports: node --test lib/relatorios/posicao-estoque-puro.test.ts

export type LinhaFoto = {
  n_cod_prod: number; codigo_local_estoque: number; n_saldo: number; n_cmc: number; reservado: number | null
  /** de posicao_valorizada (282): CMC usado no valor, valor da linha, se o CMC do Omie é suspeito, referência e valor cru */
  cmc_usado?: number | null; valor?: number | null; suspeito?: boolean | null; referencia?: number | null; valor_omie?: number | null
}
export type LinhaSuspeita = { codProduto: number; codigo: string; descricao: string; local: string; quant: number; cmcOmie: number; referencia: number | null; valorOmie: number; valor: number }
export type MetaProduto = {
  codigo_produto: number; codigo: string | null; descricao: string | null; familia: string | null; tipo: string | null
  unidade: string | null; ncm: string | null; inativo: boolean
}
export type InfoLocal = { descricao: string; padrao: boolean }
export type VerPosicao = 'produto' | 'local' | 'sped'
export type OpcoesPosicao = { ver: VerPosicao; zerados: boolean; inativos: boolean; tipos: string[]; familias: string[]; q: string }
export type LinhaPosicao = {
  chave: string; codProduto: number; codigo: string; descricao: string; familia: string; tipo: string; unidade: string; ncm: string
  inativo: boolean; local: string | null; quant: number; reservado: number; disponivel: number; cmc: number; valor: number; custoSuspeito: boolean
}
export type TotalPosicao = {
  linhas: number; quant: number; valor: number; positivo: number; negativo: number; suspeitos: number
  /** valor cru do Omie − valor ajustado nas linhas de custo suspeito (total + ajuste = total do Omie) */
  ajusteOmie: number; suspeitas: LinhaSuspeita[]
}

export const SEM_FAMILIA = 'Sem família'
const r2 = (n: number) => Math.round(n * 100) / 100
const r6 = (n: number) => Math.round(n * 1e6) / 1e6
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export const custoValido = (c: number): boolean => Number.isFinite(c) && c > 0 && c < 1e7

/** Data da foto: a mais recente que já tem linha de algum local real (enquanto o sync grava a sentinela primeiro). */
export function escolherFoto(datas: { data: string; temLocalReal: boolean }[]): string | null {
  return datas.filter((d) => d.temLocalReal).map((d) => d.data).sort().pop() ?? null
}

/** Locais ativos que vieram na foto anterior e não vieram na atual (o Omie não devolveu o local na última leitura). */
export function locaisSumidos(atual: number[], anterior: number[], ativos: Set<number>): number[] {
  const agora = new Set(atual)
  return [...new Set(anterior)].filter((l) => l !== 0 && ativos.has(l) && !agora.has(l)).sort((a, b) => a - b)
}

type LinhaLocal = { prod: number; local: number; quant: number; reservado: number; cmc: number; valor: number; suspeito: boolean; cmcOmie: number; referencia: number | null; valorOmie: number }

export function montarPosicao(foto: LinhaFoto[], produtos: MetaProduto[], locais: Map<number, InfoLocal>, op: OpcoesPosicao): { linhas: LinhaPosicao[]; total: TotalPosicao } {
  const meta = new Map(produtos.map((p) => [Number(p.codigo_produto), p]))
  const cmcSentinela = new Map<number, number>()
  const porLocal: LinhaLocal[] = []
  for (const f of foto) {
    const cmc = Number(f.n_cmc) || 0
    if (Number(f.codigo_local_estoque) === 0) {
      if (custoValido(cmc)) cmcSentinela.set(Number(f.n_cod_prod), cmc)
      continue
    }
    const quant = Number(f.n_saldo) || 0
    const base = { prod: Number(f.n_cod_prod), local: Number(f.codigo_local_estoque), quant, reservado: Number(f.reservado) || 0, cmcOmie: cmc, valorOmie: r2(quant * cmc) }
    if (f.valor !== undefined && f.valor !== null) {
      // regra do banco (posicao_valorizada)
      porLocal.push({ ...base, cmc: Number(f.cmc_usado) || 0, valor: Number(f.valor) || 0, suspeito: f.suspeito === true, referencia: f.referencia == null ? null : Number(f.referencia), valorOmie: f.valor_omie == null ? base.valorOmie : Number(f.valor_omie) })
    } else {
      const suspeito = quant !== 0 && !custoValido(cmc)
      porLocal.push({ ...base, cmc: custoValido(cmc) ? cmc : 0, valor: suspeito ? 0 : r2(quant * cmc), suspeito, referencia: null })
    }
  }

  const termo = semAcento(op.q.trim())
  const passa = (cod: number): boolean => {
    const m = meta.get(cod)
    const inativo = m?.inativo ?? false
    if (op.ver === 'sped' ? inativo : inativo && !op.inativos) return false
    if (op.tipos.length && !op.tipos.includes(m?.tipo || '_')) return false
    if (op.familias.length && !op.familias.includes(m?.familia || SEM_FAMILIA)) return false
    if (termo && !semAcento(`${m?.descricao ?? ''} ${m?.codigo ?? ''} ${cod}`).includes(termo)) return false
    return true
  }
  const visiveis = porLocal.filter((l) => passa(l.prod))
  const nomeLocal = (c: number) => locais.get(c)?.descricao ?? String(c)
  const localPadrao = [...locais.entries()].find(([, l]) => l.padrao)?.[1].descricao ?? 'Sem local'

  const linha = (cod: number, local: string | null, quant: number, reservado: number, valor: number, cmcLinha: number | null, suspeito: boolean): LinhaPosicao => {
    const m = meta.get(cod)
    const cmc = cmcLinha ?? (quant !== 0 && !suspeito ? r6(valor / quant) : (cmcSentinela.get(cod) ?? 0))
    return {
      chave: local == null ? String(cod) : `${cod}:${local}`, codProduto: cod, codigo: m?.codigo ?? String(cod), descricao: m?.descricao ?? `Produto ${cod}`,
      familia: m?.familia || SEM_FAMILIA, tipo: m?.tipo ?? '', unidade: m?.unidade ?? '', ncm: m?.ncm ?? '', inativo: m?.inativo ?? false,
      local, quant: r6(quant), reservado: r6(reservado), disponivel: r6(quant - reservado), cmc, valor: r2(valor), custoSuspeito: suspeito,
    }
  }

  let linhas: LinhaPosicao[]
  if (op.ver === 'local') {
    linhas = visiveis.map((l) => linha(l.prod, nomeLocal(l.local), l.quant, l.reservado, l.valor, l.cmc, l.suspeito))
  } else {
    const g = new Map<number, { quant: number; reservado: number; valor: number; suspeito: boolean }>()
    for (const l of visiveis) {
      const x = g.get(l.prod) ?? { quant: 0, reservado: 0, valor: 0, suspeito: false }
      x.quant += l.quant; x.reservado += l.reservado; x.valor += l.valor; x.suspeito ||= l.suspeito
      g.set(l.prod, x)
    }
    linhas = [...g.entries()].map(([cod, x]) => linha(cod, null, x.quant, x.reservado, x.valor, null, x.suspeito))
    if (op.ver === 'sped') linhas = linhas.filter((l) => l.quant > 0)
  }
  if (op.zerados && op.ver !== 'sped') {
    const comLinha = new Set(visiveis.filter((l) => l.quant !== 0).map((l) => l.prod))
    const jaListados = new Set(linhas.map((l) => l.codProduto))
    for (const p of produtos) {
      const cod = Number(p.codigo_produto)
      if (comLinha.has(cod) || jaListados.has(cod) || !passa(cod)) continue
      linhas.push(linha(cod, op.ver === 'local' ? localPadrao : null, 0, 0, 0, null, false))
    }
  }
  // sem "zerados": some só o que não tem quantidade, reserva nem valor (locais que se anulam ficam: a tabela soma o cartão)
  if (!op.zerados) linhas = linhas.filter((l) => l.quant !== 0 || l.reservado !== 0 || l.valor !== 0)
  linhas.sort((a, b) => b.valor - a.valor || a.descricao.localeCompare(b.descricao, 'pt-BR') || a.chave.localeCompare(b.chave))

  // Totais das linhas de local (o mesmo número nas visões por produto e por local); no SPED, das linhas do
  // Bloco H (um registro por produto, sempre positivo).
  const base = op.ver === 'sped'
    ? linhas.map((l) => ({ quant: l.quant, valor: l.valor, suspeito: l.custoSuspeito }))
    : visiveis
  const total: TotalPosicao = { linhas: linhas.length, quant: 0, valor: 0, positivo: 0, negativo: 0, suspeitos: 0, ajusteOmie: 0, suspeitas: [] }
  for (const l of base) {
    total.quant += l.quant
    total.valor += l.valor
    if (l.valor > 0) total.positivo += l.valor
    else total.negativo += l.valor
    if (l.suspeito) total.suspeitos++
  }
  total.quant = r6(total.quant); total.valor = r2(total.valor); total.positivo = r2(total.positivo); total.negativo = r2(total.negativo)
  // linhas de custo suspeito (dado do Omie a corrigir): sempre por local, maior ajuste primeiro
  // na visão SPED (Bloco H) só os produtos que estão nas linhas do bloco (ativo, saldo > 0)
  const noBlocoH = op.ver === 'sped' ? new Set(linhas.map((l) => l.codProduto)) : null
  for (const l of visiveis) {
    if (!l.suspeito || (noBlocoH && !noBlocoH.has(l.prod))) continue
    const m = meta.get(l.prod)
    total.ajusteOmie += l.valorOmie - l.valor
    total.suspeitas.push({ codProduto: l.prod, codigo: m?.codigo ?? String(l.prod), descricao: m?.descricao ?? `Produto ${l.prod}`, local: nomeLocal(l.local), quant: r6(l.quant), cmcOmie: l.cmcOmie, referencia: l.referencia, valorOmie: l.valorOmie, valor: l.valor })
  }
  total.ajusteOmie = r2(total.ajusteOmie)
  total.suspeitas.sort((a, b) => Math.abs(b.valorOmie - b.valor) - Math.abs(a.valorOmie - a.valor) || a.descricao.localeCompare(b.descricao, 'pt-BR'))
  return { linhas, total }
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
/** Aviso único das telas/planilhas (Posição, Estoque Valorizado): "N linhas com custo médio suspeito no Omie (R$ X ajustados)". */
export function textoAvisoSuspeito(n: number, ajusteOmie: number): string | null {
  if (!(n > 0)) return null
  return `${n} ${n === 1 ? 'linha' : 'linhas'} com custo médio suspeito no Omie (${brl(ajusteOmie)} ajustados)`
}
