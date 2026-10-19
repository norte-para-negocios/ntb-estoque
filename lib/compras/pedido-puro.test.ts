import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  acoesDisponiveis, etapaExibida, conferirPedidoNota, ordenarPedidosParaNota, agruparPorFornecedor, totaisPedido, validarParcelas,
  parcelasDoPedido,
} from './pedido-puro.ts'

test('acoesDisponiveis espelha as transições da função pc_acao', () => {
  assert.deepEqual(acoesDisponiveis('rascunho', { temVinculo: false, podeAprovar: false, podeEditar: true }), ['editar', 'enviar', 'cancelar'])
  assert.deepEqual(acoesDisponiveis('rascunho', { temVinculo: false, podeAprovar: true, podeEditar: true }), ['editar', 'enviar', 'aprovar', 'cancelar'])
  assert.deepEqual(acoesDisponiveis('aguardando_aprovacao', { temVinculo: false, podeAprovar: false, podeEditar: true }), ['cancelar'])
  assert.deepEqual(acoesDisponiveis('aguardando_aprovacao', { temVinculo: false, podeAprovar: true, podeEditar: true }), ['aprovar', 'reprovar', 'cancelar'])
  assert.deepEqual(acoesDisponiveis('aprovado', { temVinculo: false, podeAprovar: false, podeEditar: true }), ['reabrir', 'cancelar'])
  assert.deepEqual(acoesDisponiveis('aprovado', { temVinculo: true, podeAprovar: false, podeEditar: true }), ['cancelar'])
  assert.deepEqual(acoesDisponiveis('cancelado', { temVinculo: false, podeAprovar: true, podeEditar: true }), [])
  assert.deepEqual(acoesDisponiveis('rascunho', { temVinculo: false, podeAprovar: true, podeEditar: false }), [])
})

test('etapaExibida: recebido parcial/total vem das notas lançadas', () => {
  assert.equal(etapaExibida('aprovado', { pedido: 10, recebido: 0 }).chave, 'aprovado')
  assert.equal(etapaExibida('aprovado', { pedido: 10, recebido: 4 }).chave, 'recebido_parcial')
  assert.equal(etapaExibida('aprovado', { pedido: 10, recebido: 10 }).chave, 'recebido')
  assert.equal(etapaExibida('aprovado', { pedido: 10, recebido: 12 }).chave, 'recebido')
  assert.equal(etapaExibida('cancelado', { pedido: 10, recebido: 4 }).chave, 'encerrado')
  assert.equal(etapaExibida('cancelado', { pedido: 10, recebido: 0 }).chave, 'cancelado')
  assert.equal(etapaExibida('aguardando_aprovacao', { pedido: 10, recebido: 0 }).rotulo, 'Aguardando aprovação')
})

test('conferirPedidoNota: quantidade e preço em unidade de estoque', () => {
  const pedido = [
    { id: 1, codigoProduto: 501, descricao: 'TOMATE', quantidadeBase: 10, precoBase: 4.5 },
    { id: 2, codigoProduto: 502, descricao: 'CERVEJA', quantidadeBase: 24, precoBase: 2.5 },
    { id: 3, codigoProduto: 503, descricao: 'ALFACE', quantidadeBase: 5, precoBase: 2 },
  ]
  const nota = [
    { id: 11, codigoProduto: 501, descricao: 'TOMATE', quantidadeBase: 8, precoBase: 4.8, recebido: 7.5, lancado: true, pedidoItemId: 1 },
    { id: 12, codigoProduto: 502, descricao: 'CERVEJA CX', quantidadeBase: 24, precoBase: 2.5, recebido: 24, lancado: false, pedidoItemId: 2 },
    { id: 13, codigoProduto: null, descricao: 'BRINDE', quantidadeBase: 1, precoBase: 0, recebido: 1, lancado: false, pedidoItemId: null },
  ]
  const r = conferirPedidoNota(pedido, nota)
  const tomate = r.find((l) => l.pedidoItemId === 1)!
  assert.equal(tomate.situacao, 'falta')
  assert.equal(tomate.notaQtd, 8)
  assert.equal(tomate.recebido, 7.5)
  assert.equal(tomate.precoDiferente, true)
  assert.equal(Math.round(tomate.difPrecoPct! * 100) / 100, 6.67)
  const cerveja = r.find((l) => l.pedidoItemId === 2)!
  assert.equal(cerveja.situacao, 'ok')
  assert.equal(cerveja.recebido, 0) // nota ainda não lançada: nada recebido
  assert.equal(r.find((l) => l.pedidoItemId === 3)!.situacao, 'nao_veio')
  assert.equal(r.find((l) => l.notaItemId === 13)!.situacao, 'fora_do_pedido')
})

