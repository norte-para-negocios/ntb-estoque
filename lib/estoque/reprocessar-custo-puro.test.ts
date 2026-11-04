import { test } from 'node:test'
import assert from 'node:assert/strict'
import { refazerCadeia, valorConsumosDaOP, type Mov } from './reprocessar-custo-puro.ts'

const L = 1
const L2 = 2

/** Movimento já gravado no ledger: os campos "atuais" (custo, cmc, saldo…) são o que está na visão efetiva hoje. */
function mov(p: Partial<Mov> & { id: number; data: string; quantidade: number }): Mov {
  return {
    local: L, tipo: p.quantidade > 0 ? 'ENT' : 'SAI', origem: p.quantidade > 0 ? 'COMPRA' : 'VENDA', ref: `r${p.id}`,
    custo: null, custoOriginal: p.custo ?? null, cmc: 0, saldo: 0, saldoTotal: 0, estimado: false, reversesId: null, ...p,
  }
}

test('(a) entrada lançada depois de saídas, com saldo negativo, pondera pela regra do Omie (E9)', () => {
  // vendas de 20/10 baixaram 6 sem custo; a nota de 09/10 (10 a R$ 4) foi lançada em 02/11 com a data dela
  const movs = [
    mov({ id: 1, data: '2026-10-05', quantidade: 4, custo: 5, cmc: 5, saldo: 4, saldoTotal: 4 }),
    mov({ id: 3, data: '2026-10-20', quantidade: -6, custo: 5, cmc: 5, saldo: -2, saldoTotal: -2 }),
    mov({ id: 9, data: '2026-10-09', quantidade: 10, custo: 4, cmc: 4.5, saldo: 8, saldoTotal: 8 }),
  ]
  const r = refazerCadeia(movs, { saldo: 0, cmc: 0 })
  // ordem (data, id): 1 (05/10), 9 (09/10), 3 (20/10)
  const porId = new Map(r.revisoes.map((x) => [x.id, x]))
  // id 9: S0=4, C0=5 → (4·5 + 10·4)/14 = 4,285714
  assert.equal(porId.get(9)?.cmc, 4.285714)
  assert.equal(porId.get(9)?.saldo, 14)
  // id 3: sai ao CMC vigente 4,285714
  assert.equal(porId.get(3)?.custo, 4.285714)
  assert.equal(porId.get(3)?.saldo, 8)
  assert.equal(r.final.cmc, 4.285714)
  assert.equal(r.final.saldo, 8)
  // E9 também com S0 < 0
  const neg = refazerCadeia([
    mov({ id: 1, data: '2026-10-01', quantidade: -3, cmc: 5 }),
    mov({ id: 2, data: '2026-10-02', quantidade: 5, custo: 2 }),
  ], { saldo: 0, cmc: 5 })
  // (−3·5 + 5·2)/2 = −2,5 ≤ 0 → E10: CMC = vu = 2
  assert.equal(neg.final.cmc, 2)
  const neg2 = refazerCadeia([
    mov({ id: 1, data: '2026-10-01', quantidade: -1, cmc: 5 }),
    mov({ id: 2, data: '2026-10-02', quantidade: 5, custo: 8 }),
  ], { saldo: 0, cmc: 5 })
  // (−1·5 + 5·8)/4 = 8,75
  assert.equal(neg2.final.cmc, 8.75)
})

test('(b) S0 + q = 0 → CMC = custo da entrada (E10)', () => {
  const r = refazerCadeia([
    mov({ id: 1, data: '2026-10-01', quantidade: -4 }),
    mov({ id: 2, data: '2026-10-02', quantidade: 4, custo: 3 }),
  ], { saldo: 0, cmc: 7 })
  assert.equal(r.final.cmc, 3)
  assert.equal(r.final.saldo, 0)
})

test('(c) saída sai pelo CMC vigente e não o altera (E12)', () => {
  const r = refazerCadeia([
    mov({ id: 1, data: '2026-10-01', quantidade: 10, custo: 2, cmc: 2, saldo: 10, saldoTotal: 10 }),
    mov({ id: 2, data: '2026-10-02', quantidade: -3, custo: 0, cmc: 0, saldo: 7, saldoTotal: 7 }),
  ], { saldo: 0, cmc: 0 })
  const s = r.revisoes.find((x) => x.id === 2)
  assert.equal(s?.custo, 2)
  assert.equal(s?.cmc, 2)
  assert.equal(r.final.cmc, 2)
})

