import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  diasInclusivos, periodosPadrao, calcularSugestao, acaoDoProduto, tipoPadraoIncluido, deveListar, rotuloRecomendacao,
} from './sugestao-puro.ts'

// Linhas reais do grid "Sugestão de Compras" do Omie (loja 5, 17/10/2026, ~/Projects/omie-rea/telas/COM/sugestao-compra).
const P = { diasAnalise: 30, diasEstimativa: 15, base: 'consumo' as const }

test('diasInclusivos conta as duas pontas', () => {
  assert.equal(diasInclusivos('2026-09-01', '2026-09-30'), 30)
  assert.equal(diasInclusivos('2026-10-17', '2026-10-31'), 15)
  assert.equal(diasInclusivos('2026-10-31', '2026-10-31'), 1)
  assert.equal(diasInclusivos('2026-10-31', '2026-10-01'), 0)
})

test('periodosPadrao: mês anterior inteiro e de hoje até o fim do mês (como o Omie)', () => {
  assert.deepEqual(periodosPadrao('2026-10-17'), { analise: { ini: '2026-09-01', fim: '2026-09-30' }, estimativa: { ini: '2026-10-17', fim: '2026-10-31' } })
  assert.deepEqual(periodosPadrao('2026-10-31').estimativa, { ini: '2026-10-31', fim: '2026-10-31' })
  assert.deepEqual(periodosPadrao('2026-01-05').analise, { ini: '2025-12-01', fim: '2025-12-31' })
  assert.deepEqual(periodosPadrao('2026-03-10').analise, { ini: '2026-02-01', fim: '2026-02-28' })
})

test('90001 Agua Mineral: imediato, sugestão 376,7', () => {
  const r = calcularSugestao({ consumoTotal: 1146, estoqueMinimo: 120, estoqueAtual: 150.5, leadTime: 1, entradaPrevista: 204 }, P)
  assert.equal(r.consumoMedio, 38.2)
  assert.equal(r.pontoPedido, 158.2)
  assert.equal(r.saidaProjetada, 573)
  assert.equal(r.sugestao, 376.7)
  assert.equal(r.duracao, 3)
  assert.equal(r.diasAtePonto, 0)
  assert.equal(r.recomendacao, 'imediato')
})

test('80006 Alface com estoque negativo: duração -14, sugestão 1,938667', () => {
  const r = calcularSugestao({ consumoTotal: 4.61, estoqueMinimo: 0, estoqueAtual: -2.18, leadTime: null, entradaPrevista: 2.7 }, P)
  assert.equal(r.consumoMedio, 0.153667)
  assert.equal(r.pontoPedido, 0.153667)
  assert.equal(r.saidaProjetada, 2.305)
  assert.equal(r.duracao, -14)
  assert.equal(r.diasAtePonto, 0)
  assert.equal(r.sugestao, 1.938667)
  assert.equal(r.recomendacao, 'imediato')
})

test('60002 Agua sanitária: próximos dias (1 dia até o ponto)', () => {
  const r = calcularSugestao({ consumoTotal: 158, estoqueMinimo: 5, estoqueAtual: 20, leadTime: 0, entradaPrevista: 0 }, P)
  assert.equal(r.pontoPedido, 10.266667)
  assert.equal(r.diasAtePonto, 1)
  assert.equal(r.duracao, 3)
  assert.equal(r.sugestao, 69.266667)
  assert.equal(r.recomendacao, 'proximos')
})

test('80000 Abacaxi: não comprar, 594 dias até o ponto', () => {
  const r = calcularSugestao({ consumoTotal: 39.75, estoqueMinimo: 0, estoqueAtual: 788.41, leadTime: 1, entradaPrevista: 63.75 }, P)
  assert.equal(r.sugestao, 0)
  assert.equal(r.duracao, 595)
  assert.equal(r.diasAtePonto, 594)
  assert.equal(r.recomendacao, 'nao')
})

test('90778 sem consumo e estoque negativo: sugestão cobre o buraco, sem dividir por zero', () => {
  const r = calcularSugestao({ consumoTotal: 0, estoqueMinimo: 0, estoqueAtual: -23586.71, leadTime: 1, entradaPrevista: 0 }, P)
  assert.equal(r.duracao, 0)
  assert.equal(r.diasAtePonto, 0)
  assert.equal(r.sugestao, 23586.71)
  assert.equal(r.recomendacao, 'imediato')
})

