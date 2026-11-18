import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDec, fmtDec, saldoPorLedger, saldoPorKardex, somarLocais, compararSaldos, lerNumeroBR, TOLERANCIA_TELA } from './saldo-gabarito.ts'

const D = (s: string) => parseDec(s)

test('decimais exatos: 0,1 + 0,2 = 0,3 e formatação sem erro de ponto flutuante', () => {
  assert.equal(D('0.1') + D('0.2'), D('0.3'))
  assert.equal(fmtDec(D('-1.250000')), '-1.25')
  assert.equal(fmtDec(D('10')), '10')
  assert.equal(D('-0.000001') < 0n, true)
})

test('lê o número como a tela mostra (pt-BR)', () => {
  assert.equal(lerNumeroBR('-6.040,594'), D('-6040.594'))
  assert.equal(lerNumeroBR('1.234'), D('1234'))
  assert.equal(lerNumeroBR('0,5'), D('0.5'))
  assert.equal(lerNumeroBR('-0'), 0n)
})

test('ledger: entrada, saída e ajuste somam; estorno devolve; dois locais viram um item', () => {
  const s = saldoPorLedger([
    { produto: 1, local: 10, quantidade: '10' }, // compra
    { produto: 1, local: 10, quantidade: '-3' }, // venda
    { produto: 1, local: 10, quantidade: '-2' }, // ajuste de inventário
    { produto: 1, local: 20, quantidade: '4.5' }, // outro local
    { produto: 2, local: 10, quantidade: '-1' }, // venda antes da compra: negativo
    { produto: 2, local: 10, quantidade: '1' }, // estorno dela
  ])
  assert.equal(s.get('1:10'), D('5'))
  assert.equal(s.get('1:20'), D('4.5'))
  assert.equal(s.get('2:10'), 0n)
  const item = somarLocais(s)
  assert.equal(item.get(1), D('9.5'))
  assert.equal(item.get(2), 0n)
})

test('kardex: abertura vem da primeira linha, ordem de entrada não importa, cancelada não conta', () => {
  const s = saldoPorKardex([
    { produto: 1, local: 10, dataMov: '2026-01-03', idMov: 30, quantidade: '-1', saldoApos: '4', cancelado: false },
    { produto: 1, local: 10, dataMov: '2026-01-02', idMov: 20, quantidade: '2', saldoApos: '5', cancelado: false }, // abertura = 5-2 = 3
    { produto: 1, local: 10, dataMov: '2026-01-04', idMov: 40, quantidade: '-9', saldoApos: '-5', cancelado: true },
    { produto: 3, local: 10, dataMov: '2026-01-02', idMov: 21, quantidade: '-1', saldoApos: '0', cancelado: false }, // abertura 1, fim 0
  ])
  assert.equal(s.get('1:10'), D('4'))
  assert.equal(s.get('3:10'), 0n)
  assert.equal(s.has('9:9'), false)
})

test('kardex: mesma data, desempata pelo id do movimento', () => {
  const s = saldoPorKardex([
    { produto: 1, local: 10, dataMov: '2026-01-02', idMov: 2, quantidade: '1', saldoApos: '2', cancelado: false },
    { produto: 1, local: 10, dataMov: '2026-01-02', idMov: 1, quantidade: '-1', saldoApos: '1', cancelado: false }, // primeira: abertura 2
  ])
  assert.equal(s.get('1:10'), D('2'))
})

test('comparação: igual dentro do arredondamento da tela (3 casas) não é diferença', () => {
  const r = compararSaldos({ gabarito: new Map([[1, D('1.2344')], [2, D('5')]]), tela: new Map([[1, D('1.234')], [2, D('5.001')]]) })
  assert.equal(r.comparados, 2)
  assert.deepEqual(r.divergencias.map((d) => d.produto), [2])
  assert.equal(r.divergencias[0].esperado, D('5'))
  assert.equal(r.divergencias[0].mostrado, D('5.001'))
  assert.equal(TOLERANCIA_TELA, D('0.0005'))
})

test('comparação: item sem linha na tela só falha se o gabarito tem saldo', () => {
  const r = compararSaldos({ gabarito: new Map([[1, D('3')], [2, 0n]]), tela: new Map() })
  assert.deepEqual(r.divergencias.map((d) => [d.produto, d.mostrado]), [[1, null]])
})

test('comparação: item na tela com saldo e sem nada no gabarito é diferença (esperado 0)', () => {
  const r = compararSaldos({ gabarito: new Map(), tela: new Map([[7, D('2')], [8, 0n]]) })
  assert.deepEqual(r.divergencias.map((d) => [d.produto, d.esperado, d.mostrado]), [[7, 0n, D('2')]])
})

test('origem (Sertão): tela diferente do Omie = ERP; tela igual ao Omie mas gabarito diferente = Omie', () => {
  const r = compararSaldos({
    gabarito: new Map([[1, D('10')], [2, D('10')], [3, D('10')]]),
    tela: new Map([[1, D('7')], [2, D('7')], [3, D('10')]]),
    omie: new Map([[1, D('9')], [2, D('7')], [3, D('10')]]),
  })
  const o = Object.fromEntries(r.divergencias.map((d) => [d.produto, d.origem]))
  assert.deepEqual(o, { 1: 'ERP', 2: 'Omie' })
  assert.equal(r.divergencias.find((d) => d.produto === 1)!.omie, D('9'))
})

test('sem Omie a origem fica vazia; item sem gabarito confiável não é comparado', () => {
  const r = compararSaldos({ gabarito: new Map([[1, D('1')]]), tela: new Map([[1, D('2')], [5, D('9')]]), semGabarito: new Set([5]) })
  assert.equal(r.divergencias.length, 1)
  assert.equal(r.divergencias[0].origem, null)
  assert.equal(r.comparados, 1)
  assert.deepEqual(r.naoComparaveis, [5])
})
