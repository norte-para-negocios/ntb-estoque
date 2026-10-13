import { test } from 'node:test'
import assert from 'node:assert/strict'
import { idadeDias, itensDaOPGravada, situacaoDaOP, ROTULO_ORIGEM_OP } from './ops-tela-puro.ts'

test('idadeDias: dias desde a inclusão, na virada de mês; sem data = null', () => {
  assert.equal(idadeDias('2026-09-28', '2026-10-03'), 5)
  assert.equal(idadeDias('2026-10-03', '2026-10-03'), 0)
  assert.equal(idadeDias('2026-10-03T15:00:00+00:00', '2026-10-04'), 1)
  assert.equal(idadeDias(null, '2026-10-03'), null)
  assert.equal(idadeDias('lixo', '2026-10-03'), null)
})

test('itensDaOPGravada: lê itensDetalhes; ausente ou malformado = []', () => {
  assert.deepEqual(itensDaOPGravada({ itensDetalhes: [{ nIdProdutoMalha: 5, nQtde: 2.5, codigo_local_estoque: 9 }, { nIdProdutoMalha: 6, nQtde: '1' }, { nQtde: 3 }] }), [
    { insumo: 5, quantidade: 2.5, local: 9 },
    { insumo: 6, quantidade: 1, local: null },
  ])
  assert.deepEqual(itensDaOPGravada(null), [])
  assert.deepEqual(itensDaOPGravada({ itensDetalhes: 'x' }), [])
  assert.deepEqual(itensDaOPGravada('texto'), [])
})

test('situacaoDaOP: cupom com prato não negativo sobra; prato negativo falta; saldo desconhecido = null', () => {
  assert.equal(situacaoDaOP('cupom', 0), 'sobrando')
  assert.equal(situacaoDaOP('cupom', 4), 'sobrando')
  assert.equal(situacaoDaOP('manual', 4), 'ok')
  assert.equal(situacaoDaOP('cupom', -1), 'faltando')
  assert.equal(situacaoDaOP('manual', -1), 'faltando')
  assert.equal(situacaoDaOP('cupom', null), null)
})

test('rótulos de origem cobrem as origens gravadas pelo cron', () => {
  for (const o of ['vendas', 'app', 'script', 'cupom', 'manual']) assert.ok(ROTULO_ORIGEM_OP[o])
})
