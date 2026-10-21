import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  aplicarEstorno, arredondar2, calcularPagamento, competenciaDe, paraCentavos, podeCancelar, podeEditarDinheiro, podePagar,
  saldoConta, situacaoTitulo, statusPorQuitado,
} from './titulo-puro.ts'
import { hojeBahiaISO } from '../data-bahia.ts'

test('centavos: pt-BR, ponto decimal e arredondamento sem erro de ponto flutuante', () => {
  assert.equal(paraCentavos('1.234,56'), 123456)
  assert.equal(paraCentavos('12,5'), 1250)
  assert.equal(paraCentavos('10.05'), 1005)
  assert.equal(paraCentavos(0.1 + 0.2), 30)
  assert.equal(paraCentavos(1.005), 101) // 1.005*100 = 100.49999… → toPrecision(15) = 100.5 → 101
  assert.ok(Number.isNaN(paraCentavos('')))
  assert.ok(Number.isNaN(paraCentavos('abc')))
  assert.equal(arredondar2(5000.555), 5000.56)
  assert.equal(arredondar2(2.675), 2.68)
})

test('status guardado depende só do quitado', () => {
  assert.equal(statusPorQuitado(10000, 0), 'aberto')
  assert.equal(statusPorQuitado(10000, 1), 'parcial')
  assert.equal(statusPorQuitado(10000, 9999), 'parcial')
  assert.equal(statusPorQuitado(10000, 10000), 'pago')
})

test('situação derivada: atrasado só com saldo a pagar e vencimento anterior a hoje', () => {
  const hoje = '2026-10-21'
  assert.equal(situacaoTitulo('aberto', '2026-10-21', hoje), 'aberto') // vence hoje ainda não está atrasado
  assert.equal(situacaoTitulo('aberto', '2026-10-20', hoje), 'atrasado')
  assert.equal(situacaoTitulo('parcial', '2026-10-20', hoje), 'atrasado')
  assert.equal(situacaoTitulo('parcial', '2026-10-25', hoje), 'parcial')
  assert.equal(situacaoTitulo('pago', '2026-01-01', hoje), 'pago')
  assert.equal(situacaoTitulo('cancelado', '2026-01-01', hoje), 'cancelado')
})

test('"hoje" é o dia da Bahia, não o de UTC (atrasado vira só à meia-noite daqui)', () => {
  // 22/10 01:30 UTC = 21/10 22:30 na Bahia (UTC-3)
  const noite = new Date('2026-10-22T01:30:00Z')
  assert.equal(hojeBahiaISO(noite), '2026-10-21')
  assert.equal(situacaoTitulo('aberto', '2026-10-21', hojeBahiaISO(noite)), 'aberto')
  // 22/10 03:00 UTC = 00:00 na Bahia: agora sim virou atrasado
  const virou = new Date('2026-10-22T03:00:00Z')
  assert.equal(hojeBahiaISO(virou), '2026-10-22')
  assert.equal(situacaoTitulo('aberto', '2026-10-21', hojeBahiaISO(virou)), 'atrasado')
})

test('competência padrão = mês do vencimento', () => {
  assert.equal(competenciaDe(null, '2026-11-30'), '2026-11-01')
  assert.equal(competenciaDe('2026-10', '2026-11-30'), '2026-10-01')
  assert.equal(competenciaDe('2026-10-17', '2026-11-30'), '2026-10-01')
  assert.equal(competenciaDe('lixo', '2026-11-30'), '2026-11-01')
})

test('baixa total quita o saldo e deixa o título pago', () => {
  const r = calcularPagamento({ restanteCent: 30000, principalCent: null, jurosCent: 0, descontoCent: 0 })
  assert.deepEqual(r, { ok: true, principalCent: 30000, pagoCent: 30000, restanteDepoisCent: 0, statusDepois: 'pago' })
})

