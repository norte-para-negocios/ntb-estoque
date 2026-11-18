// Testes do gabarito do faturamento e do CMV (ticket 08). Todos os valores esperados foram calculados à mão.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { faturamentoPorDia, faturamentoPorMes, cmcNoMarco, custoUnitario, cmvDaLinha, cmvPorRotulo, custoMedioDeHoje, cmvEstimado, decompor, texto, dec, centavos, type SerieCusto, type Fichas, type LinhaVenda } from './cmv-gabarito.ts'

const vendas = [
  { data: '2026-10-01', valor: '100.50', cancelado: false, devolvido: false },
  { data: '2026-10-01', valor: '20', cancelado: true, devolvido: false },
  { data: '2026-10-01', valor: '30', cancelado: false, devolvido: true },
  { data: '2026-10-02', valor: '10', cancelado: false, devolvido: false },
  { data: '2026-11-03', valor: '5.25', cancelado: false, devolvido: false },
]

test('faturamento do dia, loja Omie: cancelada fora, devolvida dentro (100,50 + 30 = 130,50)', () => {
  const d = faturamentoPorDia(vendas, 'omie')
  assert.equal(texto(d.get('2026-10-01')!), '130.5')
  assert.equal(texto(d.get('2026-10-02')!), '10')
})

test('faturamento do dia, loja própria: cancelada e devolvida fora (só 100,50)', () => {
  assert.equal(texto(faturamentoPorDia(vendas, 'proprio').get('2026-10-01')!), '100.5')
})

test('faturamento do mês = soma dos dias: outubro própria 110,50 e novembro 5,25', () => {
  const m = faturamentoPorMes(faturamentoPorDia(vendas, 'proprio'))
  assert.equal(texto(m.get('2026-10')!), '110.5')
  assert.equal(texto(m.get('2026-11')!), '5.25')
})

const serie: SerieCusto = new Map([
  ['A', [{ d: '2026-10-01', id: 1, cmc: '2' }, { d: '2026-10-05', id: 10, cmc: '3' }]],
  ['B', [{ d: '2026-10-01', id: 2, cmc: '3' }]],
  ['X', [{ d: '2026-10-01', id: 3, cmc: '1' }]],
])

test('custo médio vigente: o último movimento ANTES do marco', () => {
  assert.equal(texto(cmcNoMarco(serie, 'A', { d: '2026-10-05', id: 10 })!), '2') // o movimento 10 ainda não aconteceu
  assert.equal(texto(cmcNoMarco(serie, 'A', { d: '2026-10-05', id: 11 })!), '3')
  assert.equal(texto(cmcNoMarco(serie, 'A', { d: '2026-12-31', id: 0 })!), '3')
  assert.equal(cmcNoMarco(serie, 'A', { d: '2026-10-01', id: 1 }), null)
  assert.equal(cmcNoMarco(serie, 'Z', { d: '2026-12-31', id: 0 }), null)
})

// Prato P rende 2 porções. Item A: líquida 1, fator 1, perda 10% => bruta 1,1. Item B: líquida 0,5, fator 2 => bruta 1.
const fichas: Fichas = new Map([
  ['P', { rendimento: '2', expandir: false, itens: [{ insumo: 'A', liquida: '1', fator: '1', perda: '10' }, { insumo: 'B', liquida: '0.5', fator: '2', perda: '0' }] }],
])
const marcoDepois = { d: '2026-10-10', id: 99 }

test('custo do prato: (1,1/2) x 3 + (1/2) x 3 = 1,65 + 1,5 = 3,15 (A valia 3 em 10/10)', () => {
  assert.equal(texto(custoUnitario('P', fichas, serie, marcoDepois).custo), '3.15')
})

test('o mesmo prato antes da mudança do custo de A: (1,1/2) x 2 + 1,5 = 2,6', () => {
  assert.equal(texto(custoUnitario('P', fichas, serie, { d: '2026-10-05', id: 5 }).custo), '2.6')
})

test('insumo sem custo custa zero e é contado', () => {
  const f: Fichas = new Map([['Q', { rendimento: '1', expandir: false, itens: [{ insumo: 'C', liquida: '2', fator: '1', perda: '0' }] }]])
  const r = custoUnitario('Q', f, serie, marcoDepois)
  assert.equal(r.custo, 0n)
  assert.equal(r.semCusto, 1)
})

