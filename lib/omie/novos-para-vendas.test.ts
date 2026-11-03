// Produto novo do Omie → cardápio do Norte Vendas (03/11/2026, pedido do Ramon: o Mousse de Coco (aniversário),
// código 98165 do Sertão, incluído no Omie em 29/10, não apareceu no Norte Vendas). `node --test lib/omie/novos-para-vendas.test.ts`
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { novosParaVendas, INICIO_CRIACAO_AUTOMATICA } from './novos-para-vendas.ts'

const base = { inativo: false, bloqueado: false }
const produtos = [
  { ...base, codigo: '98165', descricao: 'Mousse de Coco (aniversário)', valor_unitario: 0.01, tipo_item: '04', codigo_familia: 7, descricao_familia: 'SOBREMESAS', dinc: '29/10/2026' },
  { ...base, codigo: '90700', descricao: 'Pudim', valor_unitario: 19.9, tipo_item: '04', codigo_familia: 7, descricao_familia: 'SOBREMESAS', dinc: '10/05/2026' },
  { ...base, codigo: '90701', descricao: 'Leite condensado (MP)', valor_unitario: 8, tipo_item: '01', codigo_familia: 7, descricao_familia: 'SOBREMESAS', dinc: '30/10/2026' },
  { ...base, codigo: '91009', descricao: 'FYS GUARANA LT', valor_unitario: 9.5, tipo_item: '00', codigo_familia: 9, descricao_familia: 'GELADAS SEM ÁLCOOL', dinc: '24/10/2026' },
  { ...base, codigo: '91030', descricao: 'Long Nova', valor_unitario: 16.9, tipo_item: '00', codigo_familia: 9, descricao_familia: 'GELADAS SEM ÁLCOOL', dinc: '02/11/2026' },
  { ...base, inativo: true, codigo: '91031', descricao: 'Inativo', valor_unitario: 10, tipo_item: '04', codigo_familia: 7, descricao_familia: 'SOBREMESAS', dinc: '02/11/2026' },
  { ...base, bloqueado: true, codigo: '91032', descricao: 'Bloqueado', valor_unitario: 10, tipo_item: '04', codigo_familia: 7, descricao_familia: 'SOBREMESAS', dinc: '02/11/2026' },
  { ...base, codigo: '91033', descricao: 'Sem data', valor_unitario: 10, tipo_item: '04', codigo_familia: 7, descricao_familia: 'SOBREMESAS', dinc: null },
]

test('regra começa em 29/10/2026 (inclui o mousse do Ramon)', () => {
  assert.equal(INICIO_CRIACAO_AUTOMATICA, '2026-10-29')
})

test('só produto de venda (tipo 00/04), ativo, desbloqueado e incluído no Omie a partir do início', () => {
  assert.deepEqual(novosParaVendas(produtos).map((n) => n.omieCodigo), ['98165', '91030'])
})

test('manda preço do Omie (até R$ 0,01), família e os irmãos de venda da mesma família', () => {
  const [mousse, longNova] = novosParaVendas(produtos)
  assert.deepEqual(mousse, { omieCodigo: '98165', nome: 'Mousse de Coco (aniversário)', preco: 0.01, familia: 'SOBREMESAS', irmaos: ['90700', '91033'] })
  assert.deepEqual(longNova.irmaos, ['91009'])
})

test('família 0 (sem família no Omie) não tem irmãos', () => {
  const r = novosParaVendas([{ ...produtos[0], codigo_familia: 0, descricao_familia: '' }, { ...produtos[1], codigo_familia: 0 }])
  assert.deepEqual(r[0].irmaos, [])
})
