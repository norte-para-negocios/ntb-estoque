import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fmtCnpj, totalDoItem, entraNoEstoque, categoriaDoItemOmie, resumosDaNota, totaisDaNota } from './tela-nota.ts'

test('CNPJ e CPF formatados; outro formato volta igual', () => {
  assert.equal(fmtCnpj('34640245000103'), '34.640.245/0001-03')
  assert.equal(fmtCnpj('93.209.765/0533-18'), '93.209.765/0533-18')
  assert.equal(fmtCnpj('12345678901'), '123.456.789-01')
  assert.equal(fmtCnpj('abc'), 'abc')
  assert.equal(fmtCnpj(null), '')
})

test('total do item: coluna, depois full_object do Omie, depois quantidade × preço', () => {
  assert.equal(totalDoItem({ v_total_item: 5 }), 5)
  assert.equal(totalDoItem({ v_total_item: null, full_object: { itensCabec: { vTotalItem: 11.07 } } }), 11.07)
  assert.equal(totalDoItem({ v_total_item: null, n_qtde_nfe: '3', n_preco_unit: '3.69' }), 11.07)
  assert.equal(totalDoItem({}), null)
})

test('entra no estoque só quando a unidade ou a quantidade do cadastro é diferente da nota', () => {
  assert.deepEqual(entraNoEstoque({ n_qtde_nfe: 3, c_unidade_nfe: 'UND9', full_object: { itensAjustes: { cUnidade: 'UN', nQtdeRecebida: 3 } } }), { quantidade: 3, unidade: 'UN' })
  assert.equal(entraNoEstoque({ n_qtde_nfe: 10, c_unidade_nfe: 'KG', full_object: { itensAjustes: { cUnidade: 'kg', nQtdeRecebida: 10 } } }), null)
  assert.deepEqual(entraNoEstoque({ n_qtde_nfe: 2, c_unidade_nfe: 'CX', full_object: { itensAjustes: { cUnidade: 'CX', nQtdeRecebida: 24 } } }), { quantidade: 24, unidade: 'CX' })
  assert.equal(entraNoEstoque({ n_qtde_nfe: 2, c_unidade_nfe: 'CX', full_object: {} }), null)
})

test('categoria do item no Omie', () => {
  assert.equal(categoriaDoItemOmie({ itensInfoAdic: { cCategoriaItem: '2.01.01' } }), '2.01.01')
  assert.equal(categoriaDoItemOmie(null), null)
})

test('resumos: nota sem transporte e com uma parcela', () => {
  const r = resumosDaNota(
    {
      cabec: { cCNPJ_CPF: '34640245000103', cInscricao: '160761471' },
      transporte: { cTipoFrete: '9' },
      totais: { vTotalProdutos: 726.79, vTotalNFe: 726.79 },
      parcelas: { parcelasLista: [{ nSequencia: 1, dVencimento: '10/11/2026', vParcela: 726.79 }] },
      infoCadastro: { cRecebido: 'N', cFaturado: 'S', dFat: '27/10/2026', cCancelada: 'N' },
    },
    'Couto Amaral',
    false
  )
  assert.equal(r.fornecedor, 'Couto Amaral · CNPJ 34.640.245/0001-03 · IE 160761471')
  assert.equal(r.transporte, null)
  assert.equal(r.parcelas, '1 parcela · vence 10/11/2026')
  assert.match(r.impostos, /^Mercadorias R\$\s726,79 · sem desconto, IPI, ST ou frete$/)
  assert.equal(r.situacao, 'Ainda não recebida · faturada em 27/10/2026')
})

test('resumos: transporte com transportadora, volumes e frete; loja própria não fala de faturada', () => {
  const r = resumosDaNota(
    { transporte: { cTipoFrete: '1', cNomeTransp: 'Rapidão', nQtdeVolume: 2 }, totais: { vTotalProdutos: 100, vFrete: 15, vTotalIPI: 3 }, infoCadastro: { cRecebido: 'S', dRec: '01/10/2026', cFaturado: 'S' } },
    null,
    true
  )
  assert.match(r.transporte ?? '', /^Por conta da loja \(FOB\) · Rapidão · 2 volumes · frete R\$\s15,00$/)
  assert.match(r.impostos, /IPI R\$\s3,00 · frete R\$\s15,00/)
  assert.equal(r.situacao, 'Recebida em 01/10/2026')
  assert.equal(r.fornecedor, 'Sem dados do fornecedor')
})

test('totais do painel', () => {
  assert.deepEqual(totaisDaNota({ totais: { vTotalProdutos: 100, vTotalNFe: 103 } }, null, 0), { mercadorias: 100, outros: 3, total: 103 })
  assert.deepEqual(totaisDaNota(null, 50, 48), { mercadorias: 48, outros: 2, total: 50 })
})

test('categoria automática só com fornecedor constante (2+ notas, 80% na mesma)', async () => {
  const { categoriaAutomatica } = await import('./tela-nota.ts')
  assert.equal(categoriaAutomatica(new Map([[7, 9], [3, 1]]), 3), 7)
  assert.equal(categoriaAutomatica(new Map([[7, 7], [3, 3]]), 3), null)
  assert.equal(categoriaAutomatica(new Map([[7, 10]]), 1), null)
  assert.equal(categoriaAutomatica(new Map(), 4), null)
})
