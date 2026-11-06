import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FORMAS_RECEBIMENTO, formaDoPagamento, somarDias, calcularPrevisto, janelaGeracao, situacaoReceber, validarFormaRecebimento,
} from './receber-vendas-puro.ts'

// Espelho de fin_cr_forma_do_pagamento (migration 380). O teste SQL confere a mesma tabela no banco.
test('forma do pagamento: o que o Norte Vendas manda hoje (metodo + bandeira)', () => {
  assert.equal(formaDoPagamento('CREDIT', 'visa'), 'credito')
  assert.equal(formaDoPagamento('DEBIT', 'mastercard'), 'debito')
  assert.equal(formaDoPagamento('PIX', null), 'pix')
  assert.equal(formaDoPagamento('CASH', null), 'dinheiro')
  // vale-refeição entra no caixa do Vendas como cartão com bandeira de vale (lib/labels.ts do Vendas)
  assert.equal(formaDoPagamento('DEBIT', 'ticket'), 'voucher')
  assert.equal(formaDoPagamento('CREDIT', 'Alelo'), 'voucher')
  assert.equal(formaDoPagamento('credit', ' SODEXO '), 'voucher')
  assert.equal(formaDoPagamento('DEBIT', 'vr'), 'voucher')
})

test('forma do pagamento: nomes que o Vendas ainda não manda, mas que viram a forma certa quando mandar', () => {
  assert.equal(formaDoPagamento('VOUCHER', null), 'voucher')
  assert.equal(formaDoPagamento('MEAL_VOUCHER', null), 'voucher')
  assert.equal(formaDoPagamento('IFOOD', null), 'app_entrega')
  assert.equal(formaDoPagamento('APP_ENTREGA', null), 'app_entrega')
  assert.equal(formaDoPagamento('rappi', null), 'app_entrega')
})

test('forma do pagamento: o que não se conhece vai para "outros" (dinheiro nunca some)', () => {
  assert.equal(formaDoPagamento('OUTRO', null), 'outros')
  assert.equal(formaDoPagamento('', null), 'outros')
  assert.equal(formaDoPagamento(null, null), 'outros')
  assert.equal(formaDoPagamento('PIX', 'ticket'), 'pix') // bandeira de vale só conta em cartão
  assert.ok(FORMAS_RECEBIMENTO.includes('outros'))
})

test('prazo em dias corridos e em dias úteis (segunda a sexta, sem feriado)', () => {
  assert.equal(somarDias('2026-11-06', 0, false), '2026-11-06')
  assert.equal(somarDias('2026-11-06', 1, false), '2026-11-07')
  assert.equal(somarDias('2026-11-06', 30, false), '2026-12-06')
  // 06/11/2026 é sexta: D+1 útil = segunda 09/11
  assert.equal(somarDias('2026-11-06', 1, true), '2026-11-09')
  assert.equal(somarDias('2026-11-06', 2, true), '2026-11-10')
  // sábado + 0 útil = o próprio dia (prazo zero não anda)
  assert.equal(somarDias('2026-11-07', 0, true), '2026-11-07')
  assert.equal(somarDias('2026-11-07', 1, true), '2026-11-09')
  assert.equal(somarDias('2026-12-31', 1, false), '2027-01-01')
})

test('valor previsto: taxa % sobre o bruto + taxa fixa por pagamento, arredondada como o round() do Postgres', () => {
  // 150 × 3,19% = 4,785 + 2 × 0,10 = 4,985 → 4,99 (meio para cima, como numeric)
  assert.deepEqual(calcularPrevisto({ bruto: 150, quantidade: 2, taxaPercentual: 3.19, taxaFixa: 0.1 }), { taxa: 4.99, liquido: 145.01 })
  assert.deepEqual(calcularPrevisto({ bruto: 100, quantidade: 1, taxaPercentual: 0, taxaFixa: 0 }), { taxa: 0, liquido: 100 })
  assert.deepEqual(calcularPrevisto({ bruto: 0.1, quantidade: 3, taxaPercentual: 0, taxaFixa: 0.5 }), { taxa: 0.1, liquido: 0 }) // taxa nunca passa do bruto
  assert.deepEqual(calcularPrevisto({ bruto: 2133.22, quantidade: 18, taxaPercentual: 1.5, taxaFixa: 0 }), { taxa: 32, liquido: 2101.22 })
})

test('janela do cron: últimos N dias até hoje', () => {
  assert.deepEqual(janelaGeracao('2026-11-05', 7), { de: '2026-10-29', ate: '2026-11-05' })
  assert.deepEqual(janelaGeracao('2026-11-05', 0), { de: '2026-11-05', ate: '2026-11-05' })
  assert.deepEqual(janelaGeracao('2026-11-05', -3), { de: '2026-11-05', ate: '2026-11-05' })
  assert.deepEqual(janelaGeracao('2026-11-05', 500), { de: '2026-08-05', ate: '2026-11-05' }) // teto de 92 dias para trás (93 dias com hoje) da função SQL
})

test('situação: atrasado = em aberto com data prevista antes de hoje', () => {
  assert.equal(situacaoReceber('aberto', '2026-11-04', '2026-11-05'), 'atrasado')
  assert.equal(situacaoReceber('aberto', '2026-11-05', '2026-11-05'), 'aberto')
  assert.equal(situacaoReceber('recebido', '2026-11-01', '2026-11-05'), 'recebido')
  assert.equal(situacaoReceber('cancelado', '2026-11-01', '2026-11-05'), 'cancelado')
})

test('cadastro da forma: valida antes de mandar ao banco', () => {
  assert.equal(validarFormaRecebimento({ forma: 'credito', taxaPercentual: 3.19, taxaFixa: 0, prazoDias: 30 }), null)
  assert.match(validarFormaRecebimento({ forma: 'cheque', taxaPercentual: 0, taxaFixa: 0, prazoDias: 0 })!, /Forma/)
  assert.match(validarFormaRecebimento({ forma: 'pix', taxaPercentual: 100, taxaFixa: 0, prazoDias: 0 })!, /taxa/i)
  assert.match(validarFormaRecebimento({ forma: 'pix', taxaPercentual: -1, taxaFixa: 0, prazoDias: 0 })!, /taxa/i)
  assert.match(validarFormaRecebimento({ forma: 'pix', taxaPercentual: NaN, taxaFixa: 0, prazoDias: 0 })!, /taxa/i)
  assert.match(validarFormaRecebimento({ forma: 'pix', taxaPercentual: 0, taxaFixa: -0.01, prazoDias: 0 })!, /fixa/i)
  assert.match(validarFormaRecebimento({ forma: 'pix', taxaPercentual: 0, taxaFixa: 0, prazoDias: 401 })!, /prazo/i)
  assert.match(validarFormaRecebimento({ forma: 'pix', taxaPercentual: 0, taxaFixa: 0, prazoDias: 1.5 })!, /prazo/i)
})
