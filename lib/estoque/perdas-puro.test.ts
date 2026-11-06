import { test } from 'node:test'
import assert from 'node:assert/strict'
import { causaDaPerda, montarPerdas, type MovPerda } from './perdas-puro.ts'

// T5.4: perdas e desperdício com causa. Fonte: ajuste manual (motivo em obs), baixa de lote vencido (PERDA) e diferença de
// inventário. Correção de dados não é perda; estorno anula; entrada (sobra) não entra.

const mov = (p: Partial<MovPerda>): MovPerda => ({
  id: 1, origem: 'AJUSTE_MANUAL', quantidade: -1, obs: null, codigo_produto: 10, codigo_local_estoque: 1, data_ref: '2026-11-02',
  custo_unitario: 2, cmc_apos: 2, user_id: null, ...p,
})

test('causa pela origem e pelo motivo escrito', () => {
  assert.equal(causaDaPerda(mov({ origem: 'PERDA', obs: 'Baixa por vencimento · lote SAL-V · val. 01/11/2026 · venceu' })), 'vencimento')
  // motivos da tela de baixa de lote (BaixaLote): a causa vem do motivo escolhido, depois do último " · "
  assert.equal(causaDaPerda(mov({ origem: 'PERDA', obs: 'Baixa por vencimento · lote A · val. 01/11/2026 · Vencido' })), 'vencimento')
  assert.equal(causaDaPerda(mov({ origem: 'PERDA', obs: 'Baixa por vencimento · lote A · Avaria / embalagem danificada' })), 'quebra')
  assert.equal(causaDaPerda(mov({ origem: 'PERDA', obs: 'Baixa por vencimento · val. 02/11/2026 · Estragou antes do vencimento' })), 'desperdicio')
  assert.equal(causaDaPerda(mov({ origem: 'PERDA', obs: 'Baixa por vencimento · lote A · Descarte por qualidade' })), 'desperdicio')
  assert.equal(causaDaPerda(mov({ obs: 'quebra de 2 garrafas (QA)' })), 'quebra')
  assert.equal(causaDaPerda(mov({ obs: 'Garrafa quebrou no bar' })), 'quebra')
  assert.equal(causaDaPerda(mov({ obs: 'Produto estragado' })), 'desperdicio')
  assert.equal(causaDaPerda(mov({ obs: 'desperdício na produção' })), 'desperdicio')
  assert.equal(causaDaPerda(mov({ obs: 'leite vencido' })), 'vencimento')
  assert.equal(causaDaPerda(mov({ origem: 'INVENTARIO', obs: 'Inventário #12' })), 'inventario')
  assert.equal(causaDaPerda(mov({ obs: 'Ajuste da consultoria NTB: anula a entrada de correção CORR-NEG' })), 'correcao')
  assert.equal(causaDaPerda(mov({ obs: 'contei errado ontem' })), 'outro')
  assert.equal(causaDaPerda(mov({ origem: 'PERDA', obs: 'caiu no chão' })), 'quebra')
  assert.equal(causaDaPerda(mov({ origem: 'PERDA', obs: null })), 'outro')
})

test('só saídas, sem as estornadas; valor pelo custo efetivo do movimento (senão o CMC)', () => {
  const r = montarPerdas([
    mov({ id: 1, quantidade: -2, custo_unitario: 3, obs: 'quebrou' }),
    mov({ id: 2, quantidade: 5, obs: 'achei mais' }),                       // sobra: fora
    mov({ id: 3, quantidade: -1, obs: 'quebrou', custo_unitario: 9 }),       // estornado: fora
    mov({ id: 4, origem: 'PERDA', quantidade: -1, custo_unitario: null, cmc_apos: 4, obs: 'Baixa por vencimento · lote A' }),
  ], new Set([3]))
  assert.deepEqual(r.linhas.map((l) => [l.id, l.causa, l.quantidade, l.valor]), [[1, 'quebra', 2, 6], [4, 'vencimento', 1, 4]])
  assert.equal(r.totalPerdas, 10)
})

test('correção de dados fica separada e fora do total; total por causa em ordem de valor', () => {
  const r = montarPerdas([
    mov({ id: 1, quantidade: -10, custo_unitario: 1, obs: 'Ajuste da consultoria NTB: compensa' }),
    mov({ id: 2, quantidade: -1, custo_unitario: 5, obs: 'estragou' }),
    mov({ id: 3, quantidade: -3, custo_unitario: 5, origem: 'INVENTARIO', obs: 'Inventário #1' }),
  ], new Set())
  assert.equal(r.totalPerdas, 20)
  assert.equal(r.totalCorrecoes, 10)
  assert.deepEqual(r.porCausa.map((c) => [c.causa, c.valor, c.n]), [['inventario', 15, 1], ['desperdicio', 5, 1], ['correcao', 10, 1]])
})
