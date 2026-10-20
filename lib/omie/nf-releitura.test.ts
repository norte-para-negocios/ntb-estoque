import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deveRelerNota, escolherNotasParaReler, lojasForaDaReleitura, motivoParaNaoConsultar, nIdRecebDoAviso, ESPERA_APOS_FALHA_MS, JANELA_CONSULTA_MS } from './nf-releitura.ts'

// Aviso real da NF 3999 (loja 5, 07/10/2026 12:05:41), só os campos que importam.
const AVISO_3999 = {
  messageId: 'x', appKey: 'y', topic: 'RecebimentoProduto.Concluido',
  event: { frete: { cTpFrete: '9' }, cabecalho: { cEtapa: '60', nIdReceb: 3817713557, cNumeroNF: '3999', dDataRegistro: '17/09/2026' } },
}

test('id do recebimento vem de event.cabecalho (formato real do Omie)', () => {
  assert.equal(nIdRecebDoAviso(AVISO_3999), 3817713557)
  assert.equal(nIdRecebDoAviso({ event: { nIdReceb: 12 } }), 12)
  assert.equal(nIdRecebDoAviso({ event: {} }), null)
  assert.equal(nIdRecebDoAviso(null), null)
  assert.equal(nIdRecebDoAviso({ event: { cabecalho: { nIdReceb: 'abc' } } }), null)
})

test('só conclusão e reversão relêem a nota', () => {
  assert.equal(deveRelerNota('RecebimentoProduto.Concluido'), true)
  assert.equal(deveRelerNota('RecebimentoProduto.Revertido'), true)
  assert.equal(deveRelerNota('RecebimentoProduto.Alterado'), false)
  assert.equal(deveRelerNota('RecebimentoProduto.Incluido'), false)
  assert.equal(deveRelerNota(undefined), false)
})

test('lojas fora: 4 e 7 fixas; a env só acrescenta', () => {
  assert.deepEqual([...lojasForaDaReleitura(undefined)], [4, 7])
  assert.deepEqual([...lojasForaDaReleitura('')], [4, 7])
  assert.deepEqual([...lojasForaDaReleitura('9, x')], [4, 7, 9])
  assert.equal(lojasForaDaReleitura('5').has(4), true) // env sem a 4 não a libera
})

test('webhook: não consulta a mesma nota 2× em 90 s nem nota gravada depois do aviso', () => {
  const agora = Date.parse('2026-10-07T12:05:41Z')
  assert.equal(motivoParaNaoConsultar({ agoraMs: agora, avisoMs: agora }), null)
  assert.equal(motivoParaNaoConsultar({ agoraMs: agora, avisoMs: agora, ultimaConsultaMs: agora - 34_000 }), 'consultada há menos de 90 s')
  assert.equal(motivoParaNaoConsultar({ agoraMs: agora, avisoMs: agora, ultimaConsultaMs: agora - JANELA_CONSULTA_MS }), null)
  assert.equal(motivoParaNaoConsultar({ agoraMs: agora, avisoMs: agora - 1000, notaAtualizadaMs: agora - 500 }), 'nota já gravada depois do aviso')
  assert.equal(motivoParaNaoConsultar({ agoraMs: agora, avisoMs: agora, notaAtualizadaMs: Date.parse('2026-09-24T21:50:10Z') }), null) // NF 3999
})

test('cron não consulta a nota que o webhook acabou de consultar', () => {
  const agora = Date.parse('2026-10-07T12:06:00Z')
  const avisos = [{ n_id_receb: '3817713557', created_at: '2026-10-07T12:05:41Z' }]
  const notas = [{ n_id_receb: '3817713557', updated_at: '2026-09-24T21:50:10Z', deleted_at: null }]
  assert.deepEqual(escolherNotasParaReler(avisos, notas, { agoraMs: agora, consultas: new Map([['3817713557', agora - 10_000]]) }), [])
  assert.deepEqual(escolherNotasParaReler(avisos, notas, { agoraMs: agora, consultas: new Map([['3817713557', agora - 100_000]]) }), ['3817713557'])
})

test('NF 3999: aviso de 07/10 mais novo que a gravação de 24/09 → relê', () => {
  const avisos = [
    { n_id_receb: '3817713557', created_at: '2026-09-17T16:14:54Z' },
    { n_id_receb: '3817713557', created_at: '2026-10-07T12:05:41Z' },
    { n_id_receb: '111', created_at: '2026-10-07T12:00:00Z' },  // já relida depois do aviso
    { n_id_receb: '222', created_at: '2026-10-08T12:00:00Z' },  // o NTB não tem a nota
    { n_id_receb: null, created_at: '2026-10-08T12:00:00Z' },
  ]
  const notas = [
    { n_id_receb: '3817713557', updated_at: '2026-09-24T21:50:10Z', deleted_at: null },
    { n_id_receb: '111', updated_at: '2026-10-07T12:10:00Z', deleted_at: null },
  ]
  assert.deepEqual(escolherNotasParaReler(avisos, notas), ['3817713557'])
})

test('limite por ciclo, mais recentes primeiro, apagada fora, falha recente espera 6 h', () => {
  const avisos = ['1', '2', '3', '4', '5'].map((k, i) => ({ n_id_receb: k, created_at: `2026-10-1${i}T10:00:00Z` }))
  const notas = ['1', '2', '3', '4', '5'].map((k) => ({ n_id_receb: k, updated_at: '2026-10-01T00:00:00Z', deleted_at: k === '4' ? '2026-10-02T00:00:00Z' : null }))
  assert.deepEqual(escolherNotasParaReler(avisos, notas), ['5', '3', '2'])
  const agora = Date.parse('2026-10-20T12:00:00Z')
  const falhas = new Map([['5', agora - 3600_000], ['3', agora - ESPERA_APOS_FALHA_MS - 1]])
  assert.deepEqual(escolherNotasParaReler(avisos, notas, { agoraMs: agora, falhas, limite: 10 }), ['3', '2', '1'])
})
