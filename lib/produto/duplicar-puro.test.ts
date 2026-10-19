import { test } from 'node:test'
import assert from 'node:assert/strict'
import { duplicarProduto, quantidadeParaDuplicar } from './duplicar-puro.ts'

const base = {
  id: 9, codigo: '04001', codigoProduto: 123, descricao: 'Moqueca', ean: '7891234567895', vinculado: true, inativo: true,
  tipoItem: '04', extras: { cest: '1700100' },
  variacoes: [{ id: 1, codigo: '04002', codigoProduto: 124, descricao: 'Moqueca - P', valorUnitario: 50, inativo: false, atributos: { Tamanho: 'P' } }],
}

test('duplicarProduto: descrição com "(cópia)", sem EAN, sem códigos, ativo e sem vínculo com o Vendas', () => {
  const d = duplicarProduto(base)
  assert.equal(d.descricao, 'Moqueca (cópia)')
  assert.equal(d.ean, null)
  assert.equal(d.codigo, '')
  assert.equal(d.codigoProduto, 0)
  assert.equal(d.id, 0)
  assert.equal(d.vinculado, false)
  assert.equal(d.inativo, false)
  assert.equal(d.variacoes[0].codigo, '')
  assert.equal(d.variacoes[0].codigoProduto, 0)
  assert.deepEqual(d.extras, { cest: '1700100' })
  assert.equal(d.tipoItem, '04')
  assert.equal(base.codigo, '04001') // não altera o original
})

test('duplicarProduto: descrição longa cortada para caber nos 120 caracteres', () => {
  assert.equal(duplicarProduto({ ...base, descricao: 'x'.repeat(120) }).descricao.length, 120)
})

test('quantidadeParaDuplicar: número positivo vira texto com vírgula; inválido vira 1', () => {
  assert.equal(quantidadeParaDuplicar(2.5), '2,5')
  assert.equal(quantidadeParaDuplicar(10), '10')
  assert.equal(quantidadeParaDuplicar(null), '1')
  assert.equal(quantidadeParaDuplicar(0), '1')
})
