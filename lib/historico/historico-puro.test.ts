import { test } from 'node:test'
import assert from 'node:assert/strict'
import { consolidarHistorico, formatarValor, type LinhaHistorico, type RotulosEntidade } from './historico-puro.ts'

const ROT: RotulosEntidade = {
  tabelaPrincipal: 'pedidos_compra',
  campos: {
    etapa: { rotulo: 'Etapa' },
    frete: { rotulo: 'Frete', formato: 'moeda' },
    quantidade: { rotulo: 'Quantidade', formato: 'numero' },
    preco_unitario: { rotulo: 'Preço', formato: 'moeda' },
    codigo_produto: { rotulo: 'Produto', formato: 'codigo' },
  },
}

let id = 0
function l(p: Partial<LinhaHistorico>): LinhaHistorico {
  return {
    id: ++id, tabela: 'pedidos_compra', linha: null, operacao: 'update', campo: null, valor_de: null, valor_para: null,
    autor_nome: 'Ana', origem: 'app', txid: 1, created_at: '2026-10-19T12:00:00Z', ...p,
  }
}

test('update da tabela principal vira "alterou" com de → para formatados', () => {
  const m = consolidarHistorico([l({ campo: 'frete', valor_de: '10.00', valor_para: '12.5' }), l({ campo: 'etapa', valor_de: 'rascunho', valor_para: 'aprovado' })], ROT)
  assert.equal(m.length, 1)
  assert.equal(m[0].autor, 'Ana')
  assert.equal(m[0].itens.length, 1)
  assert.equal(m[0].itens[0].tipo, 'alterou')
  assert.deepEqual(m[0].itens[0].mudancas.map((x) => [x.rotulo, x.de, x.para]), [['Frete', 'R$ 10,00', 'R$ 12,50'], ['Etapa', 'rascunho', 'aprovado']])
})

test('apagar e recriar o item igual (pc_salvar) some; diferente vira "item alterado"', () => {
  const t = 7
  const linhas = [
    l({ txid: t, tabela: 'pedidos_compra_itens', linha: '1', operacao: 'delete', campo: 'quantidade', valor_de: '3.000000' }),
    l({ txid: t, tabela: 'pedidos_compra_itens', linha: '1', operacao: 'delete', campo: 'preco_unitario', valor_de: '2.000000' }),
    l({ txid: t, tabela: 'pedidos_compra_itens', linha: '1', operacao: 'insert', campo: 'quantidade', valor_para: '3.000000' }),
    l({ txid: t, tabela: 'pedidos_compra_itens', linha: '1', operacao: 'insert', campo: 'preco_unitario', valor_para: '2.000000' }),
    l({ txid: t, tabela: 'pedidos_compra_itens', linha: '2', operacao: 'delete', campo: 'quantidade', valor_de: '1.000000' }),
    l({ txid: t, tabela: 'pedidos_compra_itens', linha: '2', operacao: 'insert', campo: 'quantidade', valor_para: '4.000000' }),
  ]
  const m = consolidarHistorico(linhas, ROT)
  assert.equal(m.length, 1)
  assert.equal(m[0].itens.length, 1)
  assert.equal(m[0].itens[0].tipo, 'item_alterado')
  assert.equal(m[0].itens[0].linha, '2')
  assert.deepEqual(m[0].itens[0].mudancas.map((x) => [x.de, x.para]), [['1', '4']])
})

test('só os pares iguais: o momento inteiro some', () => {
  const m = consolidarHistorico([
    l({ txid: 8, tabela: 'pedidos_compra_itens', linha: '1', operacao: 'delete', campo: 'quantidade', valor_de: '3' }),
    l({ txid: 8, tabela: 'pedidos_compra_itens', linha: '1', operacao: 'insert', campo: 'quantidade', valor_para: '3' }),
  ], ROT)
  assert.equal(m.length, 0)
})

test('insert sem autor (campo nulo) = "criou" sem detalhes, origem sistema', () => {
  const m = consolidarHistorico([l({ operacao: 'insert', autor_nome: null, origem: 'sistema' })], ROT)
  assert.equal(m[0].itens[0].tipo, 'criou')
  assert.equal(m[0].itens[0].mudancas.length, 0)
  assert.equal(m[0].autor, 'Sistema')
})

test('item só incluído e item só removido; momentos em ordem do mais novo', () => {
  const m = consolidarHistorico([
    l({ txid: 1, tabela: 'pedidos_compra_itens', linha: '1', operacao: 'insert', campo: 'quantidade', valor_para: '2', created_at: '2026-10-18T10:00:00Z' }),
    l({ txid: 2, tabela: 'pedidos_compra_itens', linha: '1', operacao: 'delete', campo: 'quantidade', valor_de: '2', created_at: '2026-10-19T10:00:00Z' }),
  ], ROT)
  assert.deepEqual(m.map((x) => x.itens[0].tipo), ['item_removido', 'item_incluido'])
})

test('várias alterações do mesmo campo na mesma transação: primeiro de, último para', () => {
  const m = consolidarHistorico([l({ campo: 'etapa', valor_de: 'a', valor_para: 'b' }), l({ campo: 'etapa', valor_de: 'b', valor_para: 'c' })], ROT)
  assert.deepEqual(m[0].itens[0].mudancas.map((x) => [x.de, x.para]), [['a', 'c']])
})

test('rotuloLinha nomeia o item pelos valores', () => {
  const m = consolidarHistorico(
    [l({ tabela: 'pedidos_compra_itens', linha: '3', operacao: 'insert', campo: 'codigo_produto', valor_para: '501' })],
    ROT, (linha, v) => `Item ${linha}: produto ${v.codigo_produto}`)
  assert.equal(m[0].itens[0].titulo, 'Item 3: produto 501')
})

test('formatarValor', () => {
  assert.equal(formatarValor(null), '—')
  assert.equal(formatarValor(''), '—')
  assert.equal(formatarValor('true'), 'Sim')
  assert.equal(formatarValor('false'), 'Não')
  assert.equal(formatarValor('2026-10-19'), '19/10/2026')
  assert.equal(formatarValor('1234.500000', 'numero'), '1.234,5')
  assert.equal(formatarValor('7891234567895', 'codigo'), '7891234567895')
  assert.equal(formatarValor('7891234567895'), '7891234567895')
  assert.equal(formatarValor('3.5', 'moeda'), 'R$ 3,50')
  assert.equal(formatarValor('abc', 'numero'), 'abc')
})
