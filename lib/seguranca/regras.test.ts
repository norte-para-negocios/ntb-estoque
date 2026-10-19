import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  acaoSoDoServidor,
  cabecalhosSeguranca,
  camposChavesOmie,
  celulaCsv,
  criarLimitador,
  cronAutorizado,
  finalSegredo,
  iguaisTempoConstante,
  ipDoCliente,
  webhookTokenOk,
} from './regras.ts'

const SEGREDO = 'abcdefghijklmnopqrstuvwxyz012345'

test('cronAutorizado: sem segredo configurado nunca autoriza (antes "Bearer undefined" passava)', () => {
  assert.equal(cronAutorizado('Bearer undefined', undefined), false)
  assert.equal(cronAutorizado('Bearer ', ''), false)
  assert.equal(cronAutorizado('Bearer curto', 'curto'), false) // segredo fraco (< 16) é tratado como ausente
})

test('cronAutorizado: só o segredo exato, com Bearer', () => {
  assert.equal(cronAutorizado(`Bearer ${SEGREDO}`, SEGREDO), true)
  assert.equal(cronAutorizado(SEGREDO, SEGREDO), false)
  assert.equal(cronAutorizado(`Bearer ${SEGREDO}x`, SEGREDO), false)
  assert.equal(cronAutorizado(`Bearer ${SEGREDO.slice(0, -1)}`, SEGREDO), false)
  assert.equal(cronAutorizado(null, SEGREDO), false)
})

test('iguaisTempoConstante', () => {
  assert.equal(iguaisTempoConstante('abc', 'abc'), true)
  assert.equal(iguaisTempoConstante('abc', 'abd'), false)
  assert.equal(iguaisTempoConstante('abc', 'abcd'), false)
  assert.equal(iguaisTempoConstante('', ''), true)
})

test('ipDoCliente: usa X-Real-IP do nginx; sem ele, o ÚLTIMO do X-Forwarded-For (o primeiro é do cliente)', () => {
  const h = (o: Record<string, string>) => (n: string) => o[n] ?? null
  assert.equal(ipDoCliente(h({ 'x-real-ip': '200.1.1.1', 'x-forwarded-for': '1.2.3.4, 200.1.1.1' })), '200.1.1.1')
  assert.equal(ipDoCliente(h({ 'x-forwarded-for': '1.2.3.4, 200.1.1.1' })), '200.1.1.1')
  assert.equal(ipDoCliente(h({})), 'desconhecido')
})

test('criarLimitador: bloqueia acima do máximo na janela e libera depois', () => {
  const excedeu = criarLimitador(3, 60_000)
  const t0 = 1_000_000
  assert.equal(excedeu('a', t0), false)
  assert.equal(excedeu('a', t0 + 1), false)
  assert.equal(excedeu('a', t0 + 2), false)
  assert.equal(excedeu('a', t0 + 3), true)
  assert.equal(excedeu('b', t0 + 3), false) // outra chave não é afetada
  assert.equal(excedeu('a', t0 + 61_000), false) // janela passou
})

test('criarLimitador: estourar o teto de chaves não zera o limite de quem está atacando', () => {
  const excedeu = criarLimitador(2, 60_000, 3)
  const t0 = 5_000_000
  excedeu('atacante', t0)
  excedeu('atacante', t0 + 1)
  for (let i = 0; i < 10; i++) excedeu(`ruido${i}`, t0 + 2)
  assert.equal(excedeu('atacante', t0 + 3), true)
})

test('celulaCsv: neutraliza fórmula (=, +, -, @, TAB, CR) e mantém número', () => {
  assert.equal(celulaCsv('=HYPERLINK("http://x","clique")'), `"'=HYPERLINK(""http://x"",""clique"")"`)
  assert.equal(celulaCsv('+5+cmd'), "'+5+cmd")
  assert.equal(celulaCsv('-2+3'), "'-2+3")
  assert.equal(celulaCsv('@SUM(A1)'), "'@SUM(A1)")
  assert.equal(celulaCsv('\tx'), "'\tx")
  assert.equal(celulaCsv('-12,5'), '-12,5')
  assert.equal(celulaCsv('-1.234,56'), '-1.234,56')
  assert.equal(celulaCsv(-3), '-3')
  assert.equal(celulaCsv('Queijo; coalho'), '"Queijo; coalho"')
  assert.equal(celulaCsv(null), '')
  assert.equal(celulaCsv('normal'), 'normal')
})

test('cabecalhosSeguranca: HSTS só no servidor web; anti-clickjacking e nosniff sempre', () => {
  const web = Object.fromEntries(cabecalhosSeguranca({ desktop: false }).map((h) => [h.key, h.value]))
  const desk = Object.fromEntries(cabecalhosSeguranca({ desktop: true }).map((h) => [h.key, h.value]))
  assert.match(web['Strict-Transport-Security'], /max-age=\d+/)
  assert.equal(desk['Strict-Transport-Security'], undefined)
  for (const h of [web, desk]) {
    assert.equal(h['X-Content-Type-Options'], 'nosniff')
    assert.equal(h['X-Frame-Options'], 'SAMEORIGIN')
    assert.match(h['Content-Security-Policy'], /frame-ancestors 'self'/)
    assert.match(h['Permissions-Policy'], /camera=\(self\)/)
  }
})

test('webhookTokenOk: sem token configurado aceita (compatível); com token exige igual', () => {
  assert.equal(webhookTokenOk(null, undefined), true)
  assert.equal(webhookTokenOk(null, 'tok-123'), false)
  assert.equal(webhookTokenOk('errado', 'tok-123'), false)
  assert.equal(webhookTokenOk('tok-123', 'tok-123'), true)
})

test('acaoSoDoServidor: crons de reenvio não passam pelo canal do desktop', () => {
  assert.equal(acaoSoDoServidor('movimentacoes#retryMovimentosManuaisPendentes'), true)
  assert.equal(acaoSoDoServidor('ordem-producao#retryOPsPendentes'), true)
  assert.equal(acaoSoDoServidor('inventario#retryAjustesInventarioPendentes'), true)
  assert.equal(acaoSoDoServidor('transferencia#retryMovimentosTransferenciaPendentes'), true)
  assert.equal(acaoSoDoServidor('qualquer#retryNovaCoisa'), true)
  assert.equal(acaoSoDoServidor('movimentacoes#criarAjusteManual'), false)
  assert.equal(acaoSoDoServidor('ordem-producao#finishOP'), false)
})

test('camposChavesOmie: campo em branco mantém a chave gravada; fora do modo omie apaga', () => {
  assert.deepEqual(camposChavesOmie('omie', '', ''), {})
  assert.deepEqual(camposChavesOmie('omie', '  ', null), {})
  assert.deepEqual(camposChavesOmie('omie', ' novaKey ', ''), { omie_app_key: 'novaKey' })
  assert.deepEqual(camposChavesOmie('omie', 'k', 's'), { omie_app_key: 'k', omie_app_secret: 's' })
  assert.deepEqual(camposChavesOmie('proprio', 'k', 's'), { omie_app_key: null, omie_app_secret: null })
  assert.deepEqual(camposChavesOmie('nenhum', '', ''), { omie_app_key: null, omie_app_secret: null })
})

test('finalSegredo: só os 4 últimos', () => {
  assert.equal(finalSegredo('1234567890'), '****7890')
  assert.equal(finalSegredo('abc'), '****')
  assert.equal(finalSegredo(null), null)
})
