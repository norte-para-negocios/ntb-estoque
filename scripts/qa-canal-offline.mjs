// QA do canal do app desktop contra produção (conta QA). Só leitura + uma ação de leitura.
// Uso: node scripts/qa-canal-offline.mjs [baseUrl]
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const BASE = process.argv[2] ?? 'https://app-estoque.norteparanegocios.com.br'
const H = { 'content-type': 'application/json', 'x-ntb-versao': '1.0.0' }

async function post(caminho, corpo, extra = {}) {
  const r = await fetch(`${BASE}${caminho}`, { method: 'POST', headers: { ...H, ...extra }, body: JSON.stringify(corpo) })
  return { status: r.status, json: await r.json() }
}
async function get(caminho, extra = {}) {
  const r = await fetch(`${BASE}${caminho}`, { headers: { ...H, ...extra } })
  return { status: r.status, json: await r.json() }
}


const errada = await post('/api/offline/sessao', { acao: 'entrar', email: 'claude.qa@ntb-estoque.dev', senha: 'errada' })
assert.equal(errada.status, 401)

const s = await post('/api/offline/sessao', { acao: 'entrar', email: 'claude.qa@ntb-estoque.dev', senha: 'claudeqa123456' })
assert.equal(s.status, 200, JSON.stringify(s.json))
const token = s.json.sessao.access_token
console.log('lojas do QA:', s.json.lojas, 'admin:', s.json.admin, 'atual:', s.json.lojaAtual)
const auth = { authorization: `Bearer ${token}`, 'x-ntb-lojas': String(s.json.lojaAtual ?? s.json.lojas[0]) }

assert.equal((await get('/api/offline/tabelas', { ...auth, 'x-ntb-versao': '0.1.0' })).status, 426)
const t = await get('/api/offline/tabelas', auth)
assert.equal(t.status, 200)
console.log('tabelas:', t.json.tabelas.length, 'cursor:', t.json.cursor, 'lojas:', t.json.lojas)
const loja = t.json.lojas[0]

const snap = await get(`/api/offline/snapshot?tabela=lojas`, auth)
assert.equal(snap.status, 200)
// lojas vem com todas as permitidas (admin = todas) para o seletor; segredos nunca
for (const k of ['omie_app_key', 'omie_app_secret', 'certificado_senha_enc', 'integracao_api_key', 'csc_producao']) {
  assert.ok(snap.json.linhas.every((l) => !(k in l)), `vazou ${k}`)
}
const fam = await get(`/api/offline/snapshot?tabela=familias&limite=50`, auth)
assert.ok(fam.json.linhas.every((l) => l.loja_id === loja))
assert.equal((await get(`/api/offline/snapshot?tabela=outbox`, auth)).status, 400)
assert.equal((await get(`/api/offline/snapshot?tabela=webhooks`, auth)).status, 400)

const mud = await post('/api/offline/mudancas', { cursor: Math.max(0, t.json.cursor - 2000) }, auth)
assert.equal(mud.status, 200)
assert.ok(mud.json.mudancas.every((m) => !m.dado || !('loja_id' in m.dado) || m.dado.loja_id === loja), 'mudança de outra loja')
console.log('mudanças (últimas ~2000 versões):', mud.json.mudancas.length)

const frio = await get(`/api/offline/frio?tabela=fat_cupons&loja=${loja}&desde=2026-10-01`, auth)
assert.equal(frio.status, 200)
console.log('cupons desde 01/10:', frio.json.linhas.length)
assert.equal((await get(`/api/offline/frio?tabela=fat_cupons&loja=999999`, auth)).status, 403)

// ação de leitura pelo canal, 2x com o mesmo intent = mesmo resultado gravado
const intent = randomUUID()
const a1 = await post('/api/offline/acao', { intentId: intent, acao: 'produtos-search#buscarProdutos', args: ['agua'] }, { ...auth, 'x-ntb-desktop': '1' })
assert.equal(a1.status, 200, JSON.stringify(a1.json))
assert.equal(a1.json.ok, true, JSON.stringify(a1.json))
const a2 = await post('/api/offline/acao', { intentId: intent, acao: 'produtos-search#buscarProdutos', args: ['agua'] }, { ...auth, 'x-ntb-desktop': '1' })
assert.deepEqual(a2.json, a1.json)
console.log('buscarProdutos("agua") pelo canal:', Array.isArray(a1.json.valor) ? a1.json.valor.length : a1.json.valor)
assert.equal((await post('/api/offline/acao', { intentId: randomUUID(), acao: 'nao#existe', args: [] }, { ...auth, 'x-ntb-desktop': '1' })).status, 400)
assert.equal((await post('/api/offline/acao', { intentId: randomUUID(), acao: 'produtos-search#buscarProdutos', args: ['x'] }, { 'x-ntb-desktop': '1' })).status, 401)

console.log('OK canal offline em', BASE)
