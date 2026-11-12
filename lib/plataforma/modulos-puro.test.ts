import test from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error: o node --test (type stripping) exige a extensão .ts; o tsc do Next não a aceita
import { acessosDaLoja, moduloDaRota } from './modulos-puro.ts'

test('padrões reproduzem o comportamento atual', () => {
  const dev = { superAdmin: true, admin: true }, admin = { superAdmin: false, admin: true }, comum = { superAdmin: false, admin: false }
  assert.equal(acessosDaLoja({}, 3, comum).erp, 'abre')
  assert.equal(acessosDaLoja({}, 3, comum).cozinha, 'vitrine')
  assert.equal(acessosDaLoja({}, 3, dev).cozinha, 'abre')
  assert.equal(acessosDaLoja({}, 3, comum).pacioli, 'vitrine')
  assert.equal(acessosDaLoja({}, 5, comum).pacioli, 'abre')
  assert.equal(acessosDaLoja({}, 3, admin).pacioli, 'abre')
  assert.equal(acessosDaLoja({}, 3, admin).cozinha, 'vitrine')
})
test('linha gravada vence o padrão', () => {
  assert.equal(acessosDaLoja({ cozinha: 'ativo' }, 3, { superAdmin: false, admin: false }).cozinha, 'abre')
  assert.equal(acessosDaLoja({ erp: 'suspenso' }, 3, { superAdmin: false, admin: false }).erp, 'consulta')
  assert.equal(acessosDaLoja({ erp: 'bloqueado' }, 3, { superAdmin: true, admin: true }).erp, 'vitrine')
})
test('moduloDaRota casa por segmento', () => {
  assert.equal(moduloDaRota('/cozinha'), 'cozinha')
  assert.equal(moduloDaRota('/cozinha/pratos/12'), 'cozinha')
  assert.equal(moduloDaRota('/cozinhas'), 'erp')
  assert.equal(moduloDaRota('/pacioli'), 'pacioli')
  assert.equal(moduloDaRota('/pacioli-x'), 'erp')
  assert.equal(moduloDaRota('/estoque/kardex'), 'erp')
  assert.equal(moduloDaRota('/home'), 'dashboard')
})
test('rotas livres', () => {
  for (const r of ['/modulos/cozinha', '/plataforma/modulos', '/usuario', '/loja', '/minha-loja', '/cargo', '/login', '/central', '/api/x', '/porta', '/entrar']) assert.equal(moduloDaRota(r), null)
})
