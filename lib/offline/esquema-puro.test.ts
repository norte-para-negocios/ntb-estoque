import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { hashDoEsquema, decidirEsquema } from './esquema-puro.ts'
import { ESQUEMA_HASH } from './esquema-atual.ts'

const DIR = path.join(import.meta.dirname, '..', '..', 'desktop', 'schema')

test('hash: estável, depende do conteúdo e do nome do arquivo, não da ordem', () => {
  const a = hashDoEsquema([{ nome: 'a.sql', texto: 'x' }, { nome: 'b.sql', texto: 'y' }])
  assert.equal(a, hashDoEsquema([{ nome: 'b.sql', texto: 'y' }, { nome: 'a.sql', texto: 'x' }]))
  assert.notEqual(a, hashDoEsquema([{ nome: 'a.sql', texto: 'x' }, { nome: 'b.sql', texto: 'z' }]))
  assert.match(a, /^[0-9a-f]{16}$/)
})

test('decisão: hash igual passa', () => {
  assert.deepEqual(decidirEsquema({ hashApp: 'abc', hashAtual: 'abc' }), { ok: true })
})

test('decisão: hash antigo recebe 426 com mensagem de atualizar', () => {
  const r = decidirEsquema({ hashApp: 'velho', hashAtual: 'novo' })
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.equal(r.status, 426)
    assert.match(r.mensagem, /Atualize o Norte Estoque/)
  }
})

test('decisão: hash extra aceito (janela de troca) passa', () => {
  assert.deepEqual(decidirEsquema({ hashApp: 'velho', hashAtual: 'novo', aceitos: ['velho'] }), { ok: true })
})

test('decisão: app que não manda hash (1.0.3/1.0.4) passa; a versão mínima cuida dele', () => {
  assert.deepEqual(decidirEsquema({ hashApp: null, hashAtual: 'novo' }), { ok: true })
})

test('decisão: app que não manda hash é recusado quando exigirHash', () => {
  const r = decidirEsquema({ hashApp: null, hashAtual: 'novo', exigirHash: true })
  assert.equal(r.ok, false)
})

test('esquema-atual.ts bate com desktop/schema/*.sql (rode node desktop/scripts/hash-esquema.mjs ao regenerar)', () => {
  const arquivos = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).map((nome) => ({ nome, texto: fs.readFileSync(path.join(DIR, nome), 'utf8') }))
  assert.equal(ESQUEMA_HASH, hashDoEsquema(arquivos))
  assert.equal(fs.readFileSync(path.join(DIR, 'hash.txt'), 'utf8').trim(), ESQUEMA_HASH)
})
