import { test } from 'node:test'
import assert from 'node:assert/strict'
import { etapaDaNota, agruparPorEtapa, ROTULO_ETAPA } from './nf-etapas.ts'

test('etapas reaproveitam a situação da conferência', () => {
  assert.equal(etapaDaNota('resumo', false), 'aguardando_xml'); assert.equal(etapaDaNota('divergente', false), 'a_conferir')
  assert.equal(etapaDaNota('conferida', false), 'conferida'); assert.equal(etapaDaNota('parcial', false), 'lancada')
  assert.equal(etapaDaNota('lancada', true), 'fora'); assert.equal(etapaDaNota('recusada', false), 'fora'); assert.equal(etapaDaNota(null, false), 'a_conferir')
  assert.equal(etapaDaNota('estornada', false), 'fora')
})
test('agruparPorEtapa monta as 4 colunas e o grupo de fora', () => {
  const g = agruparPorEtapa([{ situacao: 'resumo', cancelada: false, id: 1 }, { situacao: 'lancada', cancelada: false, id: 2 }, { situacao: 'a_conferir', cancelada: true, id: 3 }])
  assert.deepEqual(Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.map((n) => n.id)])), { aguardando_xml: [1], a_conferir: [], conferida: [], lancada: [2], fora: [3] })
  assert.equal(ROTULO_ETAPA.fora, 'Canceladas e desfeitas')
})
