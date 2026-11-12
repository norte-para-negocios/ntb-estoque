import { test } from 'node:test'
import assert from 'node:assert/strict'
import { arredondarPreco, cmcDaFoto, custoSuspeito, precoReal, cmv, lerTaxas, precoSugeridoDelivery, precoSugeridoSalao, resumir, situacao, sobraPorVenda, validarTaxas, TAXAS_PADRAO, type Taxas } from './preco-puro.ts'

const t: Taxas = { metaCmv: 0.3, impostoPct: 0.06, taxaCartaoPct: 0.03, taxaDeliveryPct: 0.27, embalagem: 1.5 }
const perto = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`)

test('salão: custo 9 com meta 30% dá 30', () => perto(precoSugeridoSalao(9, t), 30))

test('delivery: custo + embalagem é 30% do que sobra depois das taxas', () => {
  const p = precoSugeridoDelivery(9, t)
  perto(p, 10.5 / (0.3 * 0.64))
  perto((9 + 1.5) / (p * 0.64), 0.3)
})

test('delivery com taxas que comem tudo devolve 0', () => assert.equal(precoSugeridoDelivery(9, { ...t, taxaDeliveryPct: 0.95 }), 0))

test('cmv e sobra', () => {
  perto(cmv(9, 30) as number, 0.3)
  assert.equal(cmv(9, null), null)
  assert.equal(cmv(9, 0), null)
  perto(sobraPorVenda(30, 9, t, 'salao'), 30 * 0.91 - 9)
  perto(sobraPorVenda(50, 9, t, 'delivery'), 50 * 0.64 - 9 - 1.5)
})

test('arredonda para ,90 sempre para cima', () => {
  perto(arredondarPreco(29.3), 29.9)
  perto(arredondarPreco(29.9), 29.9)
  perto(arredondarPreco(29.95), 30.9)
  assert.equal(arredondarPreco(0), 0)
})

test('situação contra a meta', () => {
  assert.equal(situacao(9, 30, 0, t), 'ok')
  assert.equal(situacao(10, 30, 0, t), 'atencao') // 33,3%
  assert.equal(situacao(12, 30, 0, t), 'acima') // 40%
  assert.equal(situacao(9, null, 0, t), 'sem_preco')
  assert.equal(situacao(0, 30, 2, t), 'sem_custo')
  assert.equal(situacao(9, 30, 1, t), 'incompleto') // falta custo de insumo: o CMV real é maior
  assert.equal(situacao(12, 30, 1, t), 'acima') // mesmo incompleto já passou da meta
})

test('resumo do cardápio', () => {
  const r = resumir([
    { custo: 9, preco: 30, situacao: 'ok' },
    { custo: 12, preco: 30, situacao: 'acima' },
    { custo: 5, preco: null, situacao: 'sem_preco' },
    { custo: 1, preco: 30, situacao: 'incompleto' },
  ])
  assert.equal(r.pratos, 4)
  assert.equal(r.comPreco, 3)
  assert.equal(r.incompletos, 1)
  perto(r.cmvMedio as number, 0.35) // mediana de 30% e 40%
  assert.equal(r.acima, 1)
  assert.equal(r.semPreco, 1)
})

test('lê taxas gravadas como texto e completa com o padrão', () => {
  assert.deepEqual(lerTaxas(null), TAXAS_PADRAO)
  const l = lerTaxas({ meta_cmv: '0.32', imposto_pct: null, taxa_cartao_pct: '0.025', taxa_delivery_pct: '', embalagem: 3 })
  perto(l.metaCmv, 0.32); perto(l.impostoPct, TAXAS_PADRAO.impostoPct); perto(l.taxaCartaoPct, 0.025)
  perto(l.taxaDeliveryPct, TAXAS_PADRAO.taxaDeliveryPct); perto(l.embalagem, 3)
})

test('valida taxas', () => {
  assert.deepEqual(validarTaxas(t), [])
  assert.ok(validarTaxas({ ...t, metaCmv: 0 }).length)
  assert.ok(validarTaxas({ ...t, taxaDeliveryPct: 0.6, impostoPct: 0.3, taxaCartaoPct: 0.2 }).some((m) => m.includes('100%')))
  assert.ok(validarTaxas({ ...t, embalagem: -1 }).length)
})

test('CMC da foto: consolidado > ponderado > maior visto', () => {
  const m = cmcDaFoto([
    { produto: 1, local: 0, cmc: 37.68, saldo: 0 }, { produto: 1, local: 9, cmc: 30, saldo: 10 },
    { produto: 2, local: 9, cmc: 10, saldo: 1 }, { produto: 2, local: 8, cmc: 20, saldo: 3 },
    { produto: 3, local: 9, cmc: 15.1, saldo: -0.2 },
    { produto: 4, local: 0, cmc: 0, saldo: 0 },
  ])
  perto(m.get(1)!, 37.68)
  perto(m.get(2)!, 17.5)
  perto(m.get(3)!, 15.1)
  assert.equal(m.has(4), false)
})

test('preço simbólico não é preço', () => {
  assert.equal(precoReal(0.01), false)
  assert.equal(precoReal(null), false)
  assert.equal(precoReal(1), true)
  assert.equal(situacao(5, 0.01, 0, t), 'sem_preco')
  assert.equal(cmv(5, 0.01), null)
})

test('custo suspeito pela unidade', () => {
  assert.equal(custoSuspeito(39.67, 'ML'), true) // Martini lançado por garrafa
  assert.equal(custoSuspeito(0.06, 'ML'), false)
  assert.equal(custoSuspeito(180, 'KG'), false)
  assert.equal(custoSuspeito(2500, 'KG'), true)
  assert.equal(custoSuspeito(null, 'G'), false)
  assert.equal(situacao(2618, 16.9, 0, t, 1), 'suspeito')
})

test('mediana resiste a um custo errado', () => {
  const r = resumir([
    { custo: 3, preco: 10, situacao: 'ok' }, { custo: 3.5, preco: 10, situacao: 'atencao' }, { custo: 2618, preco: 16.9, situacao: 'acima' },
  ])
  perto(r.cmvMedio as number, 0.35)
})
