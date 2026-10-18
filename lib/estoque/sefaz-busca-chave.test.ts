// Revisão final da Fase B (achado 6): nota pela chave digitada respeita a espera da SEFAZ (bloqueado_ate, 137/656) e
// recusa loja de teste e loja inativa — tudo ANTES de qualquer consulta. Fakes das linhas do banco, sem rede.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { prechecarBuscaPorChave } from './sefaz-busca-chave.ts'

const CHAVE = '29260999111222000149550220001310551123456781' // fixture CRBS (DV válido)
const AGORA = Date.parse('2026-10-19T15:00:00Z')
const loja = { modo_estoque: 'proprio', ativo: true, is_test: false, cnpj: '66764497000122', certificado_path: 'cert/15.pfx' }
const ok = { chave: CHAVE, loja, nsu: { bloqueado_ate: null }, tentativa: null, agora: AGORA }

test('busca pela chave: tudo certo passa e devolve a chave só com dígitos', () => {
  assert.deepEqual(prechecarBuscaPorChave({ ...ok, chave: CHAVE.replace(/(\d{4})/g, '$1 ') }), { ok: true, chave: CHAVE, cnpj: '66764497000122' })
  // tentativa antiga (> 1 h) e espera já vencida não seguram
  assert.equal('ok' in prechecarBuscaPorChave({ ...ok, tentativa: { ultima_em: '2026-10-19T13:59:00Z' }, nsu: { bloqueado_ate: '2026-10-19T14:59:00Z' } }), true)
})

test('busca pela chave respeita sefaz_nsu.bloqueado_ate (656/137: esperar 1 hora)', () => {
  const r = prechecarBuscaPorChave({ ...ok, nsu: { bloqueado_ate: '2026-10-19T15:40:00Z' } })
  assert.ok('error' in r)
  assert.match(r.error, /SEFAZ pediu para esperar/)
  assert.match(r.error, /12:40/) // horário de Brasília
})

test('busca pela chave recusa loja de teste, loja inativa e loja que não é própria', () => {
  assert.deepEqual(prechecarBuscaPorChave({ ...ok, loja: { ...loja, is_test: true } }), { error: 'Loja de teste não consulta a SEFAZ.' })
  assert.deepEqual(prechecarBuscaPorChave({ ...ok, loja: { ...loja, ativo: false } }), { error: 'Loja inativa.' })
  assert.deepEqual(prechecarBuscaPorChave({ ...ok, loja: { ...loja, modo_estoque: 'omie' } }), { error: 'A loja não usa estoque próprio.' })
  assert.deepEqual(prechecarBuscaPorChave({ ...ok, loja: null }), { error: 'A loja não usa estoque próprio.' })
})

test('busca pela chave: chave, modelo, emitente, certificado e 1 tentativa por hora', () => {
  assert.deepEqual(prechecarBuscaPorChave({ ...ok, chave: CHAVE.slice(0, 43) + '0' }), { error: 'Chave de acesso inválida (confira os 44 dígitos).' })
  assert.deepEqual(prechecarBuscaPorChave({ ...ok, loja: { ...loja, cnpj: '99111222000149' } }), { error: 'Esta nota foi emitida pela própria loja.' })
  assert.deepEqual(prechecarBuscaPorChave({ ...ok, loja: { ...loja, certificado_path: null } }), { error: 'A loja não tem certificado digital cadastrado.' })
  assert.deepEqual(prechecarBuscaPorChave({ ...ok, tentativa: { ultima_em: '2026-10-19T14:30:00Z' } }), { error: 'Esta chave já foi consultada há menos de 1 hora.' })
})

test('importarNotaPorChave precheca (com bloqueado_ate e is_test) antes de gravar a tentativa e consultar', () => {
  const src = readFileSync(new URL('./sefaz-sync.ts', import.meta.url), 'utf8')
  const i = src.indexOf('export async function importarNotaPorChave(')
  const corpo = src.slice(i, src.indexOf('\nexport async function ', i + 10))
  const iPre = corpo.indexOf('prechecarBuscaPorChave('), iIns = corpo.indexOf(".from('sefaz_busca_chave').insert"), iCons = corpo.indexOf('consultarPorChave(')
  assert.ok(iPre >= 0 && iIns > iPre && iCons > iPre, 'precheck depois da escrita/consulta')
  assert.ok(/from\('sefaz_nsu'\)\.select\('[^']*bloqueado_ate/.test(corpo.slice(0, iPre)), 'não lê bloqueado_ate antes do precheck')
  assert.ok(/from\('lojas'\)\.select\('[^']*is_test/.test(corpo.slice(0, iPre)), 'não lê is_test')
})
