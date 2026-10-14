import { test } from 'node:test'
import assert from 'node:assert/strict'
import { origemDaOP, linhaOPAberta, opMudou, opsQueSairamDaLista, precisaConsultarItens, candidataASair, confirmarSaidas, type OPOmieLista } from './ops-abertas-puro.ts'

test('origemDaOP: vendas, app, script, cupom (obs ou WEBSERVICE) e manual', () => {
  assert.equal(origemDaOP({ cCodIntOP: 'NTBV17283' }), 'vendas')
  assert.equal(origemDaOP({ cCodIntOP: 'NTB-1728300' }), 'app')
  assert.equal(origemDaOP({ cCodIntOP: 'OP-80312' }), 'script')
  assert.equal(origemDaOP({ cCodIntOP: 'FAX-1' }), 'script')
  assert.equal(origemDaOP({ cCodIntOP: '', cObs: 'Cupom 205152' }), 'cupom')
  assert.equal(origemDaOP({ cCodIntOP: '', cObs: '', uInc: 'WEBSERVICE' }), 'cupom')
  assert.equal(origemDaOP({ cCodIntOP: '', cObs: 'refazer', uInc: 'P000331146' }), 'manual')
  assert.equal(origemDaOP({}), 'manual')
})

const op: OPOmieLista = {
  identificacao: { cCodIntOP: '', cNumOP: '2025/00261147', codigo_local_estoque: 2424369390, dDtPrevisao: '19/05/2025', nCodOP: 3560258353, nCodProduto: 2795175537, nQtde: 30 },
  observacoes: { cObs: 'Cupom 1' },
  outrasInf: { cConcluida: 'N', dAlteracao: '19/05/2025', dInclusao: '18/05/2025', uAlt: 'P1', uInc: 'P2' },
}

test('linhaOPAberta: colunas escalares, origem, autor e aberta_omie', () => {
  const l = linhaOPAberta(op, 5)
  assert.equal(l.loja_id, 5)
  assert.equal(l.identificacao_n_cod_op, 3560258353)
  assert.equal(l.identificacao_d_dt_previsao, '2025-05-19')
  assert.equal(l.dt_inclusao, '2025-05-18')
  assert.equal(l.incluido_por_omie, 'P2')
  assert.equal(l.alterado_por_omie, 'P1')
  assert.equal(l.obs_omie, 'Cupom 1')
  assert.equal(l.origem_op, 'cupom')
  assert.equal(l.aberta_omie, true)
  assert.equal(l.num_ordem, '2025/00261147')
})

test('linhaOPAberta: corta cCodIntOP em 20 e cNumOP em 15 (tamanho das colunas)', () => {
  const l = linhaOPAberta({ ...op, identificacao: { ...op.identificacao, cCodIntOP: 'X'.repeat(30), cNumOP: '9'.repeat(20) } }, 5)
  assert.equal(l.identificacao_c_cod_int_op?.length, 20)
  assert.equal(l.identificacao_c_num_op?.length, 15)
})

test('opMudou: igual com número vindo como texto não muda; campo diferente muda', () => {
  const l = linhaOPAberta(op, 5)
  const banco = { ...l, identificacao_n_qtde: '30.00', identificacao_n_cod_op: '3560258353' }
  assert.equal(opMudou(banco, l), false)
  assert.equal(opMudou({ ...banco, aberta_omie: null }, l), true)
  assert.equal(opMudou({ ...banco, obs_omie: 'outra' }, l), true)
})

test('opsQueSairamDaLista: só com lista completa; lista vazia com muitas abertas é suspeita', () => {
  assert.deepEqual(opsQueSairamDaLista([1, 2, 3], new Set([2]), true), [1, 3])
  assert.deepEqual(opsQueSairamDaLista([1, 2, 3], new Set([2]), false), [])
  assert.deepEqual(opsQueSairamDaLista(Array.from({ length: 11 }, (_, i) => i), new Set(), true), [])
  assert.deepEqual(opsQueSairamDaLista([1, 2], new Set(), true), [1, 2])
})

test('precisaConsultarItens: só sem itens gravados e nunca consultada', () => {
  assert.equal(precisaConsultarItens({ full_object: null, itens_consultados_em: null }), true)
  assert.equal(precisaConsultarItens({ full_object: { itensDetalhes: [] }, itens_consultados_em: null }), true)
  assert.equal(precisaConsultarItens({ full_object: { itensDetalhes: [{ a: 1 }] }, itens_consultados_em: null }), false)
  assert.equal(precisaConsultarItens({ full_object: null, itens_consultados_em: '2026-10-13T10:00:00Z' }), false)
})

test('candidataASair: aberta no Omie mesmo já concluída aqui (sync-ops marca a conclusão antes); nunca vista e não concluída', () => {
  assert.equal(candidataASair({ aberta_omie: true, concluida: true }), true)
  assert.equal(candidataASair({ aberta_omie: true, concluida: false }), true)
  assert.equal(candidataASair({ aberta_omie: null, concluida: false }), true)
  assert.equal(candidataASair({ aberta_omie: null, concluida: null }), true)
  assert.equal(candidataASair({ aberta_omie: null, concluida: true }), false)
  assert.equal(candidataASair({ aberta_omie: false, concluida: false }), false)
})

test('confirmarSaidas: só marca a OP ausente em duas leituras completas seguidas (lista do Omie pode deslocar entre páginas)', () => {
  assert.deepEqual(confirmarSaidas([], [1, 2]), { marcar: [], pendentes: [1, 2] })
  assert.deepEqual(confirmarSaidas([1, 2], [2, 3]), { marcar: [2], pendentes: [3] })
  assert.deepEqual(confirmarSaidas([1], []), { marcar: [], pendentes: [] })
})

test('origemDaOP: OPs da Central de correções (CP- cupom, CT- correção) são deste app', () => {
  assert.equal(origemDaOP({ cCodIntOP: 'CP-11ab2c-19xtf1' }), 'app')
  assert.equal(origemDaOP({ cCodIntOP: 'CT-0a1b2c3d4e5f6' }), 'app')
  assert.equal(origemDaOP({ cCodIntOP: 'CPX-1' }), 'manual')
})
