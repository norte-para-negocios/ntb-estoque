import { test } from 'node:test'
import assert from 'node:assert/strict'
import { itensDaBaixaDoFechamento, localMaisUsado } from './baixa-do-fechamento-puro.ts'

const cod = new Map<number, string>([[8000000000133, '90058'], [8000000000439, '90101'], [8000000000401, '90301']])
const loc = new Map<number, number>([[8000000000133, 4], [8000000000439, 4]])

test('F-04: item com código vira o próprio produto, com o local onde ele costuma sair', () => {
  const r = itensDaBaixaDoFechamento([{ codigo: '90058', codigo_produto: 8000000000133, componentes: null, quantidade: '1.000000' }], cod, loc)
  assert.deepEqual(r, { itens: [{ codigo: '90058', quantidade: 1, localEstoque: 4 }], semCodigo: 0 })
})

test('F-04: item de cardápio sem código baixa cada componente', () => {
  const r = itensDaBaixaDoFechamento([{ codigo: null, codigo_produto: null, componentes: [8000000000439, 8000000000401], quantidade: 2 }], cod, loc)
  assert.deepEqual(r.itens, [{ codigo: '90101', quantidade: 2, localEstoque: 4 }, { codigo: '90301', quantidade: 2 }])
  assert.equal(r.semCodigo, 0)
})

test('F-04: o que não dá para traduzir é contado, nunca some calado', () => {
  const r = itensDaBaixaDoFechamento([
    { codigo: null, codigo_produto: null, componentes: null, quantidade: 1 },
    { codigo: '', codigo_produto: null, componentes: [999], quantidade: 1 },
    { codigo: '90058', codigo_produto: 8000000000133, componentes: null, quantidade: 0 },
  ], cod, loc)
  assert.deepEqual(r.itens, [])
  assert.equal(r.semCodigo, 3)
})

test('F-04: local mais usado por produto; empate fica com o mais recente (lista vem do mais novo para o mais velho)', () => {
  const m = localMaisUsado([
    { codigo_produto: 1, codigo_local_estoque: 5 }, { codigo_produto: 1, codigo_local_estoque: 4 },
    { codigo_produto: 1, codigo_local_estoque: 4 }, { codigo_produto: 2, codigo_local_estoque: 3 },
    { codigo_produto: 2, codigo_local_estoque: 7 },
  ])
  assert.equal(m.get(1), 4)
  assert.equal(m.get(2), 3)
})