test('insumo que é preparação e expande na venda desce pela ficha dele', () => {
  // M: rendimento 4, usa 2 de B (3 cada) => 1,5 por unidade de M. R usa 2 unidades de M => 3.
  const f: Fichas = new Map([
    ['R', { rendimento: '1', expandir: false, itens: [{ insumo: 'M', liquida: '2', fator: '1', perda: '0' }] }],
    ['M', { rendimento: '4', expandir: true, itens: [{ insumo: 'B', liquida: '2', fator: '1', perda: '0' }] }],
  ])
  assert.equal(texto(custoUnitario('R', f, serie, marcoDepois).custo), '3')
  // sem expandir, M é folha: sem custo próprio na série => zero
  f.get('M')!.expandir = false
  assert.equal(custoUnitario('R', f, serie, marcoDepois).custo, 0n)
})

const linha = (o: Partial<LinhaVenda>): LinhaVenda => ({ vendaId: 1, data: '2026-10-10', marco: marcoDepois, codigo: 'P', nome: 'Prato', quantidade: '3', valor: '90', componentes: [], taxa: false, semBaixa: false, ...o })

test('CMV da linha: 3 pratos (3,15) + componente X (1) em cada = 3 x 4,15 = 12,45', () => {
  assert.equal(texto(cmvDaLinha(linha({ componentes: ['X'] }), fichas, serie, new Set()).custo), '12.45')
})

test('taxa de serviço e serviço não têm custo', () => {
  assert.equal(cmvDaLinha(linha({ taxa: true }), fichas, serie, new Set()).custo, 0n)
  assert.equal(cmvDaLinha(linha({ codigo: 'S1' }), fichas, serie, new Set(['S1'])).custo, 0n)
})

test('linha sem código: o custo vem do componente (2 x 1 = 2)', () => {
  assert.equal(texto(cmvDaLinha(linha({ codigo: null, quantidade: '2', componentes: ['X'] }), fichas, serie, new Set()).custo), '2')
})

test('CMV por rótulo soma as linhas e separa o que o ERP não baixou', () => {
  const m = cmvPorRotulo([linha({}), linha({ vendaId: 2, semBaixa: true })], fichas, serie, new Set(), (l) => l.nome)
  const r = m.get('Prato')!
  assert.equal(texto(r.cmv), '18.9') // 2 x 3 x 3,15
  assert.equal(texto(r.cmvSemBaixa), '9.45')
  assert.equal(r.linhasSemBaixa, 1)
  assert.equal(texto(r.faturamento), '180')
})

test('custo médio de hoje: locais com saldo ponderados ((10x2 + 30x4)/40 = 3,5); sem saldo, o geral; senão o maior', () => {
  const m = custoMedioDeHoje([
    { produto: '1', local: 10, saldo: '10', cmc: '2' }, { produto: '1', local: 20, saldo: '30', cmc: '4' }, { produto: '1', local: 0, saldo: '0', cmc: '9' },
    { produto: '2', local: 10, saldo: '0', cmc: '2' }, { produto: '2', local: 0, saldo: '0', cmc: '5' },
    { produto: '3', local: 10, saldo: '-4', cmc: '2' }, { produto: '3', local: 20, saldo: '0', cmc: '7' },
  ])
  assert.equal(texto(m.get('1')!), '3.5')
  assert.equal(texto(m.get('2')!), '5')
  assert.equal(texto(m.get('3')!), '7')
})

test('CMV estimado: 10 x 3 = 30; custo acima do preço médio (9 > 5) é fora do normal e vale zero; sem custo vale zero', () => {
  const custo = new Map([['1', dec('3')], ['2', dec('9')]])
  const m = cmvEstimado([
    { produto: '1', rotulo: 'A', quantidade: '4', valor: '40' }, { produto: '1', rotulo: 'A', quantidade: '6', valor: '60' },
    { produto: '2', rotulo: 'B', quantidade: '2', valor: '10' }, { produto: '9', rotulo: 'C', quantidade: '1', valor: '7' },
  ], custo)
  assert.equal(texto(m.get('1')!.cmv), '30')
  assert.equal(texto(m.get('2')!.cmv), '0'); assert.equal(m.get('2')!.foraDoNormal, true)
  assert.equal(m.get('9')!.semCustoMedio, true)
})

test('decompor: lista só o que passa da tolerância, a maior diferença primeiro', () => {
  const tela = new Map([['A', dec('100')], ['B', dec('50.04')], ['C', dec('10')]])
  const gab = new Map([['A', dec('90')], ['B', dec('50')], ['D', dec('4')]])
  const r = decompor(tela, gab, dec('0.05'))
  assert.deepEqual(r.map((x) => [x.rotulo, texto(x.diferenca)]), [['A', '10'], ['C', '10'], ['D', '-4']])
})

test('centavos arredonda meia para longe do zero', () => {
  assert.equal(centavos(dec('1.005')), 101n)
  assert.equal(centavos(dec('-1.005')), -101n)
})
