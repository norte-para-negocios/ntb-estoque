import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lerCustoRealTeorico, mapaVersoes, rotuloFicha } from './ficha-versao-puro.ts'

test('mapa de versões: movimento → versão, ignora linha quebrada', () => {
  const m = mapaVersoes([
    { movimento_id: 10, ficha_id: 5, versao: 3, codigo_produto_ficha: 99, via: 'op' },
    { movimento_id: '11', ficha_id: 6, versao: '1', codigo_produto_ficha: 98, via: 'venda' },
    { movimento_id: null, ficha_id: 7, versao: 2 },
  ])
  assert.deepEqual([...m.entries()], [[10, 3], [11, 1]])
  assert.equal(mapaVersoes(null).size, 0)
})

test('rótulo da ficha', () => {
  assert.equal(rotuloFicha(3), 'ficha v3')
  assert.equal(rotuloFicha(undefined), null)
})

test('custo real × teórico: números do banco viram number, sem resposta = null', () => {
  const r = lerCustoRealTeorico({
    ref: 'OP:1:1', versao: 2, quantidade: '2', custo_gravado: '8.333333', custo_real: '10.333333', custo_teorico: '9', diferenca: '1.333333',
    diferenca_pct: '14.81', teorico_sem_custo: 0, teorico_estimado: 1, status: 'concluida',
    itens: [{ codigo_insumo: 4, descricao: 'Molho', unidade: 'G', qtd_real: '1', custo_real: '2.333333', custo_unit_real: '2.333333', qtd_teorica: '1',
              custo_unit_teorico: '3', custo_teorico: '3', diferenca: '-0.666667', sub_receita: true, versao_sub: 2, real_estimado: false, sem_custo: 0, estimado: 0 }],
  })!
  assert.equal(r.custoReal, 10.333333)
  assert.equal(r.custoTeorico, 9)
  assert.equal(r.diferenca, 1.333333)
  assert.equal(r.diferencaPct, 14.81)
  assert.equal(r.itens[0].custoUnitTeorico, 3)
  assert.equal(r.itens[0].subReceita, true)
  assert.equal(r.itens[0].versaoSub, 2)
  assert.equal(lerCustoRealTeorico(null), null)
  // item só no teórico (a OP não consumiu): real fica null, não zero
  const s = lerCustoRealTeorico({ ref: 'x', custo_real: 0, custo_teorico: 1, diferenca: -1, itens: [{ codigo_insumo: 1, qtd_real: null, custo_real: null, custo_teorico: 1, diferenca: -1 }] })!
  assert.equal(s.itens[0].custoReal, null)
  assert.equal(s.diferencaPct, null)
})