test('conferirPedidoNota: quantidade acima do pedido e preço dentro da tolerância', () => {
  const r = conferirPedidoNota(
    [{ id: 1, codigoProduto: 1, descricao: 'A', quantidadeBase: 10, precoBase: 100 }],
    [{ id: 9, codigoProduto: 1, descricao: 'A', quantidadeBase: 12, precoBase: 100.4, recebido: 12, lancado: true, pedidoItemId: 1 }],
  )
  assert.equal(r[0].situacao, 'excede')
  assert.equal(r[0].precoDiferente, false) // 0,4% < 0,5%
})

test('conferirPedidoNota: duas linhas da nota no mesmo item somam', () => {
  const r = conferirPedidoNota(
    [{ id: 1, codigoProduto: 1, descricao: 'A', quantidadeBase: 10, precoBase: 3 }],
    [
      { id: 9, codigoProduto: 1, descricao: 'A', quantidadeBase: 6, precoBase: 3, recebido: 6, lancado: true, pedidoItemId: 1 },
      { id: 10, codigoProduto: 1, descricao: 'A', quantidadeBase: 4, precoBase: 3, recebido: 4, lancado: true, pedidoItemId: 1 },
    ],
  )
  assert.equal(r.length, 1)
  assert.equal(r[0].notaQtd, 10)
  assert.equal(r[0].situacao, 'ok')
})

test('ordenarPedidosParaNota: mesmo fornecedor e mais produtos em comum primeiro', () => {
  const pedidos = [
    { id: 1, numero: 1, fornecedorCnpj: '11222333000181', produtos: [501], previsao: '2026-10-20' },
    { id: 2, numero: 2, fornecedorCnpj: '11222333000181', produtos: [501, 502], previsao: '2026-10-25' },
    { id: 3, numero: 3, fornecedorCnpj: '99888777000100', produtos: [501, 502], previsao: '2026-10-19' },
    { id: 4, numero: 4, fornecedorCnpj: null, produtos: [502], previsao: null },
    { id: 5, numero: 5, fornecedorCnpj: null, produtos: [999], previsao: null },
  ]
  assert.deepEqual(ordenarPedidosParaNota(pedidos, { cnpj: '11.222.333/0001-81', produtos: [501, 502] }).map((p) => p.id), [2, 1, 4])
})

test('agruparPorFornecedor junta as linhas da sugestão por fornecedor (sem fornecedor fica junto)', () => {
  const g = agruparPorFornecedor([
    { codigoProduto: 1, quantidade: 2, preco: 1, fornecedorId: 7, fornecedorNome: 'A', fornecedorCnpj: null },
    { codigoProduto: 2, quantidade: 3, preco: 1, fornecedorId: null, fornecedorNome: null, fornecedorCnpj: null },
    { codigoProduto: 3, quantidade: 1, preco: 1, fornecedorId: 7, fornecedorNome: 'A', fornecedorCnpj: null },
  ])
  assert.equal(g.length, 2)
  assert.deepEqual(g[0].itens.map((i) => i.codigoProduto), [1, 3])
  assert.equal(g[1].fornecedorNome, null)
})

test('totaisPedido e parcelas', () => {
  const t = totaisPedido([{ quantidade: 10, precoUnitario: 4.5 }, { quantidade: 2, precoUnitario: 30 }], 15, 5)
  assert.deepEqual(t, { mercadorias: 105, total: 125 })
  assert.equal(validarParcelas([]), null)
  assert.equal(validarParcelas([{ dias: 30, percentual: 50 }, { dias: 60, percentual: 50 }]), null)
  assert.ok(validarParcelas([{ dias: 30, percentual: 40 }]))
  assert.ok(validarParcelas([{ dias: -1, percentual: 100 }]))
  const p = parcelasDoPedido([{ dias: 30, percentual: 50 }, { dias: 60, percentual: 50 }], 125.01, '2026-10-20')
  assert.deepEqual(p.map((x) => x.vencimento), ['2026-11-19', '2026-12-19'])
  assert.equal(Math.round((p[0].valor + p[1].valor) * 100) / 100, 125.01)
  assert.deepEqual(p.map((x) => x.valor), [62.51, 62.5])
})

test('parcelasDoTexto: 30/60/90 em partes iguais que fecham 100%', async () => {
  const { parcelasDoTexto, textoDasParcelas } = await import('./pedido-puro.ts')
  assert.deepEqual(parcelasDoTexto('30/60/90'), [{ dias: 30, percentual: 33.33 }, { dias: 60, percentual: 33.33 }, { dias: 90, percentual: 33.34 }])
  assert.deepEqual(parcelasDoTexto(''), [])
  assert.equal(parcelasDoTexto('30/x'), null)
  assert.equal(validarParcelas(parcelasDoTexto('0 28 56')!), null)
  assert.equal(textoDasParcelas([{ dias: 30, percentual: 50 }, { dias: 60, percentual: 50 }]), '30/60')
})
