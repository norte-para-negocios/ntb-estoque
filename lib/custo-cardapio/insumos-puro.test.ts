import { test } from 'node:test'
import assert from 'node:assert/strict'
import { arvoreCustoFicha, type FichaArvore } from '../estoque/arvore-custo-puro.ts'
import {
  agruparPorFornecedor, altasDeCusto, arredondarCompra, cmvTipicoAgoraEAntes, custoAntesImplicito, variacaoPorCompras, deltaPorRaiz, lerPreco, pratosQueMaisDeixam, pratosQueMaisPesam,
  quantidadeSugerida, saltoEstranho, simularPreco, situacaoEstoque, textoWhatsApp, usosDasArvores, variacao, type PratoResumo,
} from './insumos-puro.ts'

const perto = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`)
const item = (codigoInsumo: number, quantidadeLiquida: number, perdaPct = 0) => ({ codigoInsumo, quantidadeLiquida, fatorCorrecao: 1, perdaPct })

// Prato 100 = 0,2 kg de arroz (1) + 1 molho (200). Molho 200 rende 2: 0,5 kg tomate (2) + 0,1 kg arroz (1).
// Prato 101 = 0,3 kg tomate (2).
const fichas = new Map<number, FichaArvore>([
  [100, { codigoProduto: 100, rendimento: 1, expandirNaVenda: true, itens: [item(1, 0.2), item(200, 1)] }],
  [200, { codigoProduto: 200, rendimento: 2, expandirNaVenda: true, itens: [item(2, 0.5), item(1, 0.1)] }],
  [101, { codigoProduto: 101, rendimento: 1, expandirNaVenda: true, itens: [item(2, 0.3)] }],
])
const cmc = new Map<number, number | null>([[1, 10], [2, 4]])
const arvores = [100, 101, 200].map((c) => arvoreCustoFicha(fichas, cmc, c, 1)!)

test('usos: soma o insumo que aparece direto e dentro da preparação', () => {
  const u = usosDasArvores(arvores)
  const arroz = u.get(1)!
  const noPrato = arroz.find((x) => x.raiz === 100)!
  perto(noPrato.quantidade, 0.25) // 0,2 + 0,1/2
  perto(noPrato.custo, 2.5)
  assert.equal(noPrato.direto, true)
  perto(noPrato.custoRaiz, 2.5 + 1) // tomate 0,25 × 4
  assert.equal(arroz.find((x) => x.raiz === 200)!.direto, true)
  assert.equal(u.get(2)!.length, 3)
  assert.equal(u.has(200), false, 'preparação não é insumo')
})

test('variação e salto estranho', () => {
  perto(variacao(11, 10)!, 0.1)
  assert.equal(variacao(null, 10), null)
  assert.equal(variacao(5, 0), null)
  assert.equal(saltoEstranho(variacao(50, 10)), true)
  assert.equal(saltoEstranho(variacao(1, 10)), true)
  assert.equal(saltoEstranho(variacao(20, 10)), false)
})

test('delta por raiz e altas: tomate de 4 para 5', () => {
  const u = usosDasArvores(arvores)
  const antes = new Map([[1, 10], [2, 4]])
  const agora = new Map<number, number | null>([[1, 10], [2, 5]])
  const d = deltaPorRaiz(u, agora, antes)
  perto(d.get(100)!, 0.25)
  perto(d.get(101)!, 0.3)
  perto(d.get(200)!, 0.25)
  const altas = altasDeCusto(u, agora, antes, { ehPrato: (r) => r !== 200 })
  assert.equal(altas.length, 1)
  assert.equal(altas[0].codigo, 2)
  perto(altas[0].variacao, 0.25)
  assert.equal(altas[0].pratos, 2)
  perto(altas[0].peso, 0.55)
  perto(altas[0].impactoMedio, 0.275)
  // salto estranho e ignorado não entram
  assert.equal(altasDeCusto(u, new Map([[2, 40]]), antes, { ehPrato: () => true }).length, 0)
  assert.equal(altasDeCusto(u, agora, antes, { ehPrato: () => true, ignorar: (c) => c === 2 }).length, 0)
})

test('simular preço: tomate de 4 para 6 no prato 101 vendido a 10', () => {
  const u = usosDasArvores(arvores).get(2)!.map((x) => ({ ...x, preco: x.raiz === 101 ? 10 : null }))
  const s = simularPreco(u, 4, 6)
  const p101 = s.find((x) => x.raiz === 101)!
  perto(p101.diferenca, 0.6)
  perto(p101.custoDepois, 1.8)
  perto(p101.cmvAntes!, 0.12)
  perto(p101.cmvDepois!, 0.18)
  assert.equal(s.find((x) => x.raiz === 100)!.cmvDepois, null)
  // insumo sem custo hoje conta como zero
  perto(simularPreco([{ raiz: 1, quantidade: 2, custo: 0, custoRaiz: 3, direto: true, preco: 0.01 }], null, 1)[0].custoDepois, 5)
})

test('lerPreco aceita vírgula, ponto e R$', () => {
  assert.equal(lerPreco('12,50'), 12.5)
  assert.equal(lerPreco('R$ 1.234,5'), 1234.5)
  assert.equal(lerPreco('12.5'), 12.5)
  assert.equal(lerPreco(''), null)
  assert.equal(lerPreco('-3'), null)
  assert.equal(lerPreco('abc'), null)
})

const pr = (codigo: number, custo: number, preco: number | null, situacao: string, sobraSalao: number | null = null): PratoResumo =>
  ({ codigo, descricao: `P${codigo}`, custo, preco, cmv: preco ? custo / preco : null, situacao, sobraSalao, tipo: 'prato' })

test('pratos que mais pesam e que mais deixam', () => {
  const l = [pr(1, 40, 100, 'acima'), pr(2, 10, 20, 'acima'), pr(3, 33, 100, 'atencao'), pr(4, 20, 100, 'ok', 60), pr(5, 5, 50, 'ok', 30), pr(6, 9, null, 'sem_preco')]
  const pesam = pratosQueMaisPesam(l, 0.3)
  assert.deepEqual(pesam.map((x) => x.codigo), [1, 2, 3])
  perto(pesam[0].excesso, 10)
  assert.deepEqual(pratosQueMaisDeixam(l).map((x) => x.codigo), [4, 5])
})

test('CMV típico agora e antes', () => {
  const l = [pr(1, 30, 100, 'ok'), pr(2, 40, 100, 'acima'), pr(3, 20, 100, 'ok'), pr(4, 5, null, 'sem_preco')]
  const r = cmvTipicoAgoraEAntes(l, new Map([[1, 3], [2, 4], [3, 2]]))
  perto(r.agora!, 0.3)
  perto(r.antes!, 0.27)
})

test('situação do estoque', () => {
  assert.equal(situacaoEstoque(-1, 5), 'negativo')
  assert.equal(situacaoEstoque(0, 5), 'zerado')
  assert.equal(situacaoEstoque(2, 5), 'abaixo')
  assert.equal(situacaoEstoque(5, 5), 'ok')
  assert.equal(situacaoEstoque(3, 0), 'sem_minimo')
})

test('quantidade sugerida e arredondamento', () => {
  assert.equal(arredondarCompra(3.2, 'KG'), 3.5)
  assert.equal(arredondarCompra(3.2, 'UN'), 4)
  assert.equal(arredondarCompra(320, 'G'), 400)
  assert.equal(quantidadeSugerida(5, 5, 'KG', null), 0)
  // falta 3 + metade do mínimo 2,5 = 5,5
  assert.equal(quantidadeSugerida(2, 5, 'KG', null), 5.5)
  // saldo negativo conta como zero; consumo 1/dia × 7
  assert.equal(quantidadeSugerida(-4, 5, 'UN', 1), 12)
  assert.equal(quantidadeSugerida(0, 0, 'UN', 1), 0)
})

test('lista de compras por fornecedor e texto do WhatsApp', () => {
  const g = agruparPorFornecedor([
    { codigo: 1, descricao: 'Tomate', unidade: 'KG', fornecedor: 'Ceasa ', quantidade: 5, custoUnitario: 4 },
    { codigo: 2, descricao: 'Alface', unidade: 'UN', fornecedor: 'ceasa', quantidade: 3, custoUnitario: null },
    { codigo: 3, descricao: 'Sal', unidade: 'KG', fornecedor: null, quantidade: 1, custoUnitario: 2 },
    { codigo: 4, descricao: 'Azeite', unidade: 'L', fornecedor: 'Atacadão', quantidade: 1.5, custoUnitario: 30 },
  ])
  assert.deepEqual(g.map((x) => x.fornecedor), ['Atacadão', 'Ceasa', null])
  assert.deepEqual(g[1].itens.map((i) => i.descricao), ['Alface', 'Tomate'])
  assert.equal(g[1].total, 20)
  const t = textoWhatsApp(g)
  assert.ok(t.startsWith('Lista de compras'))
  assert.ok(t.includes('*Atacadão*\n- 1,5 l de Azeite'))
  assert.ok(t.includes('*Sem fornecedor*\n- 1 kg de Sal'))
})

test('variação pelas compras: últimos 30 dias contra 30–120 dias antes, ponderada', () => {
  const v = variacaoPorCompras([
    { produto: 1, data: '2026-11-01', quantidade: 10, valor: 50 }, // 5,00
    { produto: 1, data: '2026-10-25', quantidade: 10, valor: 70 }, // 7,00 → recente 6,00
    { produto: 1, data: '2026-09-20', quantidade: 30, valor: 120 }, // 4,00
    { produto: 1, data: '2026-10-10', quantidade: 10, valor: 60 }, // 6,00 → antes 180/40 = 4,50
    { produto: 1, data: '2026-07-01', quantidade: 10, valor: 999 }, // fora da janela
    { produto: 2, data: '2026-11-05', quantidade: 1, valor: 9 }, // sem compra antes: fora
    { produto: 3, data: '2026-11-13', quantidade: 1, valor: 9 }, // futuro: fora
    { produto: 3, data: '2026-09-01', quantidade: 0, valor: 9 }, // quantidade zero: fora
  ], '2026-11-12')
  const a = v.get(1)!
  perto(a.agora, 6)
  perto(a.antes, 4.5)
  perto(a.variacao, 1 / 3)
  assert.equal(a.ultimaData, '2026-11-01')
  assert.equal(a.nAgora, 2)
  assert.equal(a.nAntes, 2)
  assert.equal(v.has(2), false)
  assert.equal(v.has(3), false)
})

test('custo antes implícito leva a variação das compras para a escala do custo médio', () => {
  const m = custoAntesImplicito(new Map<number, number | null>([[1, 12], [2, null]]), new Map([[1, 0.2], [2, 0.5], [3, 0.1]]))
  perto(m.get(1)!, 10)
  assert.equal(m.has(2), false)
  assert.equal(m.has(3), false)
})
