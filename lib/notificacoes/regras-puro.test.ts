import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarNotificacoes, TIPOS_NOTIFICACAO, type DadosNotificacao } from './regras-puro.ts'

const base = (p: Partial<DadosNotificacao> = {}): DadosNotificacao => ({
  modo: 'omie', hoje: '2026-10-19',
  validade: { vencidos: 0, vencendo: 0, dias: 7 }, abaixoMinimo: 0, notasParadas: { quantidade: 0, diasMaisAntiga: 0, dias: 3 },
  opsCorrigirOmie: 0, movimentosTeto: 0, bloqueiosOmie: { quantidade: 0, metodo: null }, vendasFilaErro: 0, pedidosAguardando: null,
  ...p,
})

test('nada pendente: nenhuma notificação, todos os tipos avaliados (as antigas se resolvem)', () => {
  const r = montarNotificacoes(base())
  assert.equal(r.itens.length, 0)
  assert.deepEqual([...r.avaliados].sort(), [...TIPOS_NOTIFICACAO].sort())
})

test('validade: vencidos = erro, vencendo = aviso, com link e nível', () => {
  const r = montarNotificacoes(base({ validade: { vencidos: 2, vencendo: 5, dias: 7 } }))
  const v = r.itens.find((i) => i.tipo === 'validade_vencida')!
  assert.equal(v.gravidade, 'err')
  assert.equal(v.nivel, 2)
  assert.match(v.titulo, /2 itens vencidos/)
  assert.equal(v.link, '/validade?modo=vencidos')
  const p = r.itens.find((i) => i.tipo === 'validade_proxima')!
  assert.equal(p.gravidade, 'warn')
  assert.match(p.titulo, /5 itens vencem em até 7 dias/)
  assert.equal(p.link, '/validade?dias=7')
})

test('singular e plural', () => {
  const r = montarNotificacoes(base({ validade: { vencidos: 1, vencendo: 0, dias: 7 }, abaixoMinimo: 1 }))
  assert.match(r.itens.find((i) => i.tipo === 'validade_vencida')!.titulo, /^1 item vencido/)
  assert.match(r.itens.find((i) => i.tipo === 'estoque_minimo')!.titulo, /^1 produto abaixo do estoque mínimo/)
})

test('estoque mínimo: link depende do modo', () => {
  assert.equal(montarNotificacoes(base({ abaixoMinimo: 3 })).itens[0].link, '/produto?vista=compras&repor=1')
  assert.equal(montarNotificacoes(base({ modo: 'proprio', abaixoMinimo: 3, pedidosAguardando: 0 })).itens[0].link, '/reposicao')
})

test('nota parada: dias da mais antiga na mensagem e período no link', () => {
  const n = montarNotificacoes(base({ notasParadas: { quantidade: 4, diasMaisAntiga: 12, dias: 3 } })).itens[0]
  assert.equal(n.tipo, 'nota_parada')
  assert.match(n.titulo, /4 notas de entrada paradas há 3 dias ou mais/)
  assert.match(n.mensagem, /12 dias/)
  assert.equal(n.link, '/nota-fiscal?status=PENDENTE&ini=2026-09-04&fim=2026-10-19')
})

test('erros do Omie: OP para corrigir, teto de tentativas, bloqueio, fila do Vendas', () => {
  const r = montarNotificacoes(base({ opsCorrigirOmie: 2, movimentosTeto: 3, bloqueiosOmie: { quantidade: 1, metodo: 'IncluirAjusteEstoque' }, vendasFilaErro: 4 }))
  assert.deepEqual(r.itens.map((i) => i.tipo).sort(), ['bloqueio_omie', 'movimento_teto', 'op_corrigir_omie', 'vendas_fila_erro'])
  assert.ok(r.itens.every((i) => i.gravidade === 'err'))
  assert.match(r.itens.find((i) => i.tipo === 'bloqueio_omie')!.mensagem, /IncluirAjusteEstoque/)
})

test('consulta que falhou (null) deixa o tipo fora de avaliados: a notificação antiga não some por engano', () => {
  const r = montarNotificacoes(base({ abaixoMinimo: null, validade: null }))
  assert.ok(!r.avaliados.includes('estoque_minimo'))
  assert.ok(!r.avaliados.includes('validade_vencida'))
  assert.ok(!r.avaliados.includes('validade_proxima'))
  assert.ok(r.avaliados.includes('nota_parada'))
})

test('modo próprio: sem erros de Omie (avaliados e resolvidos), com pedido aguardando aprovação', () => {
  const r = montarNotificacoes(base({ modo: 'proprio', opsCorrigirOmie: 9, movimentosTeto: 9, pedidosAguardando: 2 }))
  assert.deepEqual(r.itens.map((i) => i.tipo), ['pedido_aprovacao'])
  assert.equal(r.itens[0].link, '/pedido-compra?etapa=aguardando_aprovacao')
  assert.ok(r.avaliados.includes('op_corrigir_omie'))
})

test('modo Omie: nunca gera pedido de compra local', () => {
  assert.equal(montarNotificacoes(base({ pedidosAguardando: 5 })).itens.length, 0)
})