test('(d) movimento e seu estorno saem juntos da cadeia de custo', () => {
  // fardo lançado errado (100 a R$ 60) e estornado: o CMC volta ao que seria sem ele
  const movs = [
    mov({ id: 1, data: '2026-10-01', quantidade: 10, custo: 3.79, cmc: 3.79, saldo: 10, saldoTotal: 10 }),
    mov({ id: 2, data: '2026-10-02', quantidade: 100, custo: 60, cmc: 54.89, saldo: 110, saldoTotal: 110 }),
    mov({ id: 3, data: '2026-10-03', quantidade: -5, custo: 54.89, cmc: 54.89, saldo: 105, saldoTotal: 105 }),
    mov({ id: 4, data: '2026-10-04', tipo: 'EST', origem: 'ESTORNO', quantidade: -100, custo: 54.89, cmc: 54.89, saldo: 5, saldoTotal: 5, reversesId: 2 }),
    mov({ id: 5, data: '2026-10-05', quantidade: 10, custo: 4, cmc: 60.64, saldo: 15, saldoTotal: 15 }),
  ]
  const r = refazerCadeia(movs, { saldo: 0, cmc: 0 })
  const porId = new Map(r.revisoes.map((x) => [x.id, x]))
  assert.equal(porId.get(3)?.custo, 3.79, 'a venda entre a entrada errada e o estorno sai ao custo certo')
  assert.equal(porId.get(4)?.custo, 60, 'o estorno vale o mesmo que a entrada estornada (o par se anula)')
  // depois: S=5 (C=3,79) + 10 a 4 → (5·3,79 + 40)/15 = 3,93
  assert.equal(r.final.cmc, 3.93)
  assert.equal(r.final.saldo, 15, 'o saldo continua a soma do ledger')
  assert.equal(porId.get(2)?.custo, 60, 'a entrada estornada guarda o próprio custo')
  assert.equal(porId.get(2)?.cmc, 3.79, 'mas não entra no custo médio')
})

test('(e) entrada de OP recebe o custo dos consumos da mesma OP ÷ quantidade produzida', () => {
  const insumos = [
    mov({ id: 10, data: '2026-10-10', tipo: 'PRD', origem: 'PRODUCAO', ref: 'op1', quantidade: -2, custo: 3 }),
    mov({ id: 11, data: '2026-10-10', tipo: 'PRD', origem: 'PRODUCAO', ref: 'op1', quantidade: -0.5, custo: 8 }),
    mov({ id: 12, data: '2026-10-10', tipo: 'PRD', origem: 'PRODUCAO', ref: 'op2', quantidade: -1, custo: 99 }),
  ]
  assert.equal(valorConsumosDaOP(insumos, 'op1'), 10)
  const prato = [
    mov({ id: 13, data: '2026-10-10', tipo: 'PRD', origem: 'PRODUCAO', ref: 'op1', quantidade: 4, custo: null, estimado: true }),
    mov({ id: 14, data: '2026-10-11', quantidade: -1, custo: 0 }),
  ]
  const r = refazerCadeia(prato, { saldo: 0, cmc: 0 }, { valorConsumoOP: (ref) => valorConsumosDaOP(insumos, ref) })
  const porId = new Map(r.revisoes.map((x) => [x.id, x]))
  assert.equal(porId.get(13)?.custo, 2.5)
  assert.equal(porId.get(13)?.estimado, false)
  assert.equal(porId.get(14)?.custo, 2.5, 'a venda do prato ganha o custo novo (cascata)')
  // OP sem custo nenhum: entrada estimada, CMC não muda
  const r0 = refazerCadeia([mov({ id: 20, data: '2026-10-10', tipo: 'PRD', origem: 'PRODUCAO', ref: 'opx', quantidade: 2, custo: 1, cmc: 1, saldo: 2, saldoTotal: 2, estimado: true })],
    { saldo: 0, cmc: 1 }, { valorConsumoOP: () => 0 })
  assert.equal(r0.revisoes.length, 0)
  assert.equal(r0.final.cmc, 1)
})

test('(f) movimento sem mudança não gera revisão', () => {
  const r = refazerCadeia([
    mov({ id: 1, data: '2026-10-01', quantidade: 10, custo: 2, cmc: 2, saldo: 10, saldoTotal: 10 }),
    mov({ id: 2, data: '2026-10-02', quantidade: -3, custo: 2, cmc: 2, saldo: 7, saldoTotal: 7 }),
  ], { saldo: 0, cmc: 0 })
  assert.deepEqual(r.revisoes, [])
})

