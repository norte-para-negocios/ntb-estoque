import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validarUrlBase, validarAmbienteLocal, PORTA_ERP_LOCAL } from './trava-url.ts'

test('aceita localhost e 127.0.0.1 na porta do stack local', () => {
  for (const u of ['http://127.0.0.1:3107', 'http://localhost:3107', 'http://127.0.0.1:3107/', 'http://localhost:3107/home']) {
    const r = validarUrlBase(u)
    assert.equal(r.ok, true, u)
  }
  assert.equal(PORTA_ERP_LOCAL, 3107)
})

test('recusa qualquer host que não seja local', () => {
  for (const u of [
    'https://erp.norteparanegocios.com.br',
    'http://185.193.66.240:3107',
    'http://localhost.evil.com:3107',
    'http://127.0.0.1.evil.com:3107',
    'http://127.0.0.1@evil.com:3107',
    'http://0.0.0.0:3107',
    'http://192.168.0.10:3107',
    'http://[::1]:3107',
  ]) {
    const r = validarUrlBase(u)
    assert.equal(r.ok, false, u)
  }
})

test('recusa porta que não é a do stack local (3000 e 3007 inclusive) e https', () => {
  for (const u of ['http://127.0.0.1:3000', 'http://127.0.0.1:3007', 'http://127.0.0.1', 'https://127.0.0.1:3107', 'http://127.0.0.1:8100']) {
    assert.equal(validarUrlBase(u).ok, false, u)
  }
})

test('recusa texto que não é URL e vazio', () => {
  assert.equal(validarUrlBase('').ok, false)
  assert.equal(validarUrlBase('localhost').ok, false)
  assert.equal(validarUrlBase('lixo ::: 3107').ok, false)
})

test('motivo explica a recusa', () => {
  const r = validarUrlBase('https://erp.exemplo.com')
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.motivo, /local/i)
})

test('ambiente: exige Supabase local, Omie bloqueado', () => {
  const bom = 'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54421\nNTB_OMIE_BLOQUEADO=1\nOMIE_FIN_DESLIGADO=1\n'
  assert.equal(validarAmbienteLocal(bom).ok, true)
  assert.equal(validarAmbienteLocal(bom.replace('54421', '8100')).ok, false)
  assert.equal(validarAmbienteLocal(bom.replace('127.0.0.1', 'supabase.co')).ok, false)
  assert.equal(validarAmbienteLocal(bom.replace('NTB_OMIE_BLOQUEADO=1', 'NTB_OMIE_BLOQUEADO=0')).ok, false)
  assert.equal(validarAmbienteLocal('').ok, false)
})

// ---- Trava do servidor em execução (achado 1 da revisão) ----
import { valorEnv, validarAmbienteShell, nomeCookieSessao, montarCookieSessao, interpretarSonda } from './trava-url.ts'

const ENV_BOM = 'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54421\nNEXT_PUBLIC_SUPABASE_ANON_KEY=anon\nNTB_OMIE_BLOQUEADO=1\n'

test('valorEnv lê chave, tira aspas e devolve null se ausente', () => {
  assert.equal(valorEnv('A="x y"\nB=2', 'A'), 'x y')
  assert.equal(valorEnv('A=1', 'B'), null)
})

test('shell: sem variáveis exportadas passa', () => {
  assert.equal(validarAmbienteShell({}, ENV_BOM).ok, true)
  assert.equal(validarAmbienteShell({ PATH: '/bin', NTB_OMIE_BLOQUEADO: '1', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54421' }, ENV_BOM).ok, true)
})

test('shell: Supabase exportado diferente do .env.local é recusado (sobrepõe o arquivo)', () => {
  const r = validarAmbienteShell({ NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co' }, ENV_BOM)
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.motivo, /NEXT_PUBLIC_SUPABASE_URL/)
  assert.equal(validarAmbienteShell({ NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:8100' }, ENV_BOM).ok, false)
})

test('shell: chaves e banco exportados diferentes do .env.local são recusados', () => {
  for (const k of ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_DB_URL', 'NTB_FRIO_API_URL']) {
    assert.equal(validarAmbienteShell({ [k]: 'outro' }, ENV_BOM + `${k}=original\n`).ok, false, k)
  }
  assert.equal(validarAmbienteShell({ NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon' }, ENV_BOM).ok, true)
})

test('shell: NTB_OMIE_BLOQUEADO diferente de 1 e ANTHROPIC_API_KEY presente são recusados', () => {
  assert.equal(validarAmbienteShell({ NTB_OMIE_BLOQUEADO: '0' }, ENV_BOM).ok, false)
  assert.equal(validarAmbienteShell({ NTB_OMIE_BLOQUEADO: '' }, ENV_BOM).ok, false)
  const r = validarAmbienteShell({ ANTHROPIC_API_KEY: 'sk-x' }, ENV_BOM)
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.motivo, /ANTHROPIC_API_KEY/)
  assert.equal(validarAmbienteShell({ ANTHROPIC_API_KEY: '' }, ENV_BOM).ok, true)
})

test('cookie de sessão: nome vem do host da URL do Supabase (como o @supabase/ssr)', () => {
  assert.equal(nomeCookieSessao('http://127.0.0.1:54421'), 'sb-127-auth-token')
  assert.equal(nomeCookieSessao('https://abc.supabase.co'), 'sb-abc-auth-token')
  assert.equal(nomeCookieSessao('http://localhost:54421'), 'sb-localhost-auth-token')
})

test('cookie de sessão: base64- + json base64url, em pedaços de 3180 se grande', () => {
  const pequeno = montarCookieSessao('sb-127-auth-token', { access_token: 'a', refresh_token: 'r', expires_at: 1, expires_in: 2, token_type: 'bearer' })
  assert.match(pequeno, /^sb-127-auth-token=base64-[A-Za-z0-9_-]+$/)
  const json = Buffer.from(pequeno.split('=base64-')[1], 'base64url').toString()
  assert.equal(JSON.parse(json).access_token, 'a')
  const grande = montarCookieSessao('sb-127-auth-token', { access_token: 'x'.repeat(5000), refresh_token: 'r', expires_at: 1, expires_in: 2, token_type: 'bearer' })
  assert.match(grande, /^sb-127-auth-token\.0=base64-.*; sb-127-auth-token\.1=/)
})

test('sonda: só redirecionamento para fora do /login prova que o servidor aceitou o token local', () => {
  assert.equal(interpretarSonda(307, '/home').ok, true)
  assert.equal(interpretarSonda(307, 'http://127.0.0.1:3107/home').ok, true)
  assert.equal(interpretarSonda(200, null).ok, false)
  assert.equal(interpretarSonda(307, '/login').ok, false)
  assert.equal(interpretarSonda(500, null).ok, false)
  const r = interpretarSonda(200, null)
  if (!r.ok) assert.match(r.motivo, /não aceitou|outro Supabase/i)
})
