import test from 'node:test'
import assert from 'node:assert/strict'
import { montarFatoBulk, lotesDeCupons, BASE_ID_ITEM_PROPRIO, type VendaDb, type ItemDb, type PagamentoDb } from './fechamento-frio.ts'

const venda = (id: number, extra: Partial<VendaDb> = {}): VendaDb => ({ id, n_id_cupom: 8_000_000_000_000 + id, data: '2026-10-06', hora: '21:00:00', valor: '50.00', cancelado: false, devolvido: false, nota_chave: null, nota_numero: '140', nota_serie: '1', ...extra })
const item = (id: number, vendaId: number): ItemDb => ({ id, venda_id: vendaId, codigo_produto: 8_000_000_000_801, nome: 'Cerveja', quantidade: '2.000000', valor_unitario: '14.0000', desconto: '0.00', valor: '28.00', ncm: '22030000', cfop: '5102' })
const pag = (vendaId: number, seq: number): PagamentoDb => ({ venda_id: vendaId, sequencia: seq, tipo_doc: 'PIX', valor: '50.00' })

test('monta cupom, itens e pagamentos no formato da ntb-frio-api, com ids numéricos próprios', () => {
  const f = montarFatoBulk([venda(1)], [item(10, 1)], [pag(1, 1)])
  assert.equal(f.cupons[0].n_id_cupom, 8_000_000_000_001)
  assert.equal(f.cupons[0].valor, 50)
  assert.equal(f.itens[0].id_item, BASE_ID_ITEM_PROPRIO + 10)
  assert.equal(f.itens[0].v_item, 28)
  assert.equal(f.itens[0].id_produto, 8_000_000_000_801)
  assert.equal(f.pagamentos[0].tipo_doc, 'PIX')
})

test('venda cancelada leva só o cabeçalho, como no fato do Omie', () => {
  const f = montarFatoBulk([venda(1, { cancelado: true })], [item(10, 1)], [pag(1, 1)])
  assert.equal(f.cupons.length, 1)
  assert.equal(f.cupons[0].cancelado, true)
  assert.equal(f.itens.length, 0)
  assert.equal(f.pagamentos.length, 0)
})

test('lotes não misturam itens de cupons de outro lote', () => {
  const vendas = [venda(1), venda(2), venda(3)]
  const f = montarFatoBulk(vendas, [item(10, 1), item(11, 2), item(12, 3)], [pag(1, 1), pag(2, 1), pag(3, 1)])
  const lotes = lotesDeCupons(f, 2)
  assert.equal(lotes.length, 2)
  assert.equal(lotes[0].cupons.length, 2)
  assert.equal(lotes[0].itens.length, 2)
  assert.equal(lotes[1].itens.length, 1)
  assert.equal(lotes[1].itens[0].n_id_cupom, 8_000_000_000_003)
})

test('valores numéricos que chegam como texto do Postgres viram número', () => {
  const f = montarFatoBulk([venda(1)], [item(10, 1)], [])
  assert.equal(typeof f.itens[0].quant, 'number')
  assert.equal(f.itens[0].quant, 2)
})