test('baixa parcial com juros e desconto: sai principal + juros − desconto', () => {
  const r = calcularPagamento({ restanteCent: 30000, principalCent: 10000, jurosCent: 500, descontoCent: 200 })
  assert.deepEqual(r, { ok: true, principalCent: 10000, pagoCent: 10300, restanteDepoisCent: 20000, statusDepois: 'parcial' })
})

test('desconto pode quitar o título com saída menor que o valor', () => {
  const r = calcularPagamento({ restanteCent: 10000, principalCent: null, jurosCent: 0, descontoCent: 1000 })
  assert.equal(r.ok && r.pagoCent, 9000)
  assert.equal(r.ok && r.statusDepois, 'pago')
})

test('baixas recusadas', () => {
  const base = { restanteCent: 10000, principalCent: 5000, jurosCent: 0, descontoCent: 0 }
  assert.equal(calcularPagamento({ ...base, principalCent: 10001 }).ok, false) // passa do saldo
  assert.equal(calcularPagamento({ ...base, principalCent: 0 }).ok, false)
  assert.equal(calcularPagamento({ ...base, jurosCent: -1 }).ok, false)
  assert.equal(calcularPagamento({ ...base, descontoCent: 5001 }).ok, false) // desconto > principal
  assert.equal(calcularPagamento({ ...base, descontoCent: 5000 }).ok, false) // saída zero
  assert.equal(calcularPagamento({ ...base, restanteCent: 0 }).ok, false) // já pago
  assert.equal(calcularPagamento({ ...base, principalCent: NaN }).ok, false)
})

test('duas parcelas somam o título sem sobra de centavo', () => {
  const a = calcularPagamento({ restanteCent: 10033, principalCent: 3344, jurosCent: 0, descontoCent: 0 })
  assert.ok(a.ok)
  const b = calcularPagamento({ restanteCent: a.ok ? a.restanteDepoisCent : 0, principalCent: null, jurosCent: 0, descontoCent: 0 })
  assert.ok(b.ok && b.statusDepois === 'pago' && b.principalCent === 10033 - 3344)
})

test('estorno devolve o principal ao título e a situação volta coerente', () => {
  assert.deepEqual(aplicarEstorno(25000, 25000, 15000), { quitadoCent: 10000, status: 'parcial' })
  assert.deepEqual(aplicarEstorno(25000, 10000, 10000), { quitadoCent: 0, status: 'aberto' })
  assert.deepEqual(aplicarEstorno(25000, 0, 5000), { quitadoCent: 0, status: 'aberto' }) // nunca negativo
})

test('juros e desconto não entram no que o título quitou: estorno devolve só o principal', () => {
  const p = calcularPagamento({ restanteCent: 10000, principalCent: 10000, jurosCent: 700, descontoCent: 0 })
  assert.ok(p.ok && p.pagoCent === 10700)
  const e = aplicarEstorno(10000, 10000, p.ok ? p.principalCent : 0)
  assert.deepEqual(e, { quitadoCent: 0, status: 'aberto' })
})

test('cancelar e editar/pagar por status', () => {
  assert.equal(podeCancelar('aberto', 0).ok, true)
  assert.equal(podeCancelar('parcial', 100).ok, false)
  assert.equal(podeCancelar('pago', 10000).ok, false)
  assert.equal(podeCancelar('cancelado', 0).ok, true) // idempotente
  assert.equal(podePagar('aberto'), true)
  assert.equal(podePagar('parcial'), true)
  assert.equal(podePagar('pago'), false)
  assert.equal(podePagar('cancelado'), false)
  assert.equal(podeEditarDinheiro('pago'), false)
})

test('saldo da conta: inicial + entradas − saídas, estorno é entrada', () => {
  const saldo = saldoConta(100000, [
    { tipo: 'saida', valorCent: 10300 },
    { tipo: 'entrada', valorCent: 10300 }, // estorno
    { tipo: 'saida', valorCent: 15000 },
  ])
  assert.equal(saldo, 85000)
})
