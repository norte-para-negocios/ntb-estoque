import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarNotificacoes, TIPOS_NOTIFICACAO, type DadosNotificacao } from './regras-puro.ts'

const base = (p: Partial<DadosNotificacao> = {}): DadosNotificacao => ({
  modo: 'omie', hoje: '2026-10-19',
  validade: { vencidos: 0, vencendo: 0, dias: 7 }, abaixoMinimo: 0, notasParadas: { quantidade: 0, diasMaisAntiga: 0, dias: 3 },
  opsCorrigirOmie: 0, movimentosTeto: 0, bloqueiosOmie: { quantidade: 0, metodo: null }, vendasFilaErro: 0, pedidosAguardando: null,
  certificadoValidade: '', catalogoErros: null, contasPagar: null,
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

test('Fase 9: certificado A1, catálogo do Vendas e contas a pagar', () => {
  const base = { modo: 'proprio' as const, hoje: '2026-11-07', validade: null, abaixoMinimo: null, notasParadas: null, opsCorrigirOmie: null,
    movimentosTeto: null, bloqueiosOmie: null, vendasFilaErro: null, pedidosAguardando: null,
    certificadoValidade: null as string | null, catalogoErros: null as number | null, contasPagar: null as { vencidas: number; valorVencido: number; hoje: number } | null }
  // A1: fora dos 30 dias não avisa mas é avaliado (resolve); 20 dias = aviso nível 1; 5 dias = erro; vencido = 100
  let r = montarNotificacoes({ ...base, certificadoValidade: '2027-06-10' })
  assert.ok(r.avaliados.includes('certificado_a1')); assert.equal(r.itens.length, 0)
  r = montarNotificacoes({ ...base, certificadoValidade: '2026-11-27' })
  let a = r.itens.find((i) => i.tipo === 'certificado_a1')!
  assert.equal(a.gravidade, 'warn'); assert.equal(a.nivel, 1); assert.match(a.titulo, /vence em 20 dias \(27\/11\/2026\)/)
  a = montarNotificacoes({ ...base, certificadoValidade: '2026-11-12' }).itens.find((i) => i.tipo === 'certificado_a1')!
  assert.equal(a.gravidade, 'err'); assert.equal(a.nivel, 3)
  a = montarNotificacoes({ ...base, certificadoValidade: '2026-11-01' }).itens.find((i) => i.tipo === 'certificado_a1')!
  assert.match(a.titulo, /vencido em 01\/11\/2026/); assert.equal(a.nivel, 100)
  // loja sem certificado ('') = avaliado sem aviso; consulta falhou (null) = fora de avaliados
  assert.ok(montarNotificacoes({ ...base, certificadoValidade: '' }).avaliados.includes('certificado_a1'))
  assert.ok(!montarNotificacoes({ ...base, certificadoValidade: null }).avaliados.includes('certificado_a1'))
  // catálogo e contas
  r = montarNotificacoes({ ...base, catalogoErros: 2, contasPagar: { vencidas: 3, valorVencido: 1500.5, hoje: 1 } })
  assert.match(r.itens.find((i) => i.tipo === 'catalogo_vendas_erro')!.titulo, /^2 itens do cadastro não chegaram/)
  const c = r.itens.find((i) => i.tipo === 'contas_pagar_vencidas')!
  assert.match(c.titulo, /^3 contas a pagar vencidas \(R\$\s1\.500,50\)/); assert.equal(c.nivel, 3001); assert.match(c.mensagem, /E mais 1 vence hoje/)
  // loja Omie: catálogo e contas não se aplicam (avaliados para resolver), A1 sim
  r = montarNotificacoes({ ...base, modo: 'omie', catalogoErros: 5, contasPagar: { vencidas: 1, valorVencido: 10, hoje: 0 }, certificadoValidade: '2026-11-10' })
  assert.deepEqual(r.itens.map((i) => i.tipo), ['certificado_a1'])
})
