// Cadeia de custo médio (CMC) do estoque próprio refeita na ordem certa — ESPELHO da função SQL reprocessar_custo
// (migration 312). Quem muda uma muda a outra. Regras do Omie provadas em ~/Projects/omie-rea/regras/estoque-saldo-e-custo.md:
//   E9  entrada: CMC₁ = (S₀·C₀ + q·vu)/(S₀+q), também com S₀ < 0
//   E10 se S₀+q = 0 ou o resultado ≤ 0: CMC₁ = vu
//   E12 saída sai pelo CMC vigente e não o altera
//   DESVIO CONSCIENTE (decisão do dono, 04/11/2026): sem custo conhecido (CMC anterior = 0), a 1ª entrada com custo vira o
//   CMC (CMC₁ = vu), mesmo com S₀ < 0 — pela E9 o vendido antes da 1ª compra inflaria o custo. Com C₀ > 0 vale a E9/E10.
//   O registrar_movimento (317) faz o mesmo, para a cadeia e o lançamento ao vivo darem o mesmo número.
// Extras do ledger próprio (iguais ao registrar_movimento 308 e à devolução 231):
//   - ordem da cadeia = (data efetiva, id); CMC por loja × produto; 6 casas;
//   - movimento e seu estorno (reverses_id) saem juntos do custo médio: o par não existe para o custo (o saldo físico
//     continua contando os dois); o estorno vale o mesmo custo do movimento estornado;
//   - entrada sem custo (estimada) entra ao CMC vigente e não o muda; TRF não muda custo;
//   - entrada de OP (PRD, PRODUCAO, q > 0) vale Σ consumos da mesma OP ÷ quantidade produzida; sem custo = estimada;
//     com algum consumo estimado, a entrada também fica estimada (o custo dela forma o CMC do mesmo jeito);
//   - devolução ao fornecedor sai ao custo da entrada: CMC₁ = (S₀·C₀ + q·c)/(S₀+q) quando S₀+q > 0 e o resultado > 0;
//   - consumo de insumo (OP ou receita) com CMC 0 usa o último custo conhecido, marcado como estimado (migration 314).

export type Mov = {
  id: number
  data: string // data efetiva (YYYY-MM-DD)
  local: number
  tipo: string // ENT SAI AJU TRF PRD EST
  origem: string
  ref: string
  quantidade: number // com sinal
  custoOriginal: number | null // custo gravado no ledger (para entradas com custo informado: o vu)
  // valores efetivos atuais (visão estoque_movimentos_efetivo) — comparados para decidir se grava revisão
  custo: number | null
  cmc: number | null
  saldo: number
  saldoTotal: number
  estimado: boolean
  reversesId: number | null
  /** saída que é consumo de insumo (OP ou receita): usa o último custo conhecido quando o CMC é 0 */
  consumo?: boolean
}

export type EstadoInicial = { saldo: number; cmc: number; saldoLocal?: Record<number, number>; ultimoCusto?: number | null }

export type Revisao = { id: number; data: string; custo: number; cmc: number; saldo: number; saldoTotal: number; estimado: boolean }

