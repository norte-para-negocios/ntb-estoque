import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rpcDaSugestao, montarLinhasSugestao, filtrarSugestao, resumoSugestao, type LinhaBruta } from './sugestao-puro.ts'

const bruta = (o: Partial<LinhaBruta>): LinhaBruta => ({
  codigo_produto: 1, codigo: '1', descricao: 'X', unidade: 'UN', tipo_item: '00', familia: 'F', consumo_total: 0, estoque_atual: 0,
  estoque_minimo: 0, lead_time: null, entrada_nf: 0, entrada_ops: 0, entrada_pedidos: 0, consumo_ops: 0, previsao_qtde: 0, previsao_dias: 0,
  tem_ficha: false, fornecedor_id: null, fornecedor_nome: null, fornecedor_cnpj: null, ultimo_custo: null, ultima_compra: null, ...o,
})
const P = { diasAnalise: 30, diasEstimativa: 15, base: 'consumo' as const }

test('despacho por modo: cada modo lê só a sua função', () => {
  assert.equal(rpcDaSugestao('omie'), 'sugestao_compra_omie')
  assert.equal(rpcDaSugestao('proprio'), 'sugestao_compra_proprio')
  assert.equal(rpcDaSugestao('nenhum'), null)
})

test('montarLinhasSugestao: entradas somadas (nota + OP + pedido) e valor estimado pelo último custo', () => {
  const [l] = montarLinhasSugestao([bruta({ consumo_total: 1146, estoque_minimo: 120, estoque_atual: 150.5, entrada_nf: 200, entrada_pedidos: 4, ultimo_custo: 2 })], P)
  assert.equal(l.entradaPrevista, 204)
  assert.equal(l.sugestao, 376.7)
  assert.equal(l.valorEstimado, 753.4)
  assert.equal(l.rotulo, 'Comprar imediatamente')
  assert.equal(l.leadTimeInformado, false)
})

test('montarLinhasSugestao: pedidos do Omie (leitura ligada) entram como entrada prevista', () => {
  const [l] = montarLinhasSugestao([bruta({ codigo_produto: 9, consumo_total: 300, estoque_atual: 0 })], { ...P, pedidosExtra: new Map([[9, 150]]) })
  assert.equal(l.entradaPedidos, 150)
  assert.equal(l.sugestao, 10) // 150 + 10 - 0 - 150
})

test('produto com ficha produz e não soma no valor de compra', () => {
  const [l] = montarLinhasSugestao([bruta({ tipo_item: '01', tem_ficha: true, consumo_total: 30, ultimo_custo: 10 })], P)
  assert.equal(l.acao, 'produzir')
  assert.equal(l.valorEstimado, 0)
})

test("base 'previsao' usa previsão de venda por dia + consumo nas OPs abertas", () => {
  const [l] = montarLinhasSugestao([bruta({ consumo_total: 30, previsao_qtde: 70, previsao_dias: 7, consumo_ops: 5 })], { ...P, base: 'previsao' })
  assert.equal(l.previsaoVenda, 150)
  assert.equal(l.saidaProjetada, 155)
})

test('filtrarSugestao: padrão esconde "não comprar" e tipos 08/09/99; ordem imediato → próximos', () => {
  const linhas = montarLinhasSugestao([
    bruta({ codigo_produto: 1, descricao: 'B', consumo_total: 30, estoque_atual: 100 }),           // não comprar
    bruta({ codigo_produto: 2, descricao: 'A', consumo_total: 30, estoque_atual: 10 }),            // próximos (dias 8)
    bruta({ codigo_produto: 3, descricao: 'C', consumo_total: 30, estoque_atual: 0 }),             // imediato
    bruta({ codigo_produto: 4, descricao: 'TAXA', tipo_item: '99', consumo_total: 30 }),           // tipo 99 fora
  ], P)
  assert.deepEqual(filtrarSugestao(linhas, {}).map((l) => l.codigoProduto), [3, 2])
  assert.deepEqual(filtrarSugestao(linhas, { ver: 'todos' }).map((l) => l.codigoProduto), [3, 2, 1])
  assert.deepEqual(filtrarSugestao(linhas, { tipos: ['99'] }).map((l) => l.codigoProduto), [4])
  assert.deepEqual(filtrarSugestao(linhas, { ver: 'imediato' }).map((l) => l.codigoProduto), [3])
  assert.deepEqual(filtrarSugestao(linhas, { q: 'a' }).map((l) => l.codigoProduto), [2])
  const r = resumoSugestao(filtrarSugestao(linhas, {}))
  assert.equal(r.comprarJa, 1)
  assert.equal(r.comprarProximos, 1)
  assert.equal(r.semCusto, 2)
})

test('valor estimado usa o custo médio quando existe (unidade da nota do Omie pode vir errada)', () => {
  const [l] = montarLinhasSugestao([bruta({ consumo_total: 300, ultimo_custo: 418.02, cmc: 0.206212 })], P)
  assert.equal(l.sugestao, 160)
  assert.equal(l.valorEstimado, 32.99)
  assert.equal(l.ultimoCusto, 418.02)
})
