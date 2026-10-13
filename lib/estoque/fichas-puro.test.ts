import { test } from 'node:test'
import assert from 'node:assert/strict'
import { itensDaEstrutura, escolherProdutosFicha, fichaMudou, localPorInsumoDaOP, insumosQueSairam, type ItemEstruturaOmie } from './fichas-puro.ts'

const item = (o: Partial<ItemEstruturaOmie>): ItemEstruturaOmie => ({
  idMalha: 1, idProdMalha: 900, descrProdMalha: 'ARROZ', quantProdMalha: 0.333, unidProdMalha: 'KG', percPerdaProdMalha: 0,
  dIncProdMalha: '05/08/2026', uIncProdMalha: 'P000331146', dAltProdMalha: '10/09/2026', uAltProdMalha: 'P000999', ...o,
})
const ctx = { lojaId: 5, codigoProduto: 77, tipoPorCodigo: new Map<number, string | null>([[900, '01']]), localPorInsumoOP: new Map<number, number>() }

test('itensDaEstrutura: autor, datas ISO, tipo do insumo e sem local', () => {
  const [l] = itensDaEstrutura([item({})], ctx)
  assert.equal(l.loja_id, 5)
  assert.equal(l.codigo_produto, 77)
  assert.equal(l.codigo_produto_insumo, 900)
  assert.equal(l.id_malha, 1)
  assert.equal(l.incluido_por, 'P000331146')
  assert.equal(l.incluido_em, '2026-08-05')
  assert.equal(l.alterado_por, 'P000999')
  assert.equal(l.alterado_em, '2026-09-10')
  assert.equal(l.tipo_insumo, '01')
  assert.equal(l.codigo_local_estoque, null)
  assert.equal(l.local_fonte, null)
})

test('itensDaEstrutura: local da ficha tem preferência; senão o da última OP', () => {
  const op = { ...ctx, localPorInsumoOP: new Map([[900, 555], [901, 666]]) }
  const ls = itensDaEstrutura([item({ codigo_local_estoque: 111 }), item({ idMalha: 2, idProdMalha: 901 })], op)
  assert.deepEqual(ls.map((l) => [l.codigo_produto_insumo, l.codigo_local_estoque, l.local_fonte]), [[900, 111, 'ficha'], [901, 666, 'op']])
})

test('itensDaEstrutura: insumo repetido na mesma ficha soma a quantidade (chave única do cache)', () => {
  const ls = itensDaEstrutura([item({ quantProdMalha: 1 }), item({ idMalha: 2, quantProdMalha: 0.5 })], ctx)
  assert.equal(ls.length, 1)
  assert.equal(ls[0].quantidade, 1.5)
})

test('escolherProdutosFicha: nunca lidos primeiro, depois os vencidos (7 dias), até o limite', () => {
  const agora = Date.parse('2026-10-13T12:00:00Z')
  const ult = new Map([[1, '2026-10-12T12:00:00Z'], [2, '2026-10-01T12:00:00Z'], [3, '2026-09-20T12:00:00Z']])
  assert.deepEqual(escolherProdutosFicha([1, 2, 3, 4, 5], ult, agora, 3, 7), [4, 5, 3])
  assert.deepEqual(escolherProdutosFicha([1], ult, agora, 3, 7), [])
})

test('fichaMudou compara as colunas gravadas (números vindos como texto contam como iguais)', () => {
  const [l] = itensDaEstrutura([item({})], ctx)
  assert.equal(fichaMudou({ ...l, quantidade: '0.333000', id: 9, sincronizado_em: 'x' }, l), false)
  assert.equal(fichaMudou({ ...l, quantidade: '0.5' }, l), true)
  assert.equal(fichaMudou({ ...l, alterado_por: null }, l), true)
})

test('localPorInsumoDaOP lê itensDetalhes da OP', () => {
  const m = localPorInsumoDaOP({ itensDetalhes: [{ nIdProdutoMalha: 900, codigo_local_estoque: 555 }, { nIdProdutoMalha: 901 }] })
  assert.deepEqual([...m], [[900, 555]])
  assert.equal(localPorInsumoDaOP(null).size, 0)
})

test('insumosQueSairam: os que estavam no cache e não vieram na ficha nova', () => {
  assert.deepEqual(insumosQueSairam([900, 901, 902], [901]), [900, 902])
})
