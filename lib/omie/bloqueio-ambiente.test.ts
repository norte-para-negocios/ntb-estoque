import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mensagemBloqueioOmie } from './bloqueio-ambiente.ts'

test('sem a variável, nada é bloqueado', () => {
  assert.equal(mensagemBloqueioOmie({}, 'IncluirProduto'), null)
  assert.equal(mensagemBloqueioOmie({ NTB_OMIE_BLOQUEADO: '0' }, 'IncluirProduto'), null)
})

test('NTB_OMIE_BLOQUEADO=1 bloqueia escrita com erro claro', () => {
  const msg = mensagemBloqueioOmie({ NTB_OMIE_BLOQUEADO: '1' }, 'IncluirProduto')
  assert.ok(msg)
  assert.match(msg, /NTB_OMIE_BLOQUEADO/)
  assert.match(msg, /IncluirProduto/)
})

test('NTB_OMIE_BLOQUEADO=1 bloqueia também leitura (a cópia local não tem chaves)', () => {
  const msg = mensagemBloqueioOmie({ NTB_OMIE_BLOQUEADO: '1' }, 'ListarProdutos')
  assert.ok(msg)
  assert.match(msg, /ListarProdutos/)
})

test('só o valor exato "1" liga a trava', () => {
  assert.equal(mensagemBloqueioOmie({ NTB_OMIE_BLOQUEADO: 'true' }, 'AlterarProduto'), null)
})
