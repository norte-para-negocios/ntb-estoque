import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nomeDoCadastro } from './nome-do-cadastro-puro.ts'

const cad = new Map<number, string | null>([[8000000000280, 'ALHO TRITURADO (MP)'], [7, null], [8, '  ']])

test('F-18: mostra o nome como está no cadastro, não a cópia do pedido', () => {
  assert.equal(nomeDoCadastro(cad, 8000000000280, 'Alho Triturado (MP)'), 'ALHO TRITURADO (MP)')
})

test('F-18: sem cadastro (ou nome vazio) usa a cópia guardada; sem nada, vazio', () => {
  assert.equal(nomeDoCadastro(cad, 99, 'Alho Triturado (MP)'), 'Alho Triturado (MP)')
  assert.equal(nomeDoCadastro(cad, 7, 'Copia'), 'Copia')
  assert.equal(nomeDoCadastro(cad, 8, 'Copia'), 'Copia')
  assert.equal(nomeDoCadastro(cad, null, null), '')
})
