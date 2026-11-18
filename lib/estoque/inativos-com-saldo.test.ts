import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resumirInativosComSaldo } from './inativos-com-saldo.ts'

const l = (codigo: string, saldo: number, valor: number, descricao = codigo) => ({ codigo, descricao, unidade: 'UN', saldo, valor })

test('F-07: conta só inativos com saldo diferente de zero e soma o valor', () => {
  const r = resumirInativosComSaldo([l('A', 5750, 100), l('B', 0, 0), l('C', 40, 25.5), l('D', -3, -6)])
  assert.equal(r.quantidade, 3)
  assert.equal(r.valor, 119.5)
  assert.equal(r.exemplos.length, 3)
})

test('F-07: exemplos vêm do maior valor absoluto e são no máximo 5', () => {
  const r = resumirInativosComSaldo(Array.from({ length: 8 }, (_, i) => l(`P${i}`, 1, i)))
  assert.equal(r.quantidade, 8)
  assert.equal(r.exemplos.length, 5)
  assert.equal(r.exemplos[0].codigo, 'P7')
})

test('F-07: sem inativo com saldo devolve null (a tela não mostra aviso)', () => {
  assert.equal(resumirInativosComSaldo([l('A', 0, 0)]), null)
  assert.equal(resumirInativosComSaldo([]), null)
})
