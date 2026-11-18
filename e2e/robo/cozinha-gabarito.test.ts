// Testes à mão do gabarito da Norte Cozinha (ticket 11). Os valores esperados saem de contas feitas no papel, não do ERP.
import test from 'node:test'
import assert from 'node:assert/strict'
import { custoDoPrato, cmvDoPrato, precoSugeridoSalao, situacaoDoPrato, medianaCmv, custoSuspeitoGab, custoPorPessoaEvento, cabeNoCentavo, cabeNaEscala, valorEmEstoqueGab, precoSugeridoDelivery, sobraSalao } from './cozinha-gabarito.ts'

// Prato P (rende 1): 0,2 de A a R$ 10 = 2,00; 0,1 de B com fator 1,25 e perda 10% = 0,1375 a R$ 8 = 1,10;
// 0,5 da preparação S (rende 2; 1 de C a R$ 3) = 0,25 x 3 = 0,75. Total no papel: 3,85.
const fichas = {
  P: { rendimento: '1', itens: [
    { insumo: 'A', liquida: '0.2', fator: '1', perda: '0' },
    { insumo: 'B', liquida: '0.1', fator: '1.25', perda: '10' },
    { insumo: 'S', liquida: '0.5', fator: '1', perda: '0' },
  ] },
  S: { rendimento: '2', itens: [{ insumo: 'C', liquida: '1', fator: '1', perda: '0' }] },
}
const cmc = { A: '10', B: '8', C: '3' }

test('custo do prato = soma dos insumos pela ficha, descendo pela preparação', () => {
  const r = custoDoPrato('P', fichas, cmc)
  assert.equal(r.custo, '3.85')
  assert.equal(r.semCusto, 0)
  assert.equal(r.ciclo, false)
})

test('insumo sem custo médio: conta zero e avisa', () => {
  const r = custoDoPrato('P', fichas, { A: '10', C: '3' })
  assert.equal(r.custo, '2.75') // 2,00 + 0,75
  assert.equal(r.semCusto, 1)
})

test('rendimento 4 divide a quantidade da ficha', () => {
  const r = custoDoPrato('X', { X: { rendimento: '4', itens: [{ insumo: 'A', liquida: '2', fator: '1', perda: '0' }] } }, { A: '10' })
  assert.equal(r.custo, '5') // 2 / 4 = 0,5 x 10
})

test('ficha que usa a si mesma é ciclo e não trava', () => {
  const r = custoDoPrato('Q', { Q: { rendimento: '1', itens: [{ insumo: 'Q', liquida: '1', fator: '1', perda: '0' }] } }, {})
  assert.equal(r.ciclo, true)
})

test('CMV = custo / preço; sem preço de verdade (< 0,10) não tem CMV', () => {
  assert.equal(cmvDoPrato('3.85', '12.9')?.slice(0, 8), '0.298449')
  assert.equal(cmvDoPrato('3.85', '0.01'), null)
  assert.equal(cmvDoPrato('3.85', null), null)
})

test('preço p/ meta: custo / meta, sempre para cima, terminando em ,90', () => {
  assert.equal(precoSugeridoSalao('3.85', '0.30'), '12.9') // 12,8333 -> 12,90
  assert.equal(precoSugeridoSalao('4', '0.30'), '13.9') // 13,3333 -> 13,90
  assert.equal(precoSugeridoSalao('3.885', '0.30'), '13.9') // 12,95 passa do 12,90: sobe para 13,90
})

test('situação do prato contra a meta de 30%', () => {
  const s = (custo: string, preco: string | null, sem = 0, susp = 0) => situacaoDoPrato(custo, preco, sem, susp, '0.30')
  assert.equal(s('3', '10'), 'ok') // 30% exato
  assert.equal(s('3.4', '10'), 'atencao') // 34%
  assert.equal(s('3.5', '10'), 'atencao') // 35% exato ainda atenção
  assert.equal(s('3.6', '10'), 'acima')
  assert.equal(s('3', null), 'sem_preco')
  assert.equal(s('3', '10', 0, 1), 'suspeito')
  assert.equal(s('0', '10', 1), 'sem_custo')
  assert.equal(s('3', '10', 1), 'incompleto')
})

