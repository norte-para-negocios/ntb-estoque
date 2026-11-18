// Testes do gabarito do inventário (ticket 06). Valores esperados calculados à mão, com a regra em palavras:
// ajuste = contado menos saldo; valor do ajuste = ajuste vezes o custo médio; o ajuste não muda o custo médio;
// a diferença só exige motivo quando o valor (sem sinal) passa do limite da loja.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ajusteEsperado, exigeMotivoEsperado } from './inventario-gabarito.ts'

test('contado maior que o saldo: entrada de 1,2 a R$ 4,00 vale R$ 4,80', () => {
  const r = ajusteEsperado({ saldo: '1.3', contado: '2.5', cmc: '4' })
  assert.deepEqual(r, { diferenca: '1.2', sentido: 'entrada', geraAjuste: true, saldoDepois: '2.5', valor: '4.8', valorCent: 480n, cmcDepois: '4' })
})

test('contado menor que o saldo: saída de 3 a R$ 2,50 vale R$ -7,50', () => {
  const r = ajusteEsperado({ saldo: '10', contado: '7', cmc: '2.5' })
  assert.deepEqual(r, { diferenca: '-3', sentido: 'saida', geraAjuste: true, saldoDepois: '7', valor: '-7.5', valorCent: -750n, cmcDepois: '2.5' })
})

test('contado igual ao saldo: nenhum ajuste, valor zero', () => {
  const r = ajusteEsperado({ saldo: '258', contado: '258', cmc: '1.574418' })
  assert.deepEqual(r, { diferenca: '0', sentido: 'nenhum', geraAjuste: false, saldoDepois: '258', valor: '0', valorCent: 0n, cmcDepois: '1.574418' })
})

test('zerar: 12 unidades a R$ 3,959964 saem e valem R$ -47,519568 (R$ -47,52 em centavos)', () => {
  const r = ajusteEsperado({ saldo: '12', contado: '0', cmc: '3.959964' })
  assert.equal(r.diferenca, '-12')
  assert.equal(r.valor, '-47.519568')
  assert.equal(r.valorCent, -4752n)
  assert.equal(r.saldoDepois, '0')
})

test('saldo negativo e contado zero: o ajuste repõe 6,5', () => {
  const r = ajusteEsperado({ saldo: '-6.5', contado: '0', cmc: '2' })
  assert.equal(r.diferenca, '6.5')
  assert.equal(r.sentido, 'entrada')
  assert.equal(r.valor, '13')
})

test('decimais não sofrem erro de ponto flutuante: 0,3 menos 0,1 dá 0,2', () => {
  assert.equal(ajusteEsperado({ saldo: '0.1', contado: '0.3', cmc: '1' }).diferenca, '0.2')
})

test('centavos arredondam meia para longe do zero: 0,005 vira 1 centavo, -0,005 vira -1', () => {
  assert.equal(ajusteEsperado({ saldo: '0', contado: '0.005', cmc: '1' }).valorCent, 1n)
  assert.equal(ajusteEsperado({ saldo: '0.005', contado: '0', cmc: '1' }).valorCent, -1n)
})

test('custo zero: o ajuste existe mas não tem valor', () => {
  const r = ajusteEsperado({ saldo: '5', contado: '2', cmc: '0' })
  assert.equal(r.geraAjuste, true)
  assert.equal(r.valor, '0')
})

test('motivo: exige acima do limite (sem sinal), não exige no limite exato', () => {
  assert.equal(exigeMotivoEsperado('50.000001', '50'), true)
  assert.equal(exigeMotivoEsperado('-81', '50'), true)
  assert.equal(exigeMotivoEsperado('50', '50'), false)
  assert.equal(exigeMotivoEsperado('-47.519568', '50'), false)
})