test('(g) consumo de insumo com CMC 0 usa o último custo conhecido, marcado como estimado', () => {
  const r = refazerCadeia([
    mov({ id: 1, data: '2026-10-01', quantidade: 2, custo: 6, cmc: 6, saldo: 2, saldoTotal: 2 }),
    mov({ id: 2, data: '2026-10-02', quantidade: -4, custo: 6, cmc: 6, saldo: -2, saldoTotal: -2 }),
    mov({ id: 3, data: '2026-10-03', quantidade: 2, custo: 6, cmc: 6, saldo: 0, saldoTotal: 0, estimado: true }),
    mov({ id: 4, data: '2026-10-04', tipo: 'PRD', origem: 'PRODUCAO', ref: 'op', quantidade: -1, custo: 6, cmc: 6, saldo: -1, saldoTotal: -1, consumo: true }),
  ], { saldo: 0, cmc: 0 })
  // nada mudou (CMC 6 o tempo todo)
  assert.deepEqual(r.revisoes, [])
  const z = refazerCadeia([
    mov({ id: 4, data: '2026-10-04', tipo: 'PRD', origem: 'PRODUCAO', ref: 'op', quantidade: -1, custo: 0, cmc: 0, saldo: -1, saldoTotal: -1, consumo: true }),
  ], { saldo: 0, cmc: 0, ultimoCusto: 5 })
  assert.equal(z.revisoes[0]?.custo, 5)
  assert.equal(z.revisoes[0]?.estimado, true)
  assert.equal(z.final.cmc, 0, 'saída não muda o CMC')
  const nada = refazerCadeia([
    mov({ id: 4, data: '2026-10-04', tipo: 'PRD', origem: 'PRODUCAO', ref: 'op', quantidade: -1, custo: 0, cmc: 0, saldo: -1, saldoTotal: -1, consumo: true, estimado: true }),
  ], { saldo: 0, cmc: 0 })
  assert.deepEqual(nada.revisoes, [], 'sem nenhum custo: 0 e estimado (como já estava)')
})

test('saldo por local e transferência: TRF não muda custo; saldo do local na ordem nova', () => {
  const r = refazerCadeia([
    mov({ id: 5, data: '2026-10-05', quantidade: 10, custo: 2, cmc: 2, saldo: 10, saldoTotal: 10 }),
    mov({ id: 6, data: '2026-10-06', tipo: 'TRF', origem: 'TRANSFERENCIA', quantidade: -4, custo: 2, cmc: 2, saldo: 6, saldoTotal: 6 }),
    mov({ id: 7, data: '2026-10-06', tipo: 'TRF', origem: 'TRANSFERENCIA', local: L2, quantidade: 4, custo: 2, cmc: 2, saldo: 4, saldoTotal: 10 }),
    mov({ id: 2, data: '2026-10-01', quantidade: 5, custo: 4, cmc: 2.666667, saldo: 15, saldoTotal: 15 }),
  ], { saldo: 0, cmc: 0 })
  const porId = new Map(r.revisoes.map((x) => [x.id, x]))
  assert.equal(porId.get(2)?.saldo, 5)
  assert.equal(porId.get(2)?.cmc, 4)
  assert.equal(porId.get(5)?.cmc, 2.666667)
  assert.equal(porId.get(6)?.custo, 2.666667)
  assert.equal(porId.get(7)?.saldo, 4, 'local 2 começa em 0')
  assert.equal(r.final.saldo, 15)
  assert.deepEqual(r.final.saldoLocal, { [L]: 11, [L2]: 4 })
})

test('estado inicial vem do último movimento antes de "desde"', () => {
  const r = refazerCadeia([
    mov({ id: 30, data: '2026-10-20', quantidade: 5, custo: 10 }),
  ], { saldo: 5, cmc: 2, saldoLocal: { [L]: 5 } })
  // (5·2 + 5·10)/10 = 6
  assert.equal(r.final.cmc, 6)
  assert.equal(r.revisoes[0]?.saldo, 10)
})

test('devolução ao fornecedor tira as unidades ao custo da entrada (231)', () => {
  const r = refazerCadeia([
    mov({ id: 1, data: '2026-10-01', quantidade: 10, custo: 2, cmc: 2, saldo: 10, saldoTotal: 10 }),
    mov({ id: 2, data: '2026-10-01', quantidade: 10, custo: 4, cmc: 3, saldo: 20, saldoTotal: 20 }),
    mov({ id: 3, data: '2026-10-02', origem: 'DEVOLUCAO_FORNECEDOR', quantidade: -10, custo: 4, cmc: 2, saldo: 10, saldoTotal: 10 }),
  ], { saldo: 0, cmc: 0 })
  assert.deepEqual(r.revisoes, [])
  assert.equal(r.final.cmc, 2)
})