export type Resultado = {
  revisoes: Revisao[]
  final: { saldo: number; cmc: number; ultimoCusto: number | null; saldoLocal: Record<number, number> }
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6

// Aritmética decimal exata em micro-unidades (6 casas), igual ao numeric do Postgres: arredonda meio para longe do zero.
const B0 = BigInt(0)
const B2 = BigInt(2)
const M = BigInt(1_000_000)
const micro = (n: number) => BigInt(Math.round(n * 1e6))
const deMicro = (n: bigint) => Number(n) / 1e6
function divArred(n: bigint, d: bigint): bigint {
  const neg = (n < B0) !== (d < B0)
  const an = n < B0 ? -n : n
  const ad = d < B0 ? -d : d
  const q = (B2 * an + ad) / (B2 * ad)
  return neg ? -q : q
}
/** round((s·c + q·v)/(s+q), 6) */
function media(s: number, c: number, q: number, v: number): number {
  return deMicro(divArred(micro(s) * micro(c) + micro(q) * micro(v), micro(s) + micro(q)))
}
/** round(valor / q, 6) */
function dividir(valor: number, q: number): number {
  return deMicro(divArred(micro(valor) * M, micro(q)))
}

function ehEntradaDeOP(m: Mov) {
  return m.tipo === 'PRD' && m.origem === 'PRODUCAO' && m.quantidade > 0
}

/** Σ (quantidade × custo efetivo) dos consumos (PRD negativos) de uma OP. */
/** Algum consumo (PRD negativo) da OP está com custo estimado? */
export function consumoEstimadoDaOP(consumos: Mov[], ref: string): boolean {
  return consumos.some((c) => c.ref === ref && c.tipo === 'PRD' && c.origem === 'PRODUCAO' && c.quantidade < 0 && c.estimado)
}

export function valorConsumosDaOP(consumos: Mov[], ref: string): number {
  let v = B0
  for (const c of consumos) {
    if (c.ref === ref && c.tipo === 'PRD' && c.origem === 'PRODUCAO' && c.quantidade < 0) v += -micro(c.quantidade) * micro(c.custo ?? 0)
  }
  return deMicro(divArred(v, M))
}

export function refazerCadeia(
  movs: Mov[],
  inicial: EstadoInicial,
  opts: { valorConsumoOP?: (ref: string) => number | null | undefined; consumoEstimadoOP?: (ref: string) => boolean } = {},
): Resultado {
  const ordem = [...movs].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.id - b.id))
  const ids = new Set(ordem.map((m) => m.id))
  // pares: estorno cujo movimento estornado está na janela, e o estornado
  const estornados = new Set<number>()
  for (const m of ordem) if (m.reversesId != null && ids.has(m.reversesId)) estornados.add(m.reversesId)
  const noPar = (m: Mov) => estornados.has(m.id) || (m.reversesId != null && ids.has(m.reversesId))

  let sFis = inicial.saldo // saldo total físico (todos os movimentos)
  let sCusto = inicial.saldo // saldo que pondera o custo (sem os pares)
  let c = inicial.cmc
  let ultimo = inicial.ultimoCusto != null && inicial.ultimoCusto > 0 ? inicial.ultimoCusto : null
  const saldoLocal: Record<number, number> = { ...(inicial.saldoLocal ?? {}) }
  const custoDoMov = new Map<number, number>()
  const revisoes: Revisao[] = []

  for (const m of ordem) {
    const q = m.quantidade
    let custo: number
    let estimado = false
    if (noPar(m)) {
      if (m.reversesId != null) {
        custo = custoDoMov.get(m.reversesId) ?? c
        estimado = m.estimado
      } else if (q > 0 && !m.estimado && (m.custoOriginal ?? 0) > 0) {
        custo = m.custoOriginal as number
      } else {
        custo = c
        estimado = q > 0 ? m.estimado : false
      }
    } else if (m.tipo === 'TRF') {
      custo = c
      sCusto += q
    } else if (q > 0) {
      let vu: number | null = null
      let opEstimada = false
      if (ehEntradaDeOP(m)) {
        const v = opts.valorConsumoOP?.(m.ref)
        if (v != null && v > 0) vu = dividir(v, q)
        opEstimada = !!opts.consumoEstimadoOP?.(m.ref)
      } else if (!m.estimado && (m.custoOriginal ?? 0) > 0) {
        vu = m.custoOriginal as number
      }
      if (vu != null && vu > 0) {
        custo = vu
        estimado = opEstimada
        if (c <= 0 || sCusto + q === 0) c = vu
        else {
          const w = media(sCusto, c, q, vu)
          c = w <= 0 ? vu : w
        }
        ultimo = vu
      } else {
        custo = c
        estimado = true
      }
      sCusto += q
    } else if (m.origem === 'DEVOLUCAO_FORNECEDOR' && (m.custoOriginal ?? 0) > 0) {
      custo = m.custoOriginal as number
      estimado = m.estimado
      if (sCusto + q > 0) {
        const w = media(sCusto, c, q, custo)
        if (w > 0) c = w
      }
      sCusto += q
    } else {
      if (c > 0) custo = c
      else if (m.consumo && ultimo != null) { custo = ultimo; estimado = true }
      else { custo = c; estimado = !!m.consumo }
      sCusto += q
    }
    sFis = r6(sFis + q)
    sCusto = r6(sCusto)
    saldoLocal[m.local] = r6((saldoLocal[m.local] ?? 0) + q)
    custo = r6(custo)
    custoDoMov.set(m.id, custo)

    const nova: Revisao = { id: m.id, data: m.data, custo, cmc: r6(c), saldo: saldoLocal[m.local], saldoTotal: sFis, estimado }
    const mudou = m.custo == null || r6(m.custo) !== nova.custo || m.cmc == null || r6(m.cmc) !== nova.cmc
      || r6(m.saldo) !== nova.saldo || r6(m.saldoTotal) !== nova.saldoTotal || m.estimado !== nova.estimado
    if (mudou) revisoes.push(nova)
  }
  return { revisoes, final: { saldo: sFis, cmc: r6(c), ultimoCusto: ultimo, saldoLocal } }
}