test('60276 parado: tudo zero, não comprar', () => {
  const r = calcularSugestao({ consumoTotal: 0, estoqueMinimo: 0, estoqueAtual: 39.848, leadTime: 1, entradaPrevista: 0 }, P)
  assert.deepEqual([r.consumoMedio, r.pontoPedido, r.saidaProjetada, r.sugestao, r.duracao, r.diasAtePonto], [0, 0, 0, 0, 0, 0])
  assert.equal(r.recomendacao, 'nao')
})

test('lead time maior aumenta o ponto de pedido; lead time vazio vale 1 dia', () => {
  const e = { consumoTotal: 300, estoqueMinimo: 10, estoqueAtual: 100, leadTime: 3, entradaPrevista: 0 }
  assert.equal(calcularSugestao(e, P).pontoPedido, 40)
  assert.equal(calcularSugestao({ ...e, leadTime: null }, P).pontoPedido, 20)
})

test("base 'previsao': projeção = previsão de venda + consumo nas OPs abertas", () => {
  const e = { consumoTotal: 300, estoqueMinimo: 0, estoqueAtual: 50, leadTime: 1, entradaPrevista: 0, saidaPrevista: 80 }
  const r = calcularSugestao(e, { ...P, base: 'previsao' })
  assert.equal(r.saidaProjetada, 80)
  assert.equal(r.sugestao, 40) // 80 + 10 - 50
  // sem saidaPrevista cai na do Omie
  assert.equal(calcularSugestao({ ...e, saidaPrevista: null }, { ...P, base: 'previsao' }).saidaProjetada, 150)
})

test('acaoDoProduto: tipo 03/04 ou com ficha produz; o resto compra', () => {
  assert.equal(acaoDoProduto('04', false), 'produzir')
  assert.equal(acaoDoProduto('03', false), 'produzir')
  assert.equal(acaoDoProduto('01', true), 'produzir')
  assert.equal(acaoDoProduto('00', false), 'comprar')
  assert.equal(acaoDoProduto(null, false), 'comprar')
})

test('tipos fora por padrão: ativo imobilizado, serviço e outras', () => {
  assert.equal(tipoPadraoIncluido('08'), false)
  assert.equal(tipoPadraoIncluido('09'), false)
  assert.equal(tipoPadraoIncluido('99'), false)
  assert.equal(tipoPadraoIncluido('01'), true)
  assert.equal(tipoPadraoIncluido(null), true)
})

test('deveListar: só produto com alguma coisa a mostrar', () => {
  assert.equal(deveListar({ consumoTotal: 0, estoqueMinimo: 0, estoqueAtual: 0, entradaPrevista: 0 }), false)
  assert.equal(deveListar({ consumoTotal: 0, estoqueMinimo: 1, estoqueAtual: 0, entradaPrevista: 0 }), true)
  assert.equal(deveListar({ consumoTotal: 0, estoqueMinimo: 0, estoqueAtual: -1, entradaPrevista: 0 }), true)
})

test('rotuloRecomendacao segue o texto do Omie', () => {
  assert.equal(rotuloRecomendacao('imediato', 'comprar'), 'Comprar imediatamente')
  assert.equal(rotuloRecomendacao('proximos', 'produzir'), 'Produzir nos próximos dias')
  assert.equal(rotuloRecomendacao('nao', 'comprar'), 'Não comprar')
})

test('as 50 linhas capturadas do Omie batem (ponto, saída, sugestão, duração, dias, recomendação)', async () => {
  const { readFile } = await import('node:fs/promises')
  const fx = JSON.parse(await readFile(new URL('./fixtures/omie-sugestao-loja5-2026-10-17.json', import.meta.url), 'utf8'))
  let n = 0
  for (const l of fx.linhas) {
    const r = calcularSugestao({ consumoTotal: l.consumoTotal, estoqueMinimo: l.estoqueMinimo, estoqueAtual: l.estoqueAtual, leadTime: l.leadTime, entradaPrevista: l.entradaPrevista }, P)
    const msg = `produto ${l.codigo}`
    assert.equal(r.consumoMedio, l.consumoMedio, msg)
    assert.equal(r.pontoPedido, l.pontoPedido, msg)
    assert.equal(r.saidaProjetada, l.saidaProjetada, msg)
    assert.equal(r.sugestao, l.sugestao, msg)
    assert.equal(r.duracao, l.duracao, msg)
    assert.equal(r.diasAtePonto, l.diasAtePonto, msg)
    assert.equal(r.recomendacao, l.recomendacao, msg)
    n++
  }
  assert.equal(n, 50)
})
