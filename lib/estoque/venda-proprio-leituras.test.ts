import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exigirLeitura, todosPulados } from './venda-proprio-leituras.ts'

test('exigirLeitura: erro da consulta vira exceção com o que se tentou ler', () => {
  assert.throws(() => exigirLeitura({ data: null, error: { message: 'timeout' } }, 'fichas'), /Falha ao ler fichas: timeout/)
})

test('exigirLeitura: erro ganha mesmo quando veio data junto', () => {
  assert.throws(() => exigirLeitura({ data: [], error: { message: 'canceling statement' } }, 'produtos'), /Falha ao ler produtos: canceling statement/)
})

test('exigirLeitura: lista vazia sem erro é resposta válida', () => {
  assert.deepEqual(exigirLeitura({ data: [], error: null }, 'fichas'), [])
})

test('exigirLeitura: data nula sem erro vira lista vazia (PostgREST sem linhas)', () => {
  assert.deepEqual(exigirLeitura<{ a: number }[]>({ data: null, error: null }, 'locais'), [])
})

test('exigirLeitura: devolve as linhas', () => {
  const linhas = [{ codigo: 'A' }]
  assert.equal(exigirLeitura({ data: linhas, error: null }, 'produtos'), linhas)
})

test('todosPulados: todos os itens voltam retentáveis, na ordem, com o erro', () => {
  const r = todosPulados([{ codigo: 'X1' }, {}, { codigo: 'X2' }], 'Falha ao ler fichas: timeout')
  assert.deepEqual(r, [
    { codigo: 'X1', ok: false, op: 'pulada', baixa: 'pulada', erro: 'Falha ao ler fichas: timeout' },
    { codigo: '?', ok: false, op: 'pulada', baixa: 'pulada', erro: 'Falha ao ler fichas: timeout' },
    { codigo: 'X2', ok: false, op: 'pulada', baixa: 'pulada', erro: 'Falha ao ler fichas: timeout' },
  ])
})
