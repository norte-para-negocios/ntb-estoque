import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore: import com .ts exigido pelo node --test
import { cfopDevolucao, cmcAposDevolucao, devolvivel, rotuloSituacaoDevolucao, validarDevolucao, valorFiscalDevolvido } from './devolucao-puro.ts'

test('cfopDevolucao: entrada → devolução (dentro e fora do estado)', () => {
  assert.equal(cfopDevolucao('1102'), '5.202')
  assert.equal(cfopDevolucao('1.102'), '5.202')
  assert.equal(cfopDevolucao('2102'), '6.202')
  assert.equal(cfopDevolucao('1101'), '5.201')
  assert.equal(cfopDevolucao('1403'), '5.411')
  assert.equal(cfopDevolucao('2403'), '6.411')
  assert.equal(cfopDevolucao('1407'), '5.413')
  assert.equal(cfopDevolucao('1556'), '5.556')
  // bonificação/outras não têm CFOP de devolução válido na NF-e (5.910/5.949 + finalidade 4 = rejeição 327): sem sugestão
  assert.equal(cfopDevolucao('1910'), '')
  assert.equal(cfopDevolucao('2910'), '')
  assert.equal(cfopDevolucao('1949'), '')
  assert.equal(cfopDevolucao('1551'), '5.553')
  assert.equal(cfopDevolucao('2653'), '6.662')
  assert.equal(cfopDevolucao('1920'), '5.921')
  assert.equal(cfopDevolucao(null), '5.202')
})

test('devolvivel = recebido − já devolvido, nunca negativo', () => {
  assert.equal(devolvivel(10, 0), 10)
  assert.equal(devolvivel(10, 3.5), 6.5)
  assert.equal(devolvivel(10, 12), 0)
  assert.equal(devolvivel(0.3, 0.1), 0.2)
})

test('validarDevolucao', () => {
  const disp = new Map([[1, 10], [2, 4]])
  assert.equal(validarDevolucao([{ compraItemId: 1, quantidade: 5 }], disp, 'produto vencido'), null)
  assert.match(validarDevolucao([{ compraItemId: 1, quantidade: 5 }], disp, '  ')!, /motivo/i)
  assert.match(validarDevolucao([], disp, 'vencido')!, /item/i)
  assert.match(validarDevolucao([{ compraItemId: 2, quantidade: 4.5 }], disp, 'vencido')!, /maior do que ainda dá/i)
  assert.match(validarDevolucao([{ compraItemId: 3, quantidade: 1 }], disp, 'vencido')!, /não é desta nota/i)
  assert.match(validarDevolucao([{ compraItemId: 1, quantidade: 0 }], disp, 'vencido')!, /maior que zero/i)
  assert.match(validarDevolucao([{ compraItemId: 1, quantidade: 2 }, { compraItemId: 1, quantidade: 1 }], disp, 'vencido')!, /repetido/i)
})

// HIPÓTESE (sem kardex de devolução do Omie capturado): a devolução sai ao custo da entrada original e o custo médio
// é refeito sem essas unidades.
test('cmcAposDevolucao: 10 UN a R$ 10 + 10 UN a R$ 20 (CMC 15), devolve 5 da 2ª → 13,333333', () => {
  assert.equal(cmcAposDevolucao(20, 15, 5, 20), 13.333333)
  assert.equal(cmcAposDevolucao(5, 15, 5, 20), 15)      // zera: custo médio fica
  assert.equal(cmcAposDevolucao(3, 15, 5, 20), 15)      // fica negativo: custo médio fica
  assert.equal(cmcAposDevolucao(20, 1, 5, 20), 1)       // resultado ≤ 0: custo médio fica
})

test('valorFiscalDevolvido é proporcional ao valor do item na nota', () => {
  assert.equal(valorFiscalDevolvido(110, 10, 5), 55)
  assert.equal(valorFiscalDevolvido(100, 3, 1), 33.33)
  assert.equal(valorFiscalDevolvido(100, 0, 1), 0)
})

test('rotuloSituacaoDevolucao', () => {
  assert.equal(rotuloSituacaoDevolucao('a_emitir'), 'Devolução a emitir')
  assert.equal(rotuloSituacaoDevolucao('cancelada'), 'Cancelada')
  assert.equal(rotuloSituacaoDevolucao('emitida'), 'NF-e emitida')
})
