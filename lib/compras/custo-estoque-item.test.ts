import { test } from 'node:test'
import assert from 'node:assert/strict'
import { custoEstoqueItemOmie, custoUnitarioEntrada, entradaCustoDoItem, itemMovimentaEstoque, lerTipoValor } from './custo-estoque-item.ts'
import type { EntradaCustoItem, FlagsCustoOmie } from './custo-estoque-item.ts'

// Casos reais da loja 5 (itens de recebimento do Omie × kardex do Omie, notas concluídas desde 01/08/2026).
const N: FlagsCustoOmie = { cICMSCusto: 'N', cICMSSTCusto: 'N', cIPICusto: 'N', cPISCusto: 'N', cCOFINSCusto: 'N', cOutrosDespCusto: 'N', cFreteCusto: 'N', cSeguroCusto: 'N', nAliqCredPISCusto: 0, nAliqCredCOFINSCusto: 0 }
const e = (o: Partial<EntradaCustoItem>): EntradaCustoItem => ({ qtde: 1, precoUnit: 0, vTotalItem: null, vDesconto: 0, vIPI: 0, vST: 0, vICMS: 0, flags: N, ...o })

test('ICMS fora do custo: ESPONJA 60034, NF 184507 (kardex 1 × 5,17)', () => {
  const r = custoEstoqueItemOmie(e({ qtde: 1, precoUnit: 6.5, vTotalItem: 6.5, vICMS: 1.33 }))
  assert.equal(r.valorEstoque, 5.17); assert.equal(r.valorFiscal, 6.5); assert.equal(r.fonte, 'omie')
})

test('ICMS N, IPI e ST S: ALHO 80009, NF 952367 (kardex 26,23)', () => {
  assert.equal(custoEstoqueItemOmie(e({ precoUnit: 33, vTotalItem: 33, vICMS: 6.77, flags: { ...N, cIPICusto: 'S', cICMSSTCusto: 'S' } })).valorEstoque, 26.23)
})

test('desconto já está no vTotalItem: PESCADA 80104, NF 4063 (kardex 77 × 41,531558)', () => {
  const r = custoEstoqueItemOmie(e({ qtde: 77, precoUnit: 41.7, vTotalItem: 3197.93, vDesconto: 12.97, flags: { ...N, cIPICusto: 'S', cICMSSTCusto: 'S' } }))
  assert.equal(r.valorEstoque, 3197.93); assert.notEqual(r.valorEstoque, 3184.96); assert.equal(r.despesas, 0)
  assert.ok(Math.abs(r.valorFiscal - 3210.9) < 1e-9)
})

test('outras despesas saem do item quando N: ÁGUA C/ GÁS 90001, NF 131055 (kardex 144 × 1,214167)', () => {
  const r = custoEstoqueItemOmie(e({ qtde: 12, precoUnit: 14.570054, vTotalItem: 189.23 }))
  assert.equal(r.despesas, 14.39); assert.equal(r.valorEstoque, 174.84)
})

test('IPI N e despesas N: H2O 90015, NF 131055 (kardex 24 × 4,164167)', () => {
  const r = custoEstoqueItemOmie(e({ qtde: 2, precoUnit: 49.971587, vTotalItem: 109.88, vIPI: 1.58 }))
  assert.equal(r.despesas, 8.36); assert.equal(r.valorEstoque, 99.94)
})

test('tudo no custo: PAPEL FILME 60087, NF 189213 = valor fiscal 119,80', () => {
  const S = Object.fromEntries(Object.entries(N).map(([k, v]) => [k, typeof v === 'string' ? 'S' : v])) as FlagsCustoOmie
  assert.equal(custoEstoqueItemOmie(e({ qtde: 2, precoUnit: 59.9, vTotalItem: 119.8, vICMS: 24.56, flags: S })).valorEstoque, 119.8)
})

test('ST dentro do vTotalItem: RECORTE 69062, NF 360369 (sem kardex) — ST N tira 11,79', () => {
  const base = { qtde: 20, precoUnit: 11.5, vTotalItem: 241.79, vST: 11.79 }
  assert.equal(custoEstoqueItemOmie(e({ ...base, flags: { ...N, cICMSSTCusto: 'S' } })).valorEstoque, 241.79)
  assert.equal(custoEstoqueItemOmie(e(base)).valorEstoque, 230)
})

test('PIS/COFINS pela alíquota de crédito (HIPÓTESE N3: nenhum caso real em D1)', () => {
  assert.equal(custoEstoqueItemOmie(e({ qtde: 1, precoUnit: 100, vTotalItem: 100, flags: { ...N, nAliqCredPISCusto: 1.65, nAliqCredCOFINSCusto: 7.6 } })).valorEstoque, 90.75)
})

