import { test } from 'node:test'
import assert from 'node:assert/strict'
import { itensDaBaixaDoFechamento, localMaisUsado, emLotes, LOTE_MAX_REFS, JANELA_DIAS, inicioDaJanela } from './baixa-do-fechamento-puro.ts'

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

test('F-04: emLotes fatia em pedaços de no máximo 50, sem perder nem repetir ninguém', () => {
  const refs = Array.from({ length: 300 }, (_, i) => `r${i}`)
  const lotes = emLotes(refs)
  assert.equal(LOTE_MAX_REFS, 50)
  assert.equal(lotes.length, 6)
  assert.ok(lotes.every((l) => l.length <= 50))
  assert.deepEqual(lotes.flat(), refs)
  assert.deepEqual(emLotes(['a', 'b', 'c'], 2), [['a', 'b'], ['c']])
  assert.deepEqual(emLotes([]), [])
  assert.deepEqual(emLotes(Array.from({ length: 51 }, (_, i) => i)).map((l) => l.length), [50, 1])
})

test('F-04: a janela é de 30 dias (vendas de 06/11 e 07/11 entram em 18/11; de 30+ dias atrás não)', () => {
  assert.equal(JANELA_DIAS, 30)
  const agora = new Date('2026-11-18T12:00:00Z')
  const ini = inicioDaJanela(agora)
  assert.equal(ini.toISOString(), '2026-10-19T12:00:00.000Z')
  assert.ok(new Date('2026-11-06T15:00:00Z') >= ini)
  assert.ok(new Date('2026-10-01T15:00:00Z') < ini)
})
