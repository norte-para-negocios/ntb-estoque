import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizarPedidoRef, montarStatusPedido, ehTabelaAusente } from './registro-pedido-venda.ts'

const marcos = { primeiro: '2026-11-03T10:00:00Z', ultimo: '2026-11-03T12:00:00Z' }

test('normalizarPedidoRef: minúsculas e sem espaço; vazio/inválido = null', () => {
  assert.equal(normalizarPedidoRef('  ABC-1 '), 'abc-1')
  assert.equal(normalizarPedidoRef(''), null)
  assert.equal(normalizarPedidoRef('   '), null)
  assert.equal(normalizarPedidoRef(123), null)
  assert.equal(normalizarPedidoRef('x'.repeat(201)), null)
})

test('sem registro: não processado, nada em andamento, marcos repassados', () => {
  const s = montarStatusPedido('p1', [], marcos)
  assert.equal(s.versao, 1)
  assert.equal(s.processado, false)
  assert.equal(s.emAndamento, false)
  assert.deepEqual(s.envios, [])
  assert.deepEqual(s.itens, [])
  assert.equal(s.primeiroRegistro, marcos.primeiro)
  assert.equal(s.ultimoRegistro, marcos.ultimo)
})

test('envio concluído: resultado por item na mesma ordem, resumo com nCodOP', () => {
  const s = montarStatusPedido('p1', [{
    recebido_em: '2026-11-03T11:00:00Z', concluido_em: '2026-11-03T11:03:00Z', itens: ['A', 'B'],
    resultados: [{ codigo: 'A', ok: true, nCodOP: 9, op: 'criada', baixa: 'Concluido' }, { codigo: 'B', ok: true, op: 'sem_estrutura', baixa: 'Concluido' }],
  }], marcos)
  assert.equal(s.processado, true)
  assert.equal(s.emAndamento, false)
  assert.deepEqual(s.itens, [{ codigo: 'A', nCodOP: 9 }, { codigo: 'B' }])
  assert.equal(s.envios[0].itens[0].ok, true)
  assert.equal(s.envios[0].itens[1].op, 'sem_estrutura')
})

test('envio sem conclusão: em andamento e itens sem resultado', () => {
  const s = montarStatusPedido('p1', [{ recebido_em: '2026-11-03T11:00:00Z', concluido_em: null, itens: ['A'], resultados: null }], marcos)
  assert.equal(s.processado, false)
  assert.equal(s.emAndamento, true)
  assert.deepEqual(s.envios[0].itens, [{ codigo: 'A' }])
  assert.deepEqual(s.itens, [])
})

test('resultado com código diferente na posição não é usado', () => {
  const s = montarStatusPedido('p1', [{
    recebido_em: '2026-11-03T11:00:00Z', concluido_em: '2026-11-03T11:01:00Z', itens: ['A'], resultados: [{ codigo: 'Z', ok: true }],
  }], marcos)
  assert.deepEqual(s.envios[0].itens, [{ codigo: 'A' }])
})

test('vários envios ficam em ordem de chegada; resumo usa o último concluído', () => {
  const s = montarStatusPedido('p1', [
    { recebido_em: '2026-11-03T11:30:00Z', concluido_em: '2026-11-03T11:31:00Z', itens: ['A'], resultados: [{ codigo: 'A', ok: true, nCodOP: 2 }] },
    { recebido_em: '2026-11-03T11:00:00Z', concluido_em: '2026-11-03T11:01:00Z', itens: ['A', 'B'], resultados: [{ codigo: 'A', ok: false, op: 'pulada' }, { codigo: 'B', ok: true }] },
  ], marcos)
  assert.deepEqual(s.envios.map((e) => e.recebidoEm), ['2026-11-03T11:00:00Z', '2026-11-03T11:30:00Z'])
  assert.deepEqual(s.itens, [{ codigo: 'A', nCodOP: 2 }, { codigo: 'B' }])
})

test('ehTabelaAusente', () => {
  assert.equal(ehTabelaAusente({ code: '42P01', message: 'relation "venda_integracao_pedidos" does not exist' }), true)
  assert.equal(ehTabelaAusente({ code: 'PGRST205', message: "Could not find the table 'public.venda_integracao_pedidos'" }), true)
  assert.equal(ehTabelaAusente({ code: '23505', message: 'duplicate' }), false)
  assert.equal(ehTabelaAusente(null), false)
})