test('sem itensCustoEstoque usa o valor fiscal', () => {
  const r = custoEstoqueItemOmie(entradaCustoDoItem({ itensCabec: {} }, 4, 54.9))
  assert.equal(r.fonte, 'fiscal'); assert.equal(r.valorEstoque, 219.6)
  assert.equal(custoEstoqueItemOmie(entradaCustoDoItem(null, '2', '3')).valorEstoque, 6)
})

test('entradaCustoDoItem lê o JSON do Omie (NF 131055 item 5)', () => {
  const fo = { itensCabec: { vTotalItem: 109.88, vDesconto: 0 }, itensIPI: { nValIPI: 1.58 }, itensICMSST: { nValorST: 0 }, itensICMS: {}, itensCustoEstoque: N }
  const x = entradaCustoDoItem(fo, 2, 49.971587)
  assert.equal(x.vIPI, 1.58); assert.equal(x.vTotalItem, 109.88); assert.equal(custoEstoqueItemOmie(x).valorEstoque, 99.94)
})

test('itemMovimentaEstoque', () => {
  assert.equal(itemMovimentaEstoque({ itensAjustes: { cNaoGerarMovEstoque: 'S' } }), false)
  assert.equal(itemMovimentaEstoque({ itensCabec: { cIgnorarItem: 'S' } }), false)
  assert.equal(itemMovimentaEstoque({ itensAjustes: { cNaoGerarFinanceiro: 'S', cNaoGerarMovEstoque: 'N' } }), true)
  assert.equal(itemMovimentaEstoque(null), true)
})

test('lerTipoValor', () => {
  assert.equal(lerTipoValor(undefined), 'estoque'); assert.equal(lerTipoValor('xyz'), 'estoque')
  assert.equal(lerTipoValor('fiscal'), 'fiscal'); assert.equal(lerTipoValor(['fiscal']), 'fiscal')
})

// Fase B (R3): frete/seguro/CT-e separados só no bloco `sefaz` da nota própria; custo unitário pela quantidade recebida.
const N8 = { ...N } // N da Fase A: tudo 'N', alíquotas 0
test('Omie: sem bloco sefaz, Frete/Seguro não mudam nada (ÁGUA 131055, kardex 120 × 1,358333)', () => {
  const base = { itensCabec: { vTotalItem: 176.41, vDesconto: 0 }, itensCustoEstoque: N8 }
  assert.equal(custoEstoqueItemOmie(entradaCustoDoItem(base, 10, 16.299516)).valorEstoque, 163)
  assert.equal(custoEstoqueItemOmie(entradaCustoDoItem({ ...base, itensCustoEstoque: { ...N8, cFreteCusto: 'S', cSeguroCusto: 'S' } }, 10, 16.299516)).valorEstoque, 163)
})
test('próprio: frete e seguro do item seguem as suas marcações; outras despesas = o resto (HIPÓTESE N3b)', () => {
  const fo = { itensCabec: { vTotalItem: 115, vDesconto: 0 }, itensCustoEstoque: { ...N8, cFreteCusto: 'S' }, sefaz: { vFrete: 10, vSeg: 2 } }
  assert.equal(custoEstoqueItemOmie(entradaCustoDoItem(fo, 1, 100)).valorEstoque, 110) // tira seguro 2 e outras 3
})
test('CT-e entra só com Frete = S (HIPÓTESE N8)', () => {
  const fo = (f: string) => ({ itensCabec: { vTotalItem: 100, vDesconto: 0 }, itensCustoEstoque: { ...N8, cFreteCusto: f }, sefaz: { vFrete: 0, vSeg: 0, freteCte: 12.5 } })
  assert.equal(custoEstoqueItemOmie(entradaCustoDoItem(fo('S'), 1, 100)).valorEstoque, 112.5)
  assert.equal(custoEstoqueItemOmie(entradaCustoDoItem(fo('N'), 1, 100)).valorEstoque, 100)
})
test('custo unitário = valor de estoque ÷ quantidade recebida (NF 131055 e entrega parcial da NF 4010)', () => {
  assert.equal(custoUnitarioEntrada(163, 120), 1.358333)
  assert.equal(custoUnitarioEntrada(632.6, 96), 6.589583)
  assert.equal(custoUnitarioEntrada(39.87, 12), 3.3225)
  assert.equal(custoUnitarioEntrada(3063.41, 37.888369), 80.853573)
  assert.equal(custoUnitarioEntrada(10, 0), null)
})