test('mediana do CMV: ímpar pega o do meio, par tira a média dos dois do meio', () => {
  assert.equal(medianaCmv(['0.5', '0.2', '0.3']), '0.3')
  assert.equal(medianaCmv(['0.2', '0.4']), '0.3')
  assert.equal(medianaCmv([]), null)
})

test('custo de insumo fora do normal para a unidade', () => {
  assert.equal(custoSuspeitoGab('2.5', 'ML'), true)
  assert.equal(custoSuspeitoGab('1.9', 'G'), false)
  assert.equal(custoSuspeitoGab('2001', 'KG'), true)
  assert.equal(custoSuspeitoGab('2000', 'L'), false)
  assert.equal(custoSuspeitoGab('5001', 'UN'), true)
  assert.equal(custoSuspeitoGab(null, 'UN'), false)
})

test('custo por pessoa do evento: soma porções por convidado x custo do prato, com folga', () => {
  // 1 porção de um prato de R$ 4,00 e meia de um de R$ 1,00 = 4,50 por pessoa; folga de 10% = 4,95
  assert.equal(custoPorPessoaEvento([{ porcoes: '1', custo: '4' }, { porcoes: '0.5', custo: '1' }], '0'), '4.5')
  assert.equal(custoPorPessoaEvento([{ porcoes: '1', custo: '4' }, { porcoes: '0.5', custo: '1' }], '10'), '4.95')
})

test('valor em estoque: só saldo positivo e custo confiável', () => {
  // 2 x 5 = 10; saldo negativo e custo suspeito/sem custo não contam
  assert.equal(valorEmEstoqueGab([{ saldo: '2', custo: '5' }, { saldo: '-3', custo: '5' }, { saldo: '4', custo: null }, { saldo: '1.5', custo: '2' }]), '13')
})

test('valor na tela em centavos confere se é o centavo mais próximo do exato', () => {
  assert.equal(cabeNoCentavo('3.85', 385n), true)
  assert.equal(cabeNoCentavo('3.854', 385n), true)
  assert.equal(cabeNoCentavo('3.856', 385n), false)
  assert.equal(cabeNoCentavo('3.856', 386n), true)
  assert.equal(cabeNoCentavo('3.855', 385n), true) // metade: aceita os dois lados
  assert.equal(cabeNoCentavo('3.855', 386n), true)
})

test('folhas e insumos suspeitos do prato (a preparação não conta, o que tem dentro dela conta)', () => {
  const r = custoDoPrato('P', fichas, { A: '10', B: '8', C: '3000' }, { A: 'KG', B: 'KG', C: 'KG' })
  assert.deepEqual(r.folhas.sort(), ['A', 'B', 'C'])
  assert.equal(r.suspeitos, 1) // C custa 3000 por kg, acima do teto de 2000
})

test('preço p/ delivery: (custo + embalagem) / (meta x (1 - app - cartão - imposto)), ,90 para cima', () => {
  const t = { meta: '0.30', imposto: '0.06', cartao: '0.03', app: '0.23', embalagem: '2' }
  // (25,25 + 2) / (0,3 x 0,68) = 133,5784... -> 133,90
  assert.equal(precoSugeridoDelivery('25.25', t), '133.9')
})

test('sobra por venda no salão: preço x (1 - imposto - cartão) - custo', () => {
  const t = { imposto: '0.06', cartao: '0.03' }
  assert.equal(sobraSalao('29.9', '25.25', t), '1.959') // 29,90 x 0,91 = 27,209 - 25,25
})

test('percentual na tela com 1 casa: 29,8% confere com 0,29845', () => {
  assert.equal(cabeNaEscala('0.29845', 298n, 1000n), true)
  assert.equal(cabeNaEscala('0.29845', 300n, 1000n), false)
})
