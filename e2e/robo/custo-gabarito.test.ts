// Testes do gabarito do custo médio (ticket 04). Todos os valores esperados foram calculados à mão, com a regra de negócio
// escrita em palavras (não copiada do ERP): custo da entrada = valor líquido do item + parte do (frete - desconto da nota)
// proporcional ao valor líquido, dividido pela quantidade em unidade de estoque; custo médio = média ponderada pelo saldo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { custoUnitarioBase, novoEstado, titulosEsperados, encadear, quantidadeBase, valorEmEstoqueCent, arredondarTexto } from './custo-gabarito.ts'

test('um item sem frete: custo é o valor unitário', () => {
  const c = custoUnitarioBase({ quantidade: '10', valorUnitario: '2.50', fator: '1' }, [{ quantidade: '10', valorUnitario: '2.50', fator: '1' }], { frete: '0', descontoNota: '0' })
  assert.equal(c, '2.5')
})

test('dois itens: frete 12 e desconto 2 rateados pelo valor (86,40 e 34,80)', () => {
  const itens = [{ quantidade: '48', valorUnitario: '1.80', fator: '1' }, { quantidade: '12', valorUnitario: '2.90', fator: '1' }]
  const nota = { frete: '12', descontoNota: '2' }
  // A: 86,40 + 10 x 86,40/121,20 = 93,528712871 / 48 = 1,948515 ; B: 34,80 + 10 x 34,80/121,20 = 37,671287129 / 12 = 3,139274
  assert.equal(custoUnitarioBase(itens[0], itens, nota), '1.948515')
  assert.equal(custoUnitarioBase(itens[1], itens, nota), '3.139274')
})

test('conversão de unidade: 3 KG a 42,00 o KG entram como 3000 G a 0,042', () => {
  const it = { quantidade: '3', valorUnitario: '42', fator: '1000' }
  assert.equal(custoUnitarioBase(it, [it], { frete: '0', descontoNota: '0' }), '0.042')
})

test('desconto do próprio item reduz o valor líquido: 2 L a 9,50 com desconto 1,00, fator 1000', () => {
  const it = { quantidade: '2', valorUnitario: '9.50', fator: '1000', desconto: '1' }
  // (19,00 - 1,00) / 2000 = 0,009
  assert.equal(custoUnitarioBase(it, [it], { frete: '0', descontoNota: '0' }), '0.009')
})

test('custo médio ponderado: 258 a 1,574418 + 48 a 1,948515 = 1,633100 e saldo 306', () => {
  const e = novoEstado({ saldo: '258', cmc: '1.574418' }, '48', '1.948515')
  assert.deepEqual(e, { saldo: '306', cmc: '1.6331' })
})

test('sem custo conhecido (cmc 0) ou saldo zero: a entrada vira o custo médio', () => {
  assert.deepEqual(novoEstado({ saldo: '0', cmc: '0' }, '3000', '0.042'), { saldo: '3000', cmc: '0.042' })
  assert.deepEqual(novoEstado({ saldo: '50', cmc: '0' }, '10', '4'), { saldo: '60', cmc: '4' })
})

test('saldo negativo: pondera mesmo assim (-100 a 2 + 300 a 5 = 6,5); resultado <= 0 ou saldo final zero vira o custo da entrada', () => {
  assert.deepEqual(novoEstado({ saldo: '-100', cmc: '2' }, '300', '5'), { saldo: '200', cmc: '6.5' })
  assert.deepEqual(novoEstado({ saldo: '-50', cmc: '10' }, '100', '1'), { saldo: '50', cmc: '1' }) // (-500+100)/50 = -8 -> custo da entrada
  assert.deepEqual(novoEstado({ saldo: '-100', cmc: '2' }, '100', '3'), { saldo: '0', cmc: '3' })
})

test('entrada sem custo (zero) soma saldo e não mexe no custo médio', () => {
  assert.deepEqual(novoEstado({ saldo: '10', cmc: '2' }, '5', '0'), { saldo: '15', cmc: '2' })
})

test('encadear: abertura 0 + 3000 a 0,042 + 1000 a 0,060 = cmc 0,0465 e saldo 4000', () => {
  const r = encadear({ saldo: '0', cmc: '0' }, [{ quantidade: '3000', custo: '0.042' }, { quantidade: '1000', custo: '0.06' }])
  assert.deepEqual(r, { saldo: '4000', cmc: '0.0465' })
})

test('título a pagar: chave desligada não gera nada', () => {
  assert.deepEqual(titulosEsperados({ ligado: false, entradaLancada: true, total: '100', emissao: '2026-11-18', duplicatas: [] }), [])
})

test('título a pagar: sem duplicata é um título no total, vencendo na emissão', () => {
  assert.deepEqual(titulosEsperados({ ligado: true, entradaLancada: true, total: '121.20', emissao: '2026-11-18', duplicatas: [] }),
    [{ parcela: 1, totalParcelas: 1, vencimento: '2026-11-18', valor: '121.2' }])
})

test('título a pagar: uma por duplicata, ignora duplicata sem valor, sem vencimento vence na emissão', () => {
  const r = titulosEsperados({ ligado: true, entradaLancada: true, total: '200', emissao: '2026-11-18',
    duplicatas: [{ vencimento: '2026-12-18', valor: '100' }, { vencimento: null, valor: '0' }, { vencimento: null, valor: '100.005' }] })
  assert.deepEqual(r, [
    { parcela: 1, totalParcelas: 2, vencimento: '2026-12-18', valor: '100' },
    { parcela: 2, totalParcelas: 2, vencimento: '2026-11-18', valor: '100.01' },
  ])
})

test('título a pagar: entrada não lançada não gera', () => {
  assert.deepEqual(titulosEsperados({ ligado: true, entradaLancada: false, total: '10', emissao: '2026-11-18', duplicatas: [] }), [])
})

test('quantidade em unidade de estoque: 3 KG x 1000 = 3000; 2,5 x 1 = 2,5', () => {
  assert.equal(quantidadeBase({ quantidade: '3', valorUnitario: '1', fator: '1000' }), '3000')
  assert.equal(quantidadeBase({ quantidade: '2.5', valorUnitario: '1', fator: '1' }), '2.5')
})

test('valor em estoque em centavos: 306 x 1,6331 = 499,7286 -> 49973; 3000 x 0,042 = 126,00', () => {
  assert.equal(valorEmEstoqueCent('306', '1.6331'), 49973n)
  assert.equal(valorEmEstoqueCent('3000', '0.042'), 12600n)
})

test('arredondar para as casas que a tela mostra: 0,048106 em 4 casas = 0,0481; 1,6331 em 2 = 1,63; 0,045 em 2 = 0,05', () => {
  assert.equal(arredondarTexto('0.048106', 4), '0.0481')
  assert.equal(arredondarTexto('1.6331', 2), '1.63')
  assert.equal(arredondarTexto('0.045', 2), '0.05')
})
