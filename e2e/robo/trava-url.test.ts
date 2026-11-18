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
